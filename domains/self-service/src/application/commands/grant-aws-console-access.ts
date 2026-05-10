import { randomUUID } from 'node:crypto';
import * as https from 'node:https';
import {
  type Result, success, failure, domainError, type DomainError,
} from '@wep/domain-types';
import {
  STSClient, AssumeRoleCommand,
  SecretsManagerClient, CreateSecretCommand, DeleteSecretCommand, GetSecretValueCommand,
  regionStore,
} from '@wep/aws-clients';
import { SlackNotifier, awsAccessGranted } from '@wep/slack-notifier';
import type { PortalRepository } from '../../domain/ports/portal-repository.js';
import type { JitSession } from '../../domain/entities/jit-session.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AWS_ACTIONS: Record<string, string> = {
  lambda:   'lambda:InvokeFunction',
  sns:      'sns:Publish',
  sqs:      'sqs:SendMessage',
  dynamodb: 'dynamodb:PutItem',
};

const MAX_DURATION_HOURS = 4;

// ---------------------------------------------------------------------------
// Input / Output
// ---------------------------------------------------------------------------

export interface GrantAwsConsoleAccessInput {
  requestId: string;
  requesterId: string;
  requesterEmail: string | null;
  /** Full resource ARN (or SQS queue URL). Service is inferred from the ARN prefix. */
  awsResourceArn: string;
  durationHours: number;
}

/**
 * Infer the AWS service key from an ARN or SQS queue URL.
 * arn:aws:lambda:… → 'lambda'
 * arn:aws:sns:…    → 'sns'
 * arn:aws:sqs:…    → 'sqs'
 * arn:aws:dynamodb:… → 'dynamodb'
 * https://sqs.…   → 'sqs'
 */
