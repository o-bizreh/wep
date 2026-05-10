import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { problemDetails } from '@wep/domain-types';
import {
  STSClient, GetCallerIdentityCommand,
  SSOAdminClient, ListInstancesCommand,
  IdentitystoreClient, GetUserIdCommand, DescribeUserCommand,
  ListGroupMembershipsForMemberCommand, DescribeGroupCommand,
} from '@wep/aws-clients';
import type { SubmitRequestHandler } from '../../application/commands/submit-request.js';
import type { ApproveRequestHandler, RejectRequestHandler } from '../../application/commands/approve-request.js';
import type { GetOperationCatalogHandler } from '../../application/queries/get-operations.js';
import type { GetRequestHistoryHandler, GetPendingApprovalsHandler } from '../../application/queries/get-requests.js';
import type { PortalRepository } from '../../domain/ports/portal-repository.js';
import type { Operation } from '../../domain/entities/operation.js';
import type { JitResource } from '../../domain/entities/jit-resource.js';
import type { WepUserProfile } from '../../domain/entities/user-profile.js';
import { RevokeJitSessionHandler } from '../../application/commands/revoke-jit-session.js';
import { GrantAwsConsoleAccessHandler, refreshConsoleUrl } from '../../application/commands/grant-aws-console-access.js';
import { SlackNotifier, awsActionCredentialDM, dbCredentialsDM } from '@wep/slack-notifier';
import type { ServiceRequest } from '../../domain/entities/service-request.js';
import type { IssuedCredentials } from '../../application/services/credential-dispatcher.js';

const slackNotifier = new SlackNotifier();

/**
 * Send issued credentials to the requester via Slack DM and discard the
 * in-memory credentials immediately afterwards. Never logs the secrets.
 */
async function deliverCredentialsDm(request: ServiceRequest, credentials: IssuedCredentials): Promise<void> {
  if (!request.requesterEmail) {
    console.warn(`[credentials-dm] No requester email on request ${request.requestId} — cannot deliver credentials`);
    return;
  }

  const baseUrl = process.env['PORTAL_BASE_URL'] ?? 'http://localhost:5173';
  const portalUrl = `${baseUrl}/portal/requests/${request.requestId}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let blocks: any[];
  let fallbackSubject: string;

  if (credentials.type === 'aws-action') {
    blocks = awsActionCredentialDM({
      operationName: request.operationName,
      parameters: request.parameters,
      roleArn: credentials.roleArn,
      assumeCommand: credentials.assumeCommand,
      roleSessionName: credentials.roleSessionName,
      expiresAt: credentials.expiresAt,
      consoleUrl: credentials.consoleUrl,
      approvalMode: request.approvalMode === 'auto' ? 'auto' : 'manual',
      autoApprovalRule: request.autoApprovalRuleDescription,
      portalRequestUrl: portalUrl,
    });
    fallbackSubject = `Your AWS access role for ${request.operationName} is ready`;
  } else {
    blocks = dbCredentialsDM({
      operationName: request.operationName,
      engine: credentials.type,
      host: credentials.host,
      port: credentials.port,
      database: credentials.database,
      username: credentials.username,
      password: credentials.password,
      expiresAt: credentials.expiresAt,
      approvalMode: request.approvalMode === 'auto' ? 'auto' : 'manual',
      autoApprovalRule: request.autoApprovalRuleDescription,
      portalRequestUrl: portalUrl,
    });
    fallbackSubject = `Your DB credentials for ${request.operationName} are ready`;
  }

  // Attempt DM first; fall back to channel mention when DM scope is missing or user not found.
  let dmDelivered = false;
  try {
    const userId = await slackNotifier.resolveUserIdByEmail(request.requesterEmail);
    if (userId) {
      await slackNotifier.sendDM(userId, blocks, fallbackSubject);
      dmDelivered = true;
    } else {
      console.warn(`[credentials-dm] Could not resolve Slack user for ${request.requesterEmail} — falling back to channel`);
    }
  } catch (e) {
    console.warn(`[credentials-dm] DM failed for ${request.requesterEmail} (${e instanceof Error ? e.message : String(e)}) — falling back to channel`);
  }

  if (!dmDelivered) {
    const notifyChannel = process.env['PORTAL_NOTIFICATIONS_SLACK_CHANNEL'];
    if (!notifyChannel) {
      console.warn('[credentials-dm] PORTAL_NOTIFICATIONS_SLACK_CHANNEL not set — credentials not delivered via Slack');
      return;
    }
    // Prepend a mention header so the requester knows this is for them.
    const header = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:wave: *Credentials for ${request.requesterEmail}* — DM delivery failed, posting here instead.`,
      },
    };
    await slackNotifier.sendToChannel(notifyChannel, [header, ...blocks], fallbackSubject);
  }
}

