import { randomUUID } from 'node:crypto';
import { type Result, success, failure, domainError, type DomainError } from '@wep/domain-types';
import type { ServiceRequest, RequestAuditEvent } from '../../domain/entities/service-request.js';
import type { Operation } from '../../domain/entities/operation.js';
import type { PortalRepository } from '../../domain/ports/portal-repository.js';
import type { EventPublisher } from '@wep/event-bus';
import { SlackNotifier, portalApprovalNotification } from '@wep/slack-notifier';
import type { CredentialDispatcher, IssuedCredentials } from '../services/credential-dispatcher.js';

export interface ApproveResult {
  request: ServiceRequest;
  /** Present when the operation issued credentials (kind=aws-action or db-credentials). */
  credentials?: IssuedCredentials;
}

export class ApproveRequestHandler {
  private readonly slack = new SlackNotifier();

  constructor(
    private readonly portalRepo: PortalRepository,
    private readonly eventPublisher: EventPublisher,
    private readonly credentialDispatcher: CredentialDispatcher,
  ) {}

  async execute(requestId: string, approverId: string, approverNote?: string): Promise<Result<ApproveResult, DomainError>> {
    const reqResult = await this.portalRepo.getRequest(requestId);
    if (!reqResult.ok) return reqResult;
    if (!reqResult.value) return failure(domainError('NOT_FOUND', 'Request not found'));

    const request = reqResult.value;
    if (request.status !== 'pending-approval') {
      return failure(domainError('INVALID_STATUS', `Cannot approve request in ${request.status} status`));
    }
    if (request.requesterId === approverId) {
      return failure(domainError('SELF_APPROVAL_FORBIDDEN', 'You cannot approve your own request'));
    }

    const opResult = await this.portalRepo.getOperation(request.operationType);
    if (!opResult.ok) return opResult;
    if (!opResult.value) return failure(domainError('OPERATION_NOT_FOUND', 'Operation no longer exists'));
    const operation: Operation = opResult.value;

    const approvedAt = new Date().toISOString();
    const audit: RequestAuditEvent[] = request.audit ?? [];
    audit.push({ at: approvedAt, actor: approverId, type: 'approved', detail: approverNote });

    const approved: ServiceRequest = {
      ...request,
      status: 'approved',
      approvedAt,
      approvedBy: approverId,
      approvalMode: 'manual',
      audit,
    };
    const saveApproved = await this.portalRepo.saveRequest(approved);
    if (!saveApproved.ok) return saveApproved;

    // For aws-action / db-credentials / resource-access, issue creds inline.
    // resource-access is the dynamic JIT path: the user picks the JIT resource at
    // request time via jitResourceId parameter, so we synthesise a db-credentials
    // operation from the request params and dispatch through the same pipeline.
    let credentials: IssuedCredentials | undefined;
    const isResourceAccess = operation.operationId === 'resource-access';
    const needsCredentials  = operation.kind === 'aws-action' || operation.kind === 'db-credentials' || isResourceAccess;

    if (needsCredentials) {
      let dispatchOperation = operation;

      if (isResourceAccess) {
        // Build a synthetic db-credentials operation from the request parameters.
        const jitResourceId  = approved.parameters['jitResourceId'] ?? '';
        const durationMinutes = parseInt(approved.parameters['durationMinutes'] ?? '60', 10);
        const accessLevel    = approved.parameters['accessLevel'] ?? 'readonly';
        if (!jitResourceId) {
          const failedAt = new Date().toISOString();
          const msg = 'resource-access request is missing jitResourceId parameter';
          audit.push({ at: failedAt, actor: 'system', type: 'failed', detail: msg });
          await this.portalRepo.saveRequest({ ...approved, status: 'failed', failedAt, failureReason: msg, audit });
          return failure(domainError('MISSING_PARAM', msg));
        }
        // Store resolved params so the issuer can read durationMinutes / role from the request.
        approved.parameters = {
          ...approved.parameters,
          role: accessLevel,        // PostgresCredentialIssuer reads 'role' from request.parameters
          dbUser: accessLevel,      // RedshiftCredentialIssuer reads 'dbUser'
        };
        approved.durationMinutes = durationMinutes;
        dispatchOperation = {
          ...operation,
          kind: 'db-credentials',
          dbCredentials: {
            jitResourceId,
            allowedRoles: ['readonly', 'readwrite'],
            maxDurationMinutes: durationMinutes,
          },
        };
      }

      const credsResult = await this.credentialDispatcher.issue(dispatchOperation, approved);
      if (!credsResult.ok) {
        const failedAt = new Date().toISOString();
        audit.push({ at: failedAt, actor: 'system', type: 'failed', detail: credsResult.error.message });
        await this.portalRepo.saveRequest({ ...approved, status: 'failed', failedAt, failureReason: credsResult.error.message, audit });
        return failure(credsResult.error);
      }
      credentials = credsResult.value;
      const completedAt = new Date().toISOString();
      audit.push({ at: completedAt, actor: 'system', type: 'fulfilled' });
      const completed: ServiceRequest = {
        ...approved,
        status: 'completed',
        completedAt,
        expiresAt: credentials.expiresAt,
        audit,
      };
      await this.portalRepo.saveRequest(completed);
      approved.status = completed.status;
      approved.completedAt = completed.completedAt;
      approved.expiresAt = completed.expiresAt;
    }

    await this.eventPublisher.publish('wep.self-service', 'request.approved', {
      eventId: randomUUID(),
      entityId: requestId,
      entityType: 'request',
      timestamp: approvedAt,
      version: 1,
      data: { requestId, approverId, approvalTimestamp: approvedAt, approvalMode: 'manual' },
    });

    const notifChannel = process.env['PORTAL_NOTIFICATIONS_SLACK_CHANNEL'];
    const baseUrl = process.env['PORTAL_BASE_URL'] ?? 'http://localhost:5173';
    const threadChannel = (approved.metadata['slackChannel'] as string | undefined) ?? notifChannel;
    const threadTs = approved.metadata['slackMessageTs'] as string | undefined;
    if (threadChannel) {
      void (async () => {
        try {
          const mention = approved.requesterEmail ? await this.slack.resolveMentionByEmail(approved.requesterEmail) : null;
          await this.slack.sendToChannel(
            threadChannel,
            portalApprovalNotification({
              requestId,
              operationName: approved.operationName,
              requesterMention: mention,
              requesterName: approved.requesterName,
              approvedBy: approverId,
              approved: true,
              portalUrl: `${baseUrl}/portal/requests`,
            }),
            `Your request for ${approved.operationName} has been approved`,
            threadTs,
          );
        } catch (e) {
          console.warn('[portal] Slack approval notification failed:', e);
        }
      })();
    }

    return success({ request: approved, credentials });
  }
}

