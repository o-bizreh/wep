import { randomUUID } from 'node:crypto';
import { type Result, success, failure, domainError, type DomainError } from '@wep/domain-types';
import { regionStore, getSecret, credentialStore } from '@wep/aws-clients';
import { RDSClient, DescribeDBInstancesCommand } from '@wep/aws-clients';
import { SlackNotifier, jitCredentialDM } from '@wep/slack-notifier';
import type { PortalRepository } from '../../domain/ports/portal-repository.js';
import type { JitResource } from '../../domain/entities/jit-resource.js';
import type { JitSession } from '../../domain/entities/jit-session.js';
import { JitPostgresManager } from '../../infrastructure/postgres/jit-postgres-manager.js';

export interface GrantJitAccessInput {
  requestId: string;
  requesterId: string;
  requesterEmail: string | null;
  /** The registered JIT resource from the portal registry */
  jitResource: JitResource;
  accessLevel: 'readonly' | 'readwrite';
  /** Duration in minutes — capped by jitResource.maxDurationMinutes */
  durationMinutes: number;
}

interface RdsInstanceInfo {
  identifier: string;
  host: string;
  port: number;
  dbName: string;
}

/** Resolve RDS endpoint from the instance ARN or identifier using AWS APIs. */
async function resolveRdsInstance(identifierOrArn: string): Promise<Result<RdsInstanceInfo, DomainError>> {
  const rdsClient = new RDSClient({ region: regionStore.getProvider(), credentials: credentialStore.getProvider() });
  try {
    const isArn = identifierOrArn.startsWith('arn:');
    const id = isArn ? (identifierOrArn.split(':db:').pop() ?? identifierOrArn) : identifierOrArn;
    const resp = await rdsClient.send(new DescribeDBInstancesCommand({
      Filters: [{ Name: 'db-instance-id', Values: [id] }],
    }));
    const db = resp.DBInstances?.[0];
    if (!db?.Endpoint?.Address) {
      return failure(domainError('NOT_FOUND', `RDS instance not found: ${identifierOrArn}`));
    }
    return success({
      identifier: db.DBInstanceIdentifier ?? identifierOrArn,
      host:       db.Endpoint.Address,
      port:       db.Endpoint.Port ?? 5432,
      dbName:     db.DBName ?? 'postgres',
    });
  } catch (err) {
    return failure(domainError('RDS_DESCRIBE_FAILED',
      `Failed to describe RDS instance: ${err instanceof Error ? err.message : String(err)}`,
    ));
  }
}

/**
 * Resolves the master Postgres connection URL from the JitResource config.
 *
 * Priority:
 *  1. masterSecretId → fetch from Secrets Manager (preferred — keeps creds out of the DB record)
 *  2. host + port + dbName fields on the JitResource + RDS_MASTER_USERNAME/PASSWORD env vars (fallback)
 */
async function resolveMasterConnectionUrl(resource: JitResource, rds: RdsInstanceInfo): Promise<Result<string, DomainError>> {
  if (resource.masterSecretId) {
    const secretResult = await getSecret(resource.masterSecretId);
    if (!secretResult.ok) return secretResult;
    // Secret must be a valid postgres:// URL
    const url = secretResult.value.trim();
    if (!url.startsWith('postgres://') && !url.startsWith('postgresql://')) {
      return failure(domainError('MISCONFIGURED',
        `Secret ${resource.masterSecretId} does not contain a valid postgres:// URL`,
      ));
    }
    return success(url);
  }

  // Fallback: build URL from JitResource host fields + env var credentials
  const host = resource.host ?? rds.host;
  const port = resource.port ?? rds.port;
  const dbName = resource.dbName ?? rds.dbName;
  const username = process.env['RDS_MASTER_USERNAME'];
  const password = process.env['RDS_MASTER_PASSWORD'];
  if (!username || !password) {
    return failure(domainError('MISCONFIGURED',
      'JIT resource has no masterSecretId and RDS_MASTER_USERNAME/RDS_MASTER_PASSWORD env vars are not set.',
    ));
  }
  return success(`postgres://${username}:${encodeURIComponent(password)}@${host}:${port}/${dbName}`);
}