// Built-in catalog — shown whenever the DynamoDB table has no operations seeded yet.
// These represent the common self-service actions Washmen engineers actually need.
// Built-in operations. All current entries are runbook-kind — the built-in catalog
// is the legacy execution path. New aws-action / db-credentials operations are added
// via the manage UI by DevOps.
const DEFAULT_OPERATIONS: Operation[] = [
  {
    operationId: 'sqs-purge-queue',
    name: 'SQS Purge Queue',
    description: 'Purge all messages from an SQS queue. Use with caution — messages are permanently deleted.',
    category: 'infrastructure',
    kind: 'aws-action',
    tier: 'devops-approved',
    isEnabled: true,
    executor: 'aws-action',
    requiredPermissions: 'any-engineer',
    estimatedDuration: '~1 min',
    parameters: [
      {
        name: 'queueUrl',
        label: 'Queue URL',
        type: 'awsResourceSelector',
        required: true,
        helpText: 'Full SQS queue URL, e.g. https://sqs.eu-west-1.amazonaws.com/123456789012/my-queue',
      },
      {
        name: 'environment',
        label: 'Environment',
        type: 'environmentSelector',
        required: true,
      },
      {
        name: 'justification',
        label: 'Justification',
        type: 'string',
        required: true,
        helpText: 'Explain why this purge is necessary — recorded in the audit trail',
      },
    ],
    awsAction: {
      actions: ['sqs:PurgeQueue', 'sqs:GetQueueAttributes'],
      resourceArnParameter: 'queueUrl',
      maxDurationMinutes: 15,
    },
  },
  {
    operationId: 'sns-send-message',
    name: 'SNS Send Message',
    description: 'Publish a message to an SNS topic. Useful for triggering downstream consumers or testing event-driven flows.',
    category: 'infrastructure',
    kind: 'aws-action',
    tier: 'peer-approved',
    isEnabled: true,
    executor: 'aws-action',
    requiredPermissions: 'any-engineer',
    estimatedDuration: '~1 min',
    parameters: [
      {
        name: 'topicArn',
        label: 'Topic ARN',
        type: 'awsResourceSelector',
        required: true,
        helpText: 'ARN of the SNS topic to publish to',
      },
      {
        name: 'messageBody',
        label: 'Message body',
        type: 'string',
        required: true,
        helpText: 'JSON or plain-text payload to publish',
      },
      {
        name: 'subject',
        label: 'Subject',
        type: 'string',
        required: false,
        helpText: 'Optional subject line (email subscriptions only)',
      },
      {
        name: 'environment',
        label: 'Environment',
        type: 'environmentSelector',
        required: true,
      },
    ],
    awsAction: {
      actions: ['sns:Publish'],
      resourceArnParameter: 'topicArn',
      maxDurationMinutes: 15,
    },
  },
  {
    operationId: 'lambda-invoke',
    name: 'Lambda Invoke',
    description: 'Invoke an AWS Lambda function synchronously. Use for one-off data fixes, backfills, or manual triggers.',
    category: 'infrastructure',
    kind: 'aws-action',
    tier: 'devops-approved',
    isEnabled: true,
    executor: 'aws-action',
    requiredPermissions: 'any-engineer',
    estimatedDuration: '~2 min',
    parameters: [
      {
        name: 'functionArn',
        label: 'Function ARN',
        type: 'awsResourceSelector',
        required: true,
        helpText: 'Full ARN of the Lambda function to invoke',
      },
      {
        name: 'payload',
        label: 'Invocation payload (JSON)',
        type: 'string',
        required: false,
        helpText: 'JSON event payload passed to the function. Defaults to {} if empty.',
        defaultValue: '{}',
      },
      {
        name: 'environment',
        label: 'Environment',
        type: 'environmentSelector',
        required: true,
      },
      {
        name: 'justification',
        label: 'Justification',
        type: 'string',
        required: true,
        helpText: 'Why this invocation is needed — shown to the approver',
      },
    ],
    awsAction: {
      actions: ['lambda:InvokeFunction'],
      resourceArnParameter: 'functionArn',
      maxDurationMinutes: 15,
    },
  },
  {
    operationId: 'dynamodb-write',
    name: 'DynamoDB Write',
    description: 'Put or delete a single item in a DynamoDB table. Intended for targeted data corrections and hotfixes — not bulk mutations.',
    category: 'infrastructure',
    kind: 'aws-action',
    tier: 'devops-approved',
    isEnabled: true,
    executor: 'aws-action',
    requiredPermissions: 'any-engineer',
    estimatedDuration: '~2 min',
    parameters: [
      {
        name: 'tableArn',
        label: 'Table ARN',
        type: 'awsResourceSelector',
        required: true,
        helpText: 'ARN of the target DynamoDB table',
      },
      {
        name: 'operation',
        label: 'Operation',
        type: 'select',
        required: true,
        options: [
          { label: 'PutItem', value: 'PutItem' },
          { label: 'DeleteItem', value: 'DeleteItem' },
          { label: 'UpdateItem', value: 'UpdateItem' },
        ],
        defaultValue: 'PutItem',
      },
      {
        name: 'itemJson',
        label: 'Item / key JSON',
        type: 'string',
        required: true,
        helpText: 'JSON object in DynamoDB AttributeValue format, e.g. { "PK": { "S": "USER#123" } }',
      },
      {
        name: 'environment',
        label: 'Environment',
        type: 'environmentSelector',
        required: true,
      },
      {
        name: 'justification',
        label: 'Justification',
        type: 'string',
        required: true,
        helpText: 'Describe the data issue being corrected — included in the audit trail',
      },
    ],
    awsAction: {
      actions: ['dynamodb:PutItem', 'dynamodb:DeleteItem', 'dynamodb:UpdateItem', 'dynamodb:GetItem'],
      resourceArnParameter: 'tableArn',
      maxDurationMinutes: 30,
    },
  },
  {
    operationId: 'postgres-db-access',
    name: 'Postgres DB Access',
    description: 'Request temporary credentials for a registered Postgres database. The system creates a short-lived DB user scoped to the requested role and delivers credentials via Slack DM.',
    category: 'access',
    kind: 'db-credentials',
    tier: 'devops-approved',
    isEnabled: true,
    executor: 'db-credentials',
    requiredPermissions: 'any-engineer',
    estimatedDuration: '~5 min after approval',
    parameters: [
      {
        name: 'jitResourceId',
        label: 'Database',
        type: 'jitResourceSelector',
        required: true,
        helpText: 'Select the Postgres database you need access to. If it\'s not listed, ask DevOps to register it.',
      },
      {
        name: 'accessLevel',
        label: 'Access level',
        type: 'select',
        required: true,
        options: [
          { label: 'Read only',    value: 'readonly' },
          { label: 'Read + Write', value: 'readwrite' },
        ],
        defaultValue: 'readonly',
      },
      {
        name: 'durationMinutes',
        label: 'Access duration',
        type: 'select',
        required: true,
        options: [
          { label: '30 minutes', value: '30' },
          { label: '1 hour',     value: '60' },
          { label: '2 hours',    value: '120' },
          { label: '4 hours',    value: '240' },
        ],
        defaultValue: '60',
      },
      {
        name: 'justification',
        label: 'Business justification',
        type: 'string',
        required: true,
        helpText: 'Explain why you need access — shown to the approver and recorded in the audit trail',
      },
    ],
    dbCredentials: {
      jitResourceId: '',
      allowedRoles: ['readonly', 'readwrite'],
      maxDurationMinutes: 240,
    },
  },
  {
    operationId: 'redshift-db-access',
    name: 'Redshift DB Access',
    description: 'Request temporary credentials for a registered Redshift cluster. The system issues short-lived DB user credentials scoped to the requested user and delivers them via Slack DM.',
    category: 'access',
    kind: 'db-credentials',
    tier: 'devops-approved',
    isEnabled: true,
    executor: 'db-credentials',
    requiredPermissions: 'any-engineer',
    estimatedDuration: '~5 min after approval',
    parameters: [
      {
        name: 'jitResourceId',
        label: 'Redshift cluster',
        type: 'jitResourceSelector',
        required: true,
        helpText: 'Select the Redshift cluster you need access to. If it\'s not listed, ask DevOps to register it.',
      },
      {
        name: 'dbUser',
        label: 'DB user',
        type: 'select',
        required: true,
        options: [
          { label: 'readonly',    value: 'readonly' },
          { label: 'readwrite',   value: 'readwrite' },
        ],
        defaultValue: 'readonly',
      },
      {
        name: 'durationMinutes',
        label: 'Access duration',
        type: 'select',
        required: true,
        options: [
          { label: '30 minutes', value: '30' },
          { label: '1 hour',     value: '60' },
          { label: '2 hours',    value: '120' },
          { label: '4 hours',    value: '240' },
        ],
        defaultValue: '60',
      },
      {
        name: 'justification',
        label: 'Business justification',
        type: 'string',
        required: true,
        helpText: 'Explain why you need access — shown to the approver and recorded in the audit trail',
      },
    ],
    dbCredentials: {
      jitResourceId: '',
      allowedRoles: ['readonly', 'readwrite'],
      maxDurationMinutes: 240,
    },
  },
];