export class RejectRequestHandler {
  private readonly slack = new SlackNotifier();

  constructor(
    private readonly portalRepo: PortalRepository,
    private readonly eventPublisher: EventPublisher,
  ) {}

  async execute(requestId: string, rejectedBy: string, reason: string): Promise<Result<ServiceRequest, DomainError>> {
    const reqResult = await this.portalRepo.getRequest(requestId);
    if (!reqResult.ok) return reqResult;
    if (!reqResult.value) return failure(domainError('NOT_FOUND', 'Request not found'));
    if (reqResult.value.status !== 'pending-approval') {
      return failure(domainError('INVALID_STATUS', `Cannot reject request in ${reqResult.value.status} status`));
    }
    if (reqResult.value.requesterId === rejectedBy) {
      return failure(domainError('SELF_REJECTION_FORBIDDEN', 'You cannot reject your own request'));
    }

    const deniedAt = new Date().toISOString();
    const audit: RequestAuditEvent[] = reqResult.value.audit ?? [];
    audit.push({ at: deniedAt, actor: rejectedBy, type: 'denied', detail: reason });

    const updated: ServiceRequest = {
      ...reqResult.value,
      status: 'rejected',
      failureReason: reason,
      metadata: { ...reqResult.value.metadata, rejectedBy, rejectionReason: reason },
      audit,
    };

    const saveResult = await this.portalRepo.saveRequest(updated);
    if (!saveResult.ok) return saveResult;

    await this.eventPublisher.publish('wep.self-service', 'request.rejected', {
      eventId: randomUUID(),
      entityId: requestId,
      entityType: 'request',
      timestamp: deniedAt,
      version: 1,
      data: { requestId, rejectedBy, rejectionReason: reason },
    });

    const notifChannel = process.env['PORTAL_NOTIFICATIONS_SLACK_CHANNEL'];
    const baseUrl = process.env['PORTAL_BASE_URL'] ?? 'http://localhost:5173';
    const threadChannel = (updated.metadata['slackChannel'] as string | undefined) ?? notifChannel;
    const threadTs = updated.metadata['slackMessageTs'] as string | undefined;
    if (threadChannel) {
      void (async () => {
        try {
          const mention = updated.requesterEmail ? await this.slack.resolveMentionByEmail(updated.requesterEmail) : null;
          await this.slack.sendToChannel(
            threadChannel,
            portalApprovalNotification({
              requestId,
              operationName: updated.operationName,
              requesterMention: mention,
              requesterName: updated.requesterName,
              approvedBy: rejectedBy,
              approved: false,
              reason,
              portalUrl: `${baseUrl}/portal/requests`,
            }),
            `Your request for ${updated.operationName} has been rejected`,
            threadTs,
          );
        } catch (e) {
          console.warn('[portal] Slack rejection notification failed:', e);
        }
      })();
    }

    return success(updated);
  }
}
