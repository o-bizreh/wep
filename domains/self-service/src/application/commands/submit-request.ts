import { randomUUID } from 'node:crypto';
import { type Result, success, failure, domainError, type DomainError } from '@wep/domain-types';
import type { ServiceRequest, RequestAuditEvent } from '../../domain/entities/service-request.js';
import type { PortalRepository } from '../../domain/ports/portal-repository.js';
import type { EventPublisher } from '@wep/event-bus';
import { SlackNotifier, portalRequestNotification } from '@wep/slack-notifier';
import type { CredentialDispatcher, IssuedCredentials } from '../services/credential-dispatcher.js';
import type { AutoApprovalEvaluator } from '../services/auto-approval-evaluator.js';
import type { RequesterContextResolver } from '../services/requester-context-service.js';

export interface SubmitRequestInput {
  operationType: string;
  requesterId: string;
  requesterName: string;
  requesterEmail: string | null;
  requesterTeamId: string;
  requesterAwsUsername?: string;
  /** Full IAM ARN from STS GetCallerIdentity — required for aws-action operations. */
  requesterAwsArn?: string;
  serviceId?: string;
  parameters: Record<string, string>;
  durationMinutes?: number;
  justification?: string;
}

export interface SubmitRequestResult {
  request: ServiceRequest;
  /** Present iff the request was auto-approved AND credentials were issued. */
  credentials?: IssuedCredentials;
}

export class SubmitRequestHandler {
  private readonly slack = new SlackNotifier();

  constructor(
    private readonly portalRepo: PortalRepository,
    private readonly eventPublisher: EventPublisher,
    private readonly credentialDispatcher: CredentialDispatcher,
    private readonly evaluator: AutoApprovalEvaluator,
    private readonly contextResolver: RequesterContextResolver,
  ) {}