export interface PortalRouteHandlers {
  submitRequest: SubmitRequestHandler;
  approveRequest: ApproveRequestHandler;
  rejectRequest: RejectRequestHandler;
  getOperations: GetOperationCatalogHandler;
  getRequestHistory: GetRequestHistoryHandler;
  getPendingApprovals: GetPendingApprovalsHandler;
  portalRepo: PortalRepository;
}

// ---------------------------------------------------------------------------
// Per-request identity resolution via STS GetCallerIdentity
// ---------------------------------------------------------------------------

interface CallerIdentity {
  /** SSO username, e.g. "omar" */
  username: string;
  /** Full email derived from username + email domain, e.g. "omar@washmen.com" */
  email: string;
  /** IAM role name segment, e.g. "AWSReservedSSO_DevOps_abc123" */
  roleName: string;
  /** Whether this caller's role matches the configured DevOps pattern */
  isDevOps: boolean;
  /** Full caller ARN from STS, e.g. arn:aws:sts::123:assumed-role/Role/username */
  arn: string;
}

/**
 * In-process cache: accessKeyId → { identity, cachedAt }.
 * TTL = 5 minutes — short enough to pick up session changes, long enough to avoid
 * calling STS on every API request.
 */
const identityCache = new Map<string, { identity: CallerIdentity; cachedAt: number }>();
const IDENTITY_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Resolve the caller's identity from the AWS credential headers forwarded by
 * the frontend. Calls STS GetCallerIdentity with those credentials and parses
 * the returned ARN.
 *
 * ARN format for IAM Identity Center (SSO):
 *   arn:aws:sts::ACCOUNT:assumed-role/AWSReservedSSO_DevOps_HASH/USERNAME
 *
 * USERNAME is the SSO username (e.g. "omar"). Email is USERNAME@<WEP_EMAIL_DOMAIN>.
 *
 * Returns null if no credentials are provided or the STS call fails.
 */
