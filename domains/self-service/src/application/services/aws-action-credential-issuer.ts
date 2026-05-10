import {
  IAMClient,
  CreateRoleCommand,
  PutRolePolicyCommand,
  AttachRolePolicyCommand,
  credentialStore,
  regionStore,
} from '@wep/aws-clients';
import { type Result, success, failure, type DomainError, domainError } from '@wep/domain-types';
import type { Operation } from '../../domain/entities/operation.js';
import type { ServiceRequest } from '../../domain/entities/service-request.js';

export interface AwsActionCredentials {
  type: 'aws-action';
  /** ARN of the purpose-built IAM role created for this approval. */
  roleArn: string;
  /** Ready-to-run CLI command the requester pastes into their terminal. */
  assumeCommand: string;
  /** ISO-8601 timestamp when the role will be automatically deleted. */
  expiresAt: string;
  /** Console federation URL for one-click AWS Console access (optional). */
  consoleUrl?: string;
  /** Session name hint for the requester — appears in CloudTrail. */
  roleSessionName: string;
}

const HARD_MAX_DURATION_MINUTES = 60;   // IAM CreateRole MaxSessionDuration hard cap: 3600s
const DEFAULT_DURATION_MINUTES = 60;
const ROLE_NAME_MAX_LEN = 64;

/**
 * Issues AWS access by dynamically creating a purpose-built IAM role scoped
 * to the exact resource and actions requested. The trust policy is locked to
 * the requester's IAM ARN so only they can assume it. A cleanup tag records
 * the expiry so a background job can delete the role once it expires.
 *
 * The requester receives:
 *   - The role ARN
 *   - A ready-to-paste `aws sts assume-role` CLI command
 *   - An optional console federation URL
 *
 * The platform IAM role/user needs: iam:CreateRole, iam:PutRolePolicy, iam:TagRole.
 */
export class AwsActionCredentialIssuer {
  async issue(operation: Operation, request: ServiceRequest): Promise<Result<AwsActionCredentials, DomainError>> {
    const cfg = operation.awsAction;
    if (operation.kind !== 'aws-action' || !cfg) {
      return failure(domainError('INVALID_OPERATION', 'Operation is not configured as aws-action'));
    }
    if (!cfg.actions || cfg.actions.length === 0) {
      return failure(domainError('MISSING_ACTIONS', 'awsAction.actions must have at least one IAM action'));
    }

    const requesterArn = request.requesterAwsArn;
    if (!requesterArn) {
      return failure(domainError('MISSING_REQUESTER_ARN', 'requesterAwsArn is required to build the trust policy. Ensure SSO credentials are configured in Settings.'));
    }

    // Resolve the target resource ARN — either fixed on the operation or from a request parameter.
    const resourceArn = cfg.resourceArn ?? (cfg.resourceArnParameter ? request.parameters[cfg.resourceArnParameter] : undefined);
    if (!resourceArn) {
      return failure(domainError('MISSING_RESOURCE_ARN', 'Could not resolve resource ARN. Set awsAction.resourceArn or ensure the parameter holding the ARN is provided.'));
    }

    const durationMinutes = clampDuration(
      request.durationMinutes ?? cfg.maxDurationMinutes ?? DEFAULT_DURATION_MINUTES,
      cfg.maxDurationMinutes ?? HARD_MAX_DURATION_MINUTES,
    );

    const expiresAt = new Date(Date.now() + durationMinutes * 60_000).toISOString();
    const roleName = buildRoleName(request.requestId);
    const roleSessionName = sanitizeSessionName(request.requesterAwsUsername || request.requesterId);

    const iam = new IAMClient({
      region: regionStore.getProvider(),
      credentials: credentialStore.getProvider(),
    });

    const trustPolicy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [{
        Sid: 'WepJitTrust',
        Effect: 'Allow',
        Principal: { AWS: requesterArn },
        Action: 'sts:AssumeRole',
      }],
    });

    const policyResourceArn = sqsUrlToArn(resourceArn) ?? resourceArn;

    const inlinePolicy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [{
        Sid: 'WepJitAccess',
        Effect: 'Allow',
        Action: cfg.actions,
        Resource: policyResourceArn,
      }],
    });

    try {
      // MaxSessionDuration is a role-level cap (must be >= 3600s). The actual
      // session duration is enforced separately when the user calls AssumeRole.
      const roleMaxSessionSeconds = Math.max(3600, durationMinutes * 60);

      const createResp = await iam.send(new CreateRoleCommand({
        RoleName: roleName,
        AssumeRolePolicyDocument: trustPolicy,
        Description: `WEP JIT role for request ${request.requestId} - ${operation.name}`.replace(/[^\t\n\r\x20-\x7E\xA1-\xFF]/g, ''),
        MaxSessionDuration: roleMaxSessionSeconds,
        Tags: [
          { Key: 'Platform', Value: 'WEP' },
          { Key: 'Module', Value: 'self-service' },
          { Key: 'RequestId', Value: request.requestId },
          { Key: 'RequesterArn', Value: requesterArn },
          { Key: 'ExpiresAt', Value: expiresAt },
        ],
      }));

      const roleArn = createResp.Role?.Arn;
      if (!roleArn) {
        return failure(domainError('IAM_CREATE_FAILED', 'CreateRole succeeded but returned no ARN'));
      }

      await iam.send(new PutRolePolicyCommand({
        RoleName: roleName,
        PolicyName: 'WepJitInlinePolicy',
        PolicyDocument: inlinePolicy,
      }));

      const policiesToAttach = [
        'arn:aws:iam::aws:policy/ReadOnlyAccess',
        'arn:aws:iam::558711342920:policy/DenyIAMWriteAccess',
        'arn:aws:iam::558711342920:policy/DenyIdentyCenterAndIAMAccess',
      ];
      await Promise.all(policiesToAttach.map((PolicyArn) =>
        iam.send(new AttachRolePolicyCommand({ RoleName: roleName, PolicyArn })),
      ));

      const assumeCommand = buildAssumeCommand(roleArn, roleSessionName, durationMinutes);
      const consoleUrl = buildConsoleUrl(roleArn, roleSessionName);

      return success({
        type: 'aws-action',
        roleArn,
        assumeCommand,
        expiresAt,
        consoleUrl,
        roleSessionName,
      });
    } catch (e) {
      return failure(domainError('IAM_PROVISION_FAILED', e instanceof Error ? e.message : String(e)));
    }
  }
}