export function inferServiceFromArn(arn: string): string | null {
  if (arn.startsWith('https://sqs.')) return 'sqs';
  const match = /^arn:aws(?:-[a-z]+)?:([^:]+):/.exec(arn);
  if (!match) return null;
  const svc = match[1]!;
  // dynamodb ARNs contain 'dynamodb', lambda contains 'lambda', etc.
  if (svc === 'lambda' || svc === 'sns' || svc === 'sqs' || svc === 'dynamodb') return svc;
  return null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const regionProvider = regionStore.getProvider();
const stsClient = new STSClient({ region: regionProvider });
const smClient  = new SecretsManagerClient({ region: regionProvider });

/**
 * Derive SQS ARN from queue URL.
 * URL:  https://sqs.{region}.amazonaws.com/{account}/{name}
 * ARN:  arn:aws:sqs:{region}:{account}:{name}
 */
function sqsUrlToArn(urlOrArn: string): string {
  if (urlOrArn.startsWith('arn:')) return urlOrArn;
  try {
    const url  = new URL(urlOrArn);
    const parts = url.pathname.split('/').filter(Boolean); // [account, queueName]
    const rgn  = url.hostname.split('.')[1] ?? regionStore.get();
    return `arn:aws:sqs:${rgn}:${parts[0]}:${parts[1]}`;
  } catch {
    return urlOrArn;
  }
}

function normaliseArn(service: string, rawArn: string): string {
  return service === 'sqs' ? sqsUrlToArn(rawArn) : rawArn;
}

/** Friendly display name from ARN or URL */
function resourceDisplayName(service: string, rawArn: string): string {
  const arn = normaliseArn(service, rawArn);
  return arn.split(/[/:]/g).pop() ?? arn;
}

/** Build the AWS Console deep-link for the resource. */
function buildDestination(service: string, arn: string): string {
  const rgn = regionStore.get();
  const base = `https://${rgn}.console.aws.amazon.com`;
  const name = arn.split(/[/:]/g).pop() ?? arn;

  if (service === 'lambda') {
    return `${base}/lambda/home?region=${rgn}#/functions/${name}?tab=testing`;
  }
  if (service === 'sns') {
    return `${base}/sns/v3/home?region=${rgn}#/topic/${arn}`;
  }
  if (service === 'sqs') {
    // Convert ARN back to URL for the console link
    // ARN: arn:aws:sqs:region:account:name
    const parts = arn.split(':');
    const queueUrl = `https://sqs.${parts[3]}.amazonaws.com/${parts[4]}/${parts[5]}`;
    return `${base}/sqs/v3/home?region=${rgn}#/queues/${encodeURIComponent(queueUrl)}`;
  }
  if (service === 'dynamodb') {
    // ARN: arn:aws:dynamodb:region:account:table/name
    const tableName = arn.split('/').pop() ?? name;
    return `${base}/dynamodbv2/home?region=${rgn}#/tables/${tableName}/items`;
  }
  return `${base}/console/home?region=${rgn}`;
}

/** Call the AWS federation sign-in endpoint and return a console login URL. */
async function buildConsoleUrl(
  credentials: { accessKeyId: string; secretAccessKey: string; sessionToken: string },
  destination: string,
  durationSeconds: number,
): Promise<string> {
  const session = JSON.stringify({
    sessionId:    credentials.accessKeyId,
    sessionKey:   credentials.secretAccessKey,
    sessionToken: credentials.sessionToken,
  });

  const tokenEndpoint =
    `https://signin.aws.amazon.com/federation` +
    `?Action=getSigninToken` +
    `&SessionDuration=${durationSeconds}` +
    `&Session=${encodeURIComponent(session)}`;

  const rawBody = await new Promise<string>((resolve, reject) => {
    https.get(tokenEndpoint, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });

  const { SigninToken } = JSON.parse(rawBody) as { SigninToken: string };

  const issuer = process.env['PORTAL_BASE_URL'] ?? 'https://wep.washmen.com';
  const loginUrl = new URL('https://signin.aws.amazon.com/federation');
  loginUrl.searchParams.set('Action', 'login');
  loginUrl.searchParams.set('Issuer', issuer);
  loginUrl.searchParams.set('Destination', destination);
  loginUrl.searchParams.set('SigninToken', SigninToken);
  return loginUrl.toString();
}

/** Fetch STS credentials from Secrets Manager and return a fresh console URL. */
export async function refreshConsoleUrl(
  credentialsSecretId: string,
  awsResourceArn: string,
  durationSeconds: number,
): Promise<string> {
  const resp = await smClient.send(
    new GetSecretValueCommand({ SecretId: credentialsSecretId }),
  );
  if (!resp.SecretString) throw new Error('Credentials secret is empty');
  const creds = JSON.parse(resp.SecretString) as {
    accessKeyId: string; secretAccessKey: string; sessionToken: string;
  };
  const svc = inferServiceFromArn(awsResourceArn) ?? 'lambda';
  const destination = buildDestination(svc, awsResourceArn);
  return buildConsoleUrl(creds, destination, durationSeconds);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export class GrantAwsConsoleAccessHandler {
  private readonly slack = new SlackNotifier();
  constructor(private readonly portalRepo: PortalRepository) {}

  async execute(
    input: GrantAwsConsoleAccessInput,
  ): Promise<Result<JitSession, DomainError>> {
    // 1. Infer service from ARN and validate
    const awsService = inferServiceFromArn(input.awsResourceArn);
    if (!awsService) {
      return failure(domainError('UNSUPPORTED_SERVICE',
        `Cannot infer AWS service from ARN: ${input.awsResourceArn}. Supported: Lambda, SNS, SQS, DynamoDB ARNs.`,
      ));
    }
    const action = AWS_ACTIONS[awsService]!;

    // 2. Cap duration
    const durationHours = Math.min(input.durationHours, MAX_DURATION_HOURS);
    const durationSeconds = durationHours * 3600;

    // 3. Resolve ARN (normalise SQS URL → ARN)
    const resourceArn = normaliseArn(awsService, input.awsResourceArn);

    // 4. Build session policy — exact action on exact resource only
    const sessionPolicy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [{
        Effect:   'Allow',
        Action:   action,
        Resource: resourceArn,
      }],
    });

    // 5. Assume broker role via STS
    const brokerRoleArn = process.env['JIT_BROKER_ROLE_ARN'];
    if (!brokerRoleArn) {
      return failure(domainError('MISCONFIGURED', 'JIT_BROKER_ROLE_ARN env var is not set'));
    }

    const grantedAt = new Date();
    const expiresAt  = new Date(grantedAt.getTime() + durationSeconds * 1000);
    const sessionId  = randomUUID();
    // Encode requester identity in session name so every CloudTrail event is attributable.
    // Format: wep-<email-local>-<short-uuid>   (max 64 chars, alphanumeric + =,.@-)
    const emailLocal = (input.requesterEmail ?? input.requesterId)
      .split('@')[0]!
      .replace(/[^a-zA-Z0-9=,.@-]/g, '-')
      .slice(0, 40);
    const sessionName = `wep-${emailLocal}-${sessionId.split('-')[0]}`;

    let stsCredentials: { accessKeyId: string; secretAccessKey: string; sessionToken: string };
    try {
      const resp = await stsClient.send(
        new AssumeRoleCommand({
          RoleArn:         brokerRoleArn,
          RoleSessionName: sessionName,
          DurationSeconds: durationSeconds,
          Policy:          sessionPolicy,
        }),
      );
      const c = resp.Credentials;
      if (!c?.AccessKeyId || !c?.SecretAccessKey || !c?.SessionToken) {
        return failure(domainError('STS_ERROR', 'STS returned incomplete credentials'));
      }
      stsCredentials = {
        accessKeyId:     c.AccessKeyId,
        secretAccessKey: c.SecretAccessKey,
        sessionToken:    c.SessionToken,
      };
    } catch (err) {
      return failure(domainError('STS_ERROR', `AssumeRole failed: ${err instanceof Error ? err.message : String(err)}`));
    }

    // 6. Store credentials in Secrets Manager (encrypted, for console URL regeneration)
    const credentialsSecretId = `wep/jit-console/${sessionId}`;
    try {
      await smClient.send(
        new CreateSecretCommand({
          Name:         credentialsSecretId,
          SecretString: JSON.stringify(stsCredentials),
          Description:  `JIT console credentials for session ${sessionId} (${input.requesterId})`,
          Tags: [
            { Key: 'Platform',   Value: 'WEP' },
            { Key: 'Module',     Value: 'self-service' },
            { Key: 'SessionId',  Value: sessionId },
            { Key: 'ExpiresAt',  Value: expiresAt.toISOString() },
          ],
        }),
      );
    } catch (err) {
      return failure(domainError('SECRET_CREATE_FAILED', `Failed to store credentials: ${err instanceof Error ? err.message : String(err)}`));
    }

    // 7. Persist session record
    const session: JitSession = {
      sessionId,
      requestId:            input.requestId,
      requesterId:          input.requesterId,
      requesterEmail:       input.requesterEmail,
      resourceId:           resourceArn,
      resourceType:         awsService,
      resourceName:         resourceDisplayName(awsService, resourceArn),
      sessionType:          'aws-console',
      awsService:           awsService,
      awsResourceArn:       resourceArn,
      awsAction:            action,
      credentialsSecretId,
      grantedAt:            grantedAt.toISOString(),
      expiresAt:            expiresAt.toISOString(),
      status:               'active',
      revokedAt:            null,
      revokedBy:            null,
    };

    const saveResult = await this.portalRepo.saveJitSession(session);
    if (!saveResult.ok) {
      // Best-effort: delete the secret we just created so it doesn't linger
      smClient.send(new DeleteSecretCommand({
        SecretId: credentialsSecretId, ForceDeleteWithoutRecovery: true,
      })).catch(() => undefined);
      return saveResult;
    }

    // Post credentials as a thread reply on the original request's Slack message.
    // Fire-and-forget — do not block the response on Slack availability.
    const slackChannel = process.env['PORTAL_REQUESTS_SLACK_CHANNEL'];
    if (slackChannel) {
      (async () => {
        try {
          // Fetch the request to get its Slack messageTs for threading
          const reqResult = await this.portalRepo.getRequest(input.requestId);
          const slackMessageTs = reqResult.ok && reqResult.value
            ? (reqResult.value.metadata?.['slackMessageTs'] as string | undefined)
            : undefined;

          const requesterMention = input.requesterEmail
            ? await this.slack.resolveMentionByEmail(input.requesterEmail)
            : null;

          const baseUrl = process.env['PORTAL_BASE_URL'] ?? 'http://localhost:5173';
          const consoleUrl = await buildConsoleUrl(
            stsCredentials,
            buildDestination(awsService, resourceArn),
            Math.min(durationSeconds, 43200), // federation max is 12h
          );

          await this.slack.sendToChannel(
            slackChannel,
            awsAccessGranted({
              requesterMention,
              requesterName:    input.requesterEmail ?? input.requesterId,
              resourceArn,
              awsService,
              awsAction:        action,
              roleSessionName:  sessionName,
              accessKeyId:      stsCredentials.accessKeyId,
              secretAccessKey:  stsCredentials.secretAccessKey,
              sessionToken:     stsCredentials.sessionToken,
              region:           regionStore.get(),
              expiresAt:        expiresAt.toISOString(),
              consoleUrl,
              portalSessionUrl: `${baseUrl}/portal/jit-sessions/${sessionId}`,
            }),
            `AWS access granted to ${input.requesterEmail ?? input.requesterId}`,
            slackMessageTs,
          );
        } catch (e) {
          console.warn('[jit-console] Slack thread notification failed:', e);
        }
      })();
    }

    return success(session);
  }
}