async function resolveCallerIdentity(req: Request): Promise<CallerIdentity | null> {
  const accessKeyId     = req.headers['x-aws-access-key-id'] as string | undefined;
  const secretAccessKey = req.headers['x-aws-secret-access-key'] as string | undefined;
  const sessionToken    = req.headers['x-aws-session-token'] as string | undefined;

  if (!accessKeyId || !secretAccessKey) return null;

  // Check cache first
  const cached = identityCache.get(accessKeyId);
  if (cached && Date.now() - cached.cachedAt < IDENTITY_CACHE_TTL_MS) {
    return cached.identity;
  }

  try {
    const stsClient = new STSClient({
      region: process.env['AWS_REGION'] ?? 'eu-west-1',
      credentials: {
        accessKeyId,
        secretAccessKey,
        sessionToken,
      },
    });

    const resp = await stsClient.send(new GetCallerIdentityCommand({}));
    const arn = resp.Arn ?? '';

    // Parse: arn:aws:sts::ACCOUNT:assumed-role/ROLE_NAME/SESSION_NAME
    const roleMatch = /assumed-role\/([^/]+)\/(.+)$/.exec(arn);
    // Fallback: arn:aws:iam::ACCOUNT:user/USERNAME
    const userMatch = /user\/(.+)$/.exec(arn);

    const username = roleMatch?.[2] ?? userMatch?.[1] ?? arn.split(':').pop() ?? 'unknown';
    const roleName = roleMatch?.[1] ?? 'iam-user';

    const emailDomain = process.env['WEP_EMAIL_DOMAIN'] ?? 'washmen.com';
    const email = `${username}@${emailDomain}`;

    // DevOps detection: role name contains the configured pattern (default: "DevOps")
    const devopsPattern = process.env['DEVOPS_ROLE_PATTERN'] ?? 'DevOps';
    const isDevOpsUser = roleName.includes(devopsPattern);

    const identity: CallerIdentity = { username, email, roleName, isDevOps: isDevOpsUser, arn };
    identityCache.set(accessKeyId, { identity, cachedAt: Date.now() });
    return identity;
  } catch {
    // Credentials invalid or STS unreachable — deny
    return null;
  }
}

/**
 * Looks the caller up in IAM Identity Center via the Identity Store API and
 * returns whichever SCIM-style attributes are populated for them. The caller's
 * own SSO credentials are used, so they must have permission to call
 * `sso-admin:ListInstances` and `identitystore:DescribeUser`/`GetUserId`/
 * `ListGroupMembershipsForMember`/`DescribeGroup`.
 */
interface IdentityStoreLookup {
  userId: string;
  userName: string;
  displayName: string | null;
  title: string | null;
  awsUserType: string | null; // SCIM `userType` attribute (e.g. "Employee")
  emails: string[];
  groups: string[];
}

const identityStoreCache = new Map<string, { lookup: IdentityStoreLookup; cachedAt: number }>();
const IDENTITY_STORE_CACHE_TTL_MS = 5 * 60 * 1000;

async function resolveIdentityStoreUser(req: Request, email: string): Promise<IdentityStoreLookup | null> {
  const accessKeyId     = req.headers['x-aws-access-key-id'] as string | undefined;
  const secretAccessKey = req.headers['x-aws-secret-access-key'] as string | undefined;
  const sessionToken    = req.headers['x-aws-session-token'] as string | undefined;
  if (!accessKeyId || !secretAccessKey) return null;

  const cacheKey = `${accessKeyId}::${email}`;
  const cached = identityStoreCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < IDENTITY_STORE_CACHE_TTL_MS) {
    return cached.lookup;
  }

  // IAM Identity Center is available in the home region only — use SSO_REGION
  // env var when set, otherwise fall back to AWS_REGION / eu-west-1.
  const region = process.env['SSO_REGION'] ?? process.env['AWS_REGION'] ?? 'eu-west-1';
  const credentials = { accessKeyId, secretAccessKey, sessionToken };

  try {
    const ssoAdmin = new SSOAdminClient({ region, credentials });
    const ids      = new IdentitystoreClient({ region, credentials });

    const instances = await ssoAdmin.send(new ListInstancesCommand({}));
    const identityStoreId = instances.Instances?.[0]?.IdentityStoreId;
    if (!identityStoreId) return null;

    // Look up the SCIM user by their userName attribute (typically the email).
    // SSO directories vary — some store the bare username, others the full email.
    let userId: string | undefined;
    for (const candidate of [email, email.split('@')[0] ?? email]) {
      try {
        const r = await ids.send(new GetUserIdCommand({
          IdentityStoreId: identityStoreId,
          AlternateIdentifier: { UniqueAttribute: { AttributePath: 'userName', AttributeValue: candidate } },
        }));
        if (r.UserId) { userId = r.UserId; break; }
      } catch { /* try next variant */ }
    }
    if (!userId) return null;

    const userResp = await ids.send(new DescribeUserCommand({ IdentityStoreId: identityStoreId, UserId: userId }));

    // Group memberships → group display names.
    const groups: string[] = [];
    try {
      let nextToken: string | undefined;
      const groupIds: string[] = [];
      do {
        const m = await ids.send(new ListGroupMembershipsForMemberCommand({
          IdentityStoreId: identityStoreId,
          MemberId: { UserId: userId },
          NextToken: nextToken,
        }));
        for (const g of m.GroupMemberships ?? []) {
          if (g.GroupId) groupIds.push(g.GroupId);
        }
        nextToken = m.NextToken;
      } while (nextToken);
      for (const groupId of groupIds) {
        try {
          const g = await ids.send(new DescribeGroupCommand({ IdentityStoreId: identityStoreId, GroupId: groupId }));
          if (g.DisplayName) groups.push(g.DisplayName);
        } catch { /* skip */ }
      }
    } catch { /* groups optional */ }

    const lookup: IdentityStoreLookup = {
      userId,
      userName: userResp.UserName ?? email,
      displayName: userResp.DisplayName ?? null,
      title: userResp.Title ?? null,
      awsUserType: userResp.UserType ?? null,
      emails: (userResp.Emails ?? []).map((e) => e.Value).filter((v): v is string => !!v),
      groups,
    };
    identityStoreCache.set(cacheKey, { lookup, cachedAt: Date.now() });
    return lookup;
  } catch {
    return null;
  }
}