function buildRoleName(requestId: string): string {
  // Role name: wep-jit-<first 40 chars of requestId, dashes stripped>
  const suffix = requestId.replace(/-/g, '').slice(0, 40);
  return `wep-jit-${suffix}`.slice(0, ROLE_NAME_MAX_LEN);
}

function buildAssumeCommand(roleArn: string, sessionName: string, durationMinutes: number): string {
  return `aws sts assume-role --role-arn "${roleArn}" --role-session-name "${sessionName}" --duration-seconds ${durationMinutes * 60}`;
}

function buildConsoleUrl(roleArn: string, sessionName: string): string {
  const loginUrl = `https://signin.aws.amazon.com/switchrole?roleName=${encodeURIComponent(roleArn.split('/').pop() ?? '')}&account=${encodeURIComponent(roleArn.split(':')[4] ?? '')}&displayName=${encodeURIComponent(sessionName)}`;
  return loginUrl;
}

function clampDuration(requested: number, max: number): number {
  const upper = Math.min(max, HARD_MAX_DURATION_MINUTES);
  if (!Number.isFinite(requested) || requested < 1) return Math.min(DEFAULT_DURATION_MINUTES, upper);
  return Math.min(requested, upper);
}

function sanitizeSessionName(raw: string): string {
  return (raw || 'unknown').replace(/[^A-Za-z0-9=,.@_-]/g, '_').slice(0, 64) || 'unknown';
}

/**
 * Convert an SQS queue URL to its ARN equivalent.
 * https://sqs.eu-west-1.amazonaws.com/123456789012/my-queue
 *   → arn:aws:sqs:eu-west-1:123456789012:my-queue
 * Returns null when the input is not an SQS URL (i.e. already an ARN or unknown).
 */
function sqsUrlToArn(value: string): string | null {
  try {
    const u = new URL(value);
    if (!u.hostname.startsWith('sqs.')) return null;
    const region = u.hostname.split('.')[1];
    const parts = u.pathname.split('/').filter(Boolean);
    if (!region || parts.length < 2) return null;
    return `arn:aws:sqs:${region}:${parts[0]}:${parts[1]}`;
  } catch {
    return null;
  }
}