  async execute(input: SubmitRequestInput): Promise<Result<SubmitRequestResult, DomainError>> {
    const opResult = await this.portalRepo.getOperation(input.operationType);
    if (!opResult.ok) return opResult;
    if (!opResult.value) return failure(domainError('OPERATION_NOT_FOUND', `Operation ${input.operationType} not found`));
    if (!opResult.value.isEnabled) return failure(domainError('OPERATION_DISABLED', 'This operation is currently disabled'));

    const operation = opResult.value;

    for (const param of operation.parameters) {
      if (param.required && !input.parameters[param.name]) {
        return failure(domainError('MISSING_PARAMETER', `Required parameter ${param.name} is missing`));
      }
    }
    if (operation.kind === 'aws-action' && !input.requesterAwsArn) {
      return failure(domainError('AWS_ARN_REQUIRED',
        'AWS-action operations require valid SSO credentials configured in Settings so the platform can scope the role trust policy to your identity.',
      ));
    }

    const submittedAt = new Date().toISOString();
    const initialAudit: RequestAuditEvent[] = [{ at: submittedAt, actor: input.requesterId, type: 'submitted' }];
    const isLegacySelfServe = operation.tier === 'self-serve' && operation.kind === 'runbook';

    const baseRequest: ServiceRequest = {
      requestId: randomUUID(),
      operationType: operation.operationId,
      operationName: operation.name,
      requesterId: input.requesterId,
      requesterName: input.requesterName,
      requesterEmail: input.requesterEmail,
      requesterTeamId: input.requesterTeamId,
      serviceId: input.serviceId ?? null,
      parameters: input.parameters,
      tier: operation.tier,
      status: isLegacySelfServe ? 'approved' : 'pending-approval',
      submittedAt,
      approvedAt: isLegacySelfServe ? submittedAt : null,
      approvedBy: isLegacySelfServe ? 'auto' : null,
      executedAt: null,
      completedAt: null,
      failedAt: null,
      failureReason: null,
      executionLog: [],
      metadata: input.justification ? { justification: input.justification } : {},
      requesterAwsUsername: input.requesterAwsUsername,
      requesterAwsArn: input.requesterAwsArn,
      durationMinutes: input.durationMinutes,
      audit: initialAudit,
    };

    // Auto-approval evaluation runs only for kinds that issue credentials.
    if (operation.kind === 'aws-action' || operation.kind === 'db-credentials') {
      const ctxResult = await this.contextResolver.resolve({
        requesterArn: input.requesterId,
        email: input.requesterEmail,
        awsUsername: input.requesterAwsUsername,
      });
      if (!ctxResult.ok) return ctxResult;
      const decision = await this.evaluator.evaluate(operation, baseRequest, ctxResult.value);
      if (decision.matched && decision.rule) {
        // Auto-approve path — issue creds inline, mark completed.
        const autoApprovedAt = new Date().toISOString();
        baseRequest.approvalMode = 'auto';
        baseRequest.autoApprovalRuleDescription = decision.rule.description;
        baseRequest.audit?.push({
          at: autoApprovedAt,
          actor: 'system',
          type: 'auto-approved',
          detail: decision.rule.description,
        });
        baseRequest.status = 'approved';
        baseRequest.approvedAt = autoApprovedAt;
        baseRequest.approvedBy = 'auto';

        // Persist the approved (pre-issuance) state so audit survives even if STS fails next.
        const persistApproved = await this.portalRepo.saveRequest(baseRequest);
        if (!persistApproved.ok) return persistApproved;

        const credsResult = await this.credentialDispatcher.issue(operation, baseRequest);
        if (!credsResult.ok) {
          baseRequest.status = 'failed';
          baseRequest.failedAt = new Date().toISOString();
          baseRequest.failureReason = credsResult.error.message;
          baseRequest.audit?.push({ at: baseRequest.failedAt, actor: 'system', type: 'failed', detail: credsResult.error.message });
          await this.portalRepo.saveRequest(baseRequest);
          return failure(credsResult.error);
        }
        baseRequest.expiresAt = credsResult.value.expiresAt;
        baseRequest.status = 'completed';
        baseRequest.completedAt = new Date().toISOString();
        baseRequest.audit?.push({ at: baseRequest.completedAt, actor: 'system', type: 'fulfilled' });
        await this.portalRepo.saveRequest(baseRequest);

        await this.publishSubmittedEvent(baseRequest);
        return success({ request: baseRequest, credentials: credsResult.value });
      }
    }

    // Manual-approval path — persist + notify.
    if (!isLegacySelfServe) {
      baseRequest.approvalMode = 'manual';
    }
    const saveResult = await this.portalRepo.saveRequest(baseRequest);
    if (!saveResult.ok) return saveResult;

    await this.publishSubmittedEvent(baseRequest);

    const channel = process.env['PORTAL_REQUESTS_SLACK_CHANNEL'];
    const baseUrl = process.env['PORTAL_BASE_URL'] ?? 'http://localhost:5173';
    if (channel) {
      void this.notifySlack(baseRequest, channel, baseUrl);
    }

    return success({ request: baseRequest });
  }

  private async publishSubmittedEvent(request: ServiceRequest): Promise<void> {
    await this.eventPublisher.publish('wep.self-service', 'request.submitted', {
      eventId: randomUUID(),
      entityId: request.requestId,
      entityType: 'request',
      timestamp: request.submittedAt,
      version: 1,
      data: {
        requestId: request.requestId,
        requesterId: request.requesterId,
        operationType: request.operationType,
        serviceId: request.serviceId,
        tier: request.tier,
        approvalMode: request.approvalMode ?? 'manual',
      },
    });
  }

  private async notifySlack(request: ServiceRequest, channel: string, baseUrl: string): Promise<void> {
    try {
      const resolvedUsername = request.requesterEmail
        ? await this.slack.resolveMentionByEmail(request.requesterEmail)
        : null;
      const sendResult = await this.slack.sendToChannel(
        channel,
        portalRequestNotification({
          requestId: request.requestId,
          operationName: request.operationName,
          requesterName: request.requesterName,
          requesterMention: resolvedUsername,
          tier: request.tier,
          parameters: request.parameters,
          submittedAt: request.submittedAt,
          portalUrl: `${baseUrl}/portal/approve/${request.requestId}`,
        }),
        `New portal request: ${request.operationName} from ${request.requesterName}`,
      );
      if (sendResult.ok && sendResult.value) {
        const updated: ServiceRequest = {
          ...request,
          metadata: { ...request.metadata, slackChannel: channel, slackMessageTs: sendResult.value },
          slackApprovalMessageTs: sendResult.value,
        };
        await this.portalRepo.saveRequest(updated);
      }
    } catch (e) {
      console.warn('[portal] Slack notification failed:', e);
    }
  }
}