/** Express middleware — rejects with 401/403 if the caller cannot be verified as DevOps. */
async function devopsOnly(req: Request, res: Response, next: NextFunction): Promise<void> {
  const identity = await resolveCallerIdentity(req);
  if (!identity) {
    res.status(401).json(problemDetails(401, 'Unauthorized',
      'Valid AWS credentials are required. Add your SSO session keys in Settings.',
    ));
    return;
  }
  if (!identity.isDevOps) {
    res.status(403).json(problemDetails(403, 'Forbidden',
      `This action requires the DevOps role. Your current role: ${identity.roleName}`,
    ));
    return;
  }
  next();
}

export function createPortalRouter(handlers: PortalRouteHandlers): Router {
  const router = Router();

  // GET /portal/auth/role — resolves the caller's identity via STS and returns their portal role.
  // Frontend uses this to gate DevOps-only UI elements and to display the logged-in user.
  router.get('/auth/role', async (req: Request, res: Response) => {
    const identity = await resolveCallerIdentity(req);
    if (!identity) {
      // No credentials configured — treat as anonymous engineer
      res.json({ username: null, email: null, role: 'engineer', roleName: null });
      return;
    }
    res.json({
      username: identity.username,
      email:    identity.email,
      role:     identity.isDevOps ? 'devops' : 'engineer',
      roleName: identity.roleName,
    });
  });

  // GET /portal/profile/me — the caller's stored department/userType/awsUsername.
  router.get('/profile/me', async (req: Request, res: Response) => {
    const identity = await resolveCallerIdentity(req);
    if (!identity) { res.status(401).json(problemDetails(401, 'Unauthorized', 'No SSO credentials configured.')); return; }
    const result = await handlers.portalRepo.getUserProfile(identity.email);
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Error', result.error.message)); return; }
    if (!result.value) {
      // Return a stub so the frontend form can render with empty fields.
      res.json({ email: identity.email, source: 'manual', updatedAt: '', updatedBy: identity.email } satisfies WepUserProfile);
      return;
    }
    res.json(result.value);
  });

  // PUT /portal/profile/me — user self-declares their department/userType/awsUsername.
  router.put('/profile/me', async (req: Request, res: Response) => {
    const identity = await resolveCallerIdentity(req);
    if (!identity) { res.status(401).json(problemDetails(401, 'Unauthorized', 'No SSO credentials configured.')); return; }
    const body = req.body as Partial<WepUserProfile>;
    const profile: WepUserProfile = {
      email: identity.email,
      displayName: body.displayName ?? identity.username,
      department: typeof body.department === 'string' && body.department.trim() ? body.department.trim() : undefined,
      userType: typeof body.userType === 'string' && body.userType.trim() ? body.userType.trim() : undefined,
      awsUsername: typeof body.awsUsername === 'string' && body.awsUsername.trim() ? body.awsUsername.trim() : identity.username,
      source: 'manual',
      updatedAt: new Date().toISOString(),
      updatedBy: identity.email,
    };
    const result = await handlers.portalRepo.saveUserProfile(profile);
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Error', result.error.message)); return; }
    res.json(profile);
  });

  // POST /portal/profile/auto-resolve — pulls the caller's IAM Identity Center
  // profile (Title, UserType, group memberships) and persists what it can derive.
  // Falls back gracefully when the caller's SSO permission set lacks
  // `identitystore:*` / `sso-admin:ListInstances` permissions.
  router.post('/profile/auto-resolve', async (req: Request, res: Response) => {
    const identity = await resolveCallerIdentity(req);
    if (!identity) { res.status(401).json(problemDetails(401, 'Unauthorized', 'No SSO credentials configured.')); return; }

    const lookup = await resolveIdentityStoreUser(req, identity.email);
    if (!lookup) {
      res.status(200).json({
        resolved: false,
        reason: 'IAM Identity Center lookup failed. Your SSO session may not have permission to call sso-admin:ListInstances or identitystore:DescribeUser, or your username does not match a SCIM user attribute.',
        identity: { email: identity.email, username: identity.username, roleName: identity.roleName },
      });
      return;
    }

    const userType   = lookup.title ?? lookup.awsUserType ?? null;
    const displayName = lookup.displayName ?? identity.username;
    const awsUsername = identity.username;

    // Department is intentionally NOT auto-filled — IAM Identity Center group
    // names don't map cleanly to departments, and IAM policies catch wrong
    // values anyway. The user enters their department manually.
    const existing = await handlers.portalRepo.getUserProfile(identity.email);
    const previousProfile = existing.ok ? existing.value : null;
    const profile: WepUserProfile = {
      email: identity.email,
      displayName,
      department: previousProfile?.department,
      userType: userType ?? previousProfile?.userType,
      awsUsername,
      source: 'identitystore',
      updatedAt: new Date().toISOString(),
      updatedBy: identity.email,
    };
    const saved = await handlers.portalRepo.saveUserProfile(profile);
    if (!saved.ok) { res.status(500).json(problemDetails(500, 'Error', saved.error.message)); return; }

    res.json({
      resolved: true,
      profile,
      identityStore: {
        title: lookup.title,
        userType: lookup.awsUserType,
        displayName: lookup.displayName,
        groups: lookup.groups,
      },
    });
  });

  router.get('/operations', async (_req: Request, res: Response) => {
    const result = await handlers.getOperations.execute();
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Error', result.error.message)); return; }
    // Merge: custom operations stored in DynamoDB take precedence over defaults with the same ID.
    const dbOps = result.value as Operation[];
    const dbIds = new Set(dbOps.map((op) => op.operationId));
    const merged = [...dbOps, ...DEFAULT_OPERATIONS.filter((op) => !dbIds.has(op.operationId))];
    res.json(merged);
  });

  router.get('/operations/:operationId', async (req: Request, res: Response) => {
    const result = await handlers.portalRepo.getOperation(String(req.params['operationId']));
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Error', result.error.message)); return; }
    if (!result.value) { res.status(404).json(problemDetails(404, 'Not Found', 'Operation not found')); return; }
    res.json(result.value);
  });

  // POST /portal/operations — create a new custom operation (DevOps only)
  router.post('/operations', devopsOnly, async (req: Request, res: Response) => {
    const body = req.body as Partial<Operation>;
    if (!body.operationId || !body.name || !body.category || !body.tier) {
      res.status(400).json(problemDetails(400, 'Invalid Body', 'operationId, name, category, and tier are required'));
      return;
    }
    const op: Operation = {
      operationId: body.operationId,
      name: body.name,
      description: body.description ?? '',
      category: body.category as Operation['category'],
      kind: (body.kind ?? 'runbook') as Operation['kind'],
      tier: body.tier as Operation['tier'],
      isEnabled: body.isEnabled ?? true,
      executor: body.executor ?? '',
      requiredPermissions: body.requiredPermissions ?? 'any-engineer',
      estimatedDuration: body.estimatedDuration ?? '',
      parameters: body.parameters ?? [],
      awsAction: body.awsAction,
      dbCredentials: body.dbCredentials,
      autoApproval: body.autoApproval,
    };
    const result = await handlers.portalRepo.saveOperation(op);
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Error', result.error.message)); return; }
    res.status(201).json(op);
  });

  // PUT /portal/operations/:operationId — update an existing operation (DevOps only)
  router.put('/operations/:operationId', devopsOnly, async (req: Request, res: Response) => {
    const operationId = String(req.params['operationId']);
    const body = req.body as Partial<Operation>;
    // Build from defaults (could be a default op) merged with body
    const existing = DEFAULT_OPERATIONS.find((o) => o.operationId === operationId);
    const op: Operation = {
      operationId,
      name: body.name ?? existing?.name ?? '',
      description: body.description ?? existing?.description ?? '',
      category: (body.category ?? existing?.category ?? 'configuration') as Operation['category'],
      kind: (body.kind ?? existing?.kind ?? 'runbook') as Operation['kind'],
      tier: (body.tier ?? existing?.tier ?? 'self-serve') as Operation['tier'],
      isEnabled: body.isEnabled ?? existing?.isEnabled ?? true,
      executor: body.executor ?? existing?.executor ?? '',
      requiredPermissions: body.requiredPermissions ?? existing?.requiredPermissions ?? 'any-engineer',
      estimatedDuration: body.estimatedDuration ?? existing?.estimatedDuration ?? '',
      parameters: body.parameters ?? existing?.parameters ?? [],
      awsAction: body.awsAction ?? existing?.awsAction,
      dbCredentials: body.dbCredentials ?? existing?.dbCredentials,
      autoApproval: body.autoApproval ?? existing?.autoApproval,
    };
    const result = await handlers.portalRepo.saveOperation(op);
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Error', result.error.message)); return; }
    res.json(op);
  });

  // DELETE /portal/operations/:operationId — remove a custom operation (DevOps only)
  router.delete('/operations/:operationId', devopsOnly, async (req: Request, res: Response) => {
    const operationId = String(req.params['operationId']);
    const result = await handlers.portalRepo.deleteOperation(operationId);
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Error', result.error.message)); return; }
    res.status(204).end();
  });

  router.post('/requests', async (req: Request, res: Response) => {
    // Default operations live only in memory. Always write the latest in-memory
    // version to DynamoDB before submitting — this keeps seeded defaults in sync
    // with code changes (e.g. new awsAction shape) without a migration step.
    // Custom DevOps-created operations (not in DEFAULT_OPERATIONS) are untouched.
    const operationType = req.body.operationType as string;
    const defaultOp = DEFAULT_OPERATIONS.find((op) => op.operationId === operationType);
    if (defaultOp) await handlers.portalRepo.saveOperation(defaultOp);

    // Resolve the caller's ARN from their SSO credentials so we can scope
    // dynamic IAM role trust policies to exactly this identity.
    const submitterIdentity = await resolveCallerIdentity(req);

    const result = await handlers.submitRequest.execute({
      operationType: req.body.operationType,
      requesterId: req.body.requesterId ?? 'anonymous',
      requesterName: req.body.requesterName ?? 'Anonymous',
      requesterEmail: req.body.requesterEmail ?? null,
      requesterTeamId: req.body.requesterTeamId ?? '',
      requesterAwsUsername: req.body.requesterAwsUsername ?? submitterIdentity?.username,
      requesterAwsArn: submitterIdentity?.arn,
      serviceId: req.body.serviceId,
      parameters: req.body.parameters ?? {},
      durationMinutes: req.body.durationMinutes,
      justification: req.body.justification,
    });
    if (!result.ok) {
      const status = result.error.code === 'OPERATION_NOT_FOUND' ? 404 : 400;
      res.status(status).json(problemDetails(status, result.error.code, result.error.message));
      return;
    }
    // Auto-approved + credentialed responses include `credentials`. Manual ones
    // do not — caller should poll or wait on the approval Slack message.
    if (result.value.credentials && result.value.request.requesterEmail) {
      void deliverCredentialsDm(result.value.request, result.value.credentials).catch((e) =>
        console.warn('[portal] DM delivery failed:', e),
      );
    }
    res.status(201).json({ request: result.value.request, credentials: result.value.credentials });
  });

  router.get('/requests', async (req: Request, res: Response) => {
    const result = await handlers.getRequestHistory.execute(
      { requesterId: req.query['requesterId'] as string | undefined, status: req.query['status'] as 'submitted' | undefined },
      { limit: parseInt(req.query['limit'] as string, 10) || 20, cursor: req.query['cursor'] as string | undefined },
    );
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Error', result.error.message)); return; }
    res.json(result.value);
  });

  router.get('/requests/all', async (_req: Request, res: Response) => {
    const result = await handlers.portalRepo.listAllRequests({ limit: 100 });
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Error', result.error.message)); return; }
    res.json(result.value.items ?? []);
  });

  router.get('/requests/:requestId', async (req: Request, res: Response) => {
    const result = await handlers.portalRepo.getRequest(String(req.params['requestId']));
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Error', result.error.message)); return; }
    if (!result.value) { res.status(404).json(problemDetails(404, 'Not Found', 'Request not found')); return; }
    res.json(result.value);
  });

  router.post('/requests/:requestId/approve', devopsOnly, async (req: Request, res: Response) => {
    const requestId = String(req.params['requestId']);
    // Identity already verified by devopsOnly middleware — resolve again to get email for audit log
    const identity = await resolveCallerIdentity(req);
    const approverId = identity?.email ?? req.body.approverId ?? 'devops';
    const result = await handlers.approveRequest.execute(requestId, approverId);
    if (!result.ok) { res.status(400).json(problemDetails(400, result.error.code, result.error.message)); return; }

    // After approval, trigger the appropriate grant handler based on operation type
    const approved = result.value.request;
    const credentials = result.value.credentials;

    if (credentials && approved.requesterEmail) {
      void deliverCredentialsDm(approved, credentials).catch((e) =>
        console.warn('[portal] DM delivery failed:', e),
      );
    }
    res.json({ request: approved, credentials });
  });

  router.post('/requests/:requestId/reject', devopsOnly, async (req: Request, res: Response) => {
    const identity = await resolveCallerIdentity(req);
    const rejectedBy = identity?.email ?? 'devops';
    const result = await handlers.rejectRequest.execute(String(req.params['requestId']), rejectedBy, req.body.reason ?? '');
    if (!result.ok) { res.status(400).json(problemDetails(400, result.error.code, result.error.message)); return; }
    res.json(result.value);
  });

  // --- JIT Resource CRUD ---

  router.get('/jit-resources', async (_req: Request, res: Response) => {
    const result = await handlers.portalRepo.listJitResources();
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Error', result.error.message)); return; }
    res.json(result.value);
  });

  router.post('/jit-resources', devopsOnly, async (req: Request, res: Response) => {
    const body = req.body as Partial<JitResource>;
    if (!body.name || !body.type || !body.environment || !body.region) {
      res.status(400).json(problemDetails(400, 'Invalid Body', 'name, type, environment, and region are required'));
      return;
    }
    const now = new Date().toISOString();
    const resource: JitResource = {
      resourceId: body.resourceId ?? randomUUID(),
      type: body.type,
      name: body.name,
      environment: body.environment,
      region: body.region,
      isEnabled: body.isEnabled ?? true,
      notes: body.notes,
      maxDurationMinutes: body.maxDurationMinutes,
      host: body.host,
      port: body.port,
      dbName: body.dbName,
      masterSecretId: body.masterSecretId,
      postgresAuth: body.postgresAuth,
      allowedPostgresRoles: body.allowedPostgresRoles,
      clusterIdentifier: body.clusterIdentifier,
      iamRoleArn: body.iamRoleArn,
      allowedDbUsers: body.allowedDbUsers,
      instanceId: body.instanceId,
      bastionHost: body.bastionHost,
      createdAt: now,
      updatedAt: now,
    };
    const result = await handlers.portalRepo.saveJitResource(resource);
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Error', result.error.message)); return; }
    res.status(201).json(resource);
  });

  router.put('/jit-resources/:resourceId', devopsOnly, async (req: Request, res: Response) => {
    const resourceId = String(req.params['resourceId']);
    const existing = await handlers.portalRepo.getJitResource(resourceId);
    if (!existing.ok) { res.status(500).json(problemDetails(500, 'Error', existing.error.message)); return; }
    if (!existing.value) { res.status(404).json(problemDetails(404, 'Not Found', 'JIT resource not found')); return; }
    const body = req.body as Partial<JitResource>;
    const resource: JitResource = { ...existing.value, ...body, resourceId, updatedAt: new Date().toISOString() };
    const result = await handlers.portalRepo.saveJitResource(resource);
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Error', result.error.message)); return; }
    res.json(resource);
  });

  router.delete('/jit-resources/:resourceId', devopsOnly, async (req: Request, res: Response) => {
    const result = await handlers.portalRepo.deleteJitResource(String(req.params['resourceId']));
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Error', result.error.message)); return; }
    res.status(204).end();
  });

  // --- JIT Session management ---

  // GET /jit-sessions/mine — sessions for the currently authenticated user (resolved via STS).
  // Must be registered before /jit-sessions/:sessionId so Express doesn't treat "mine" as an ID.
  router.get('/jit-sessions/mine', async (req: Request, res: Response) => {
    const identity = await resolveCallerIdentity(req);
    if (!identity) {
      res.status(401).json(problemDetails(401, 'Unauthorized', 'Add your AWS SSO credentials in Settings to view your sessions'));
      return;
    }
    // Use the email as the requesterId — it is stored on the session at grant time
    const result = await handlers.portalRepo.listJitSessionsByRequester(identity.email);
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Error', result.error.message)); return; }

    // Enrich each session with the originating ServiceRequest's approval mode +
    // the auto-approval rule that fired. Done in parallel; missing requests
    // (e.g., DM-only or test sessions) just return the raw session.
    const enriched = await Promise.all(result.value.map(async (s) => {
      if (!s.requestId) return s;
      const r = await handlers.portalRepo.getRequest(s.requestId);
      if (!r.ok || !r.value) return s;
      return {
        ...s,
        approvalMode: r.value.approvalMode,
        autoApprovalRuleDescription: r.value.autoApprovalRuleDescription,
        operationName: r.value.operationName,
      };
    }));

    res.json(enriched);
  });

  // GET /jit-sessions — kept for backwards compat; requires explicit requesterId query param
  router.get('/jit-sessions', async (req: Request, res: Response) => {
    const requesterId = req.query['requesterId'] as string | undefined;
    if (!requesterId) { res.status(400).json(problemDetails(400, 'Bad Request', 'requesterId query param required')); return; }
    const result = await handlers.portalRepo.listJitSessionsByRequester(requesterId);
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Error', result.error.message)); return; }
    res.json(result.value);
  });

  router.get('/jit-sessions/:sessionId', async (req: Request, res: Response) => {
    const result = await handlers.portalRepo.getJitSession(String(req.params['sessionId']));
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Error', result.error.message)); return; }
    if (!result.value) { res.status(404).json(problemDetails(404, 'Not Found', 'JIT session not found')); return; }
    res.json(result.value);
  });

  router.post('/jit-sessions/:sessionId/revoke', async (req: Request, res: Response) => {
    const sessionId = String(req.params['sessionId']);
    const revokedBy = (req.body.revokedBy as string | undefined) ?? 'anonymous';
    const revokeHandler = new RevokeJitSessionHandler(handlers.portalRepo);
    const result = await revokeHandler.execute(sessionId, revokedBy);
    if (!result.ok) { res.status(400).json(problemDetails(400, result.error.code, result.error.message)); return; }
    res.status(204).end();
  });

  // GET /jit-sessions/:sessionId/console-url
  // Fetches STS credentials from Secrets Manager and returns a fresh federation sign-in URL.
  // Safe to call multiple times — each call generates a new 15-minute sign-in window.
  router.get('/jit-sessions/:sessionId/console-url', async (req: Request, res: Response) => {
    const sessionId = String(req.params['sessionId']);
    const sessionResult = await handlers.portalRepo.getJitSession(sessionId);
    if (!sessionResult.ok) { res.status(500).json(problemDetails(500, 'Error', sessionResult.error.message)); return; }
    if (!sessionResult.value) { res.status(404).json(problemDetails(404, 'Not Found', 'JIT session not found')); return; }

    const session = sessionResult.value;
    if (session.sessionType !== 'aws-console') {
      res.status(400).json(problemDetails(400, 'Bad Request', 'This session is not an AWS Console session'));
      return;
    }
    if (session.status !== 'active') {
      res.status(410).json(problemDetails(410, 'Gone', `Session is ${session.status}`));
      return;
    }
    if (!session.credentialsSecretId || !session.awsService || !session.awsResourceArn) {
      res.status(500).json(problemDetails(500, 'Error', 'Session is missing credential metadata'));
      return;
    }

    const remainingSeconds = Math.floor(
      (new Date(session.expiresAt).getTime() - Date.now()) / 1000,
    );
    if (remainingSeconds <= 0) {
      res.status(410).json(problemDetails(410, 'Gone', 'Session has expired'));
      return;
    }

    try {
      const consoleUrl = await refreshConsoleUrl(
        session.credentialsSecretId!,
        session.awsResourceArn!,
        // SessionDuration must be between 900 and 43200 (max 12h) and ≤ STS credential duration
        Math.min(Math.max(remainingSeconds, 900), 43200),
      );
      res.json({
        consoleUrl,
        awsService:     session.awsService,
        awsResourceArn: session.awsResourceArn,
        awsAction:      session.awsAction,
        expiresAt:      session.expiresAt,
      });
    } catch (e) {
      res.status(500).json(problemDetails(500, 'Error', `Could not generate console URL: ${e instanceof Error ? e.message : String(e)}`));
    }
  });

  router.get('/approvals/pending', async (req: Request, res: Response) => {
    const approverId = req.query['approverId'] as string ?? 'anonymous';
    const result = await handlers.getPendingApprovals.execute(approverId);
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Error', result.error.message)); return; }
    res.json(result.value);
  });

  return router;
}