export class GrantJitAccessHandler {
  private readonly slack = new SlackNotifier();
  private readonly pgManager = new JitPostgresManager();

  constructor(private readonly portalRepo: PortalRepository) {}

  async execute(input: GrantJitAccessInput): Promise<Result<JitSession, DomainError>> {
    const { jitResource } = input;

    // 1. Resolve RDS endpoint (needed even when host is on the resource, for the identifier)
    const rdsResult = await resolveRdsInstance(
      jitResource.host ?? jitResource.resourceId,
    );
    if (!rdsResult.ok) return rdsResult;
    const rds = rdsResult.value;

    const dbName = jitResource.dbName ?? rds.dbName;

    // 2. Resolve master connection URL from Secrets Manager or env fallback
    const urlResult = await resolveMasterConnectionUrl(jitResource, rds);
    if (!urlResult.ok) return urlResult;
    const masterConnectionUrl = urlResult.value;

    // 3. Cap duration to resource maximum
    const maxMinutes = jitResource.maxDurationMinutes ?? 120;
    const durationMs = Math.min(input.durationMinutes, maxMinutes) * 60 * 1000;
    const grantedAt  = new Date();
    const expiresAt  = new Date(grantedAt.getTime() + durationMs);

    // 4. Create ephemeral DB user
    let credentials: { username: string; password: string };
    try {
      credentials = await this.pgManager.createUser({
        masterConnectionUrl,
        accessLevel: input.accessLevel,
        expiresAt,
      });
    } catch (err) {
      return failure(domainError('PG_GRANT_FAILED',
        `Failed to create DB user: ${err instanceof Error ? err.message : String(err)}`,
      ));
    }

    // 5. Persist session
    const session: JitSession = {
      sessionId:      randomUUID(),
      requestId:      input.requestId,
      requesterId:    input.requesterId,
      requesterEmail: input.requesterEmail,
      resourceId:     jitResource.resourceId,
      resourceType:   'rds-postgres',
      resourceName:   `${jitResource.name} / ${dbName}`,
      sessionType:    'db',
      dbUsername:     credentials.username,
      grantedAt:      grantedAt.toISOString(),
      expiresAt:      expiresAt.toISOString(),
      status:         'active',
      revokedAt:      null,
      revokedBy:      null,
    };

    const saveResult = await this.portalRepo.saveJitSession(session);
    if (!saveResult.ok) {
      // Clean up the DB user we just created so it doesn't linger
      await this.pgManager.revokeUser({ masterConnectionUrl, username: credentials.username }).catch(() => undefined);
      return saveResult;
    }

    // 6. Send Slack DM with credentials
    if (input.requesterEmail) {
      const baseUrl = process.env['PORTAL_BASE_URL'] ?? 'http://localhost:5173';
      (async () => {
        const userId = await this.slack.resolveUserIdByEmail(input.requesterEmail!);
        if (!userId) {
          console.warn(`[jit] Could not resolve Slack user for ${input.requesterEmail}`);
          return;
        }
        await this.slack.sendDM(
          userId,
          jitCredentialDM({
            resourceName: session.resourceName,
            environment:  jitResource.environment,
            host:         rds.host,
            port:         rds.port,
            dbName,
            username:     credentials.username,
            password:     credentials.password,
            accessLevel:  input.accessLevel,
            expiresAt:    expiresAt.toISOString(),
            portalSessionUrl: `${baseUrl}/portal/jit-sessions/${session.sessionId}`,
          }),
          `JIT DB access to ${session.resourceName} granted`,
        );
      })().catch((e) => console.warn('[jit] Slack DM failed:', e));
    }

    return success(session);
  }
}
