import { randomBytes } from 'node:crypto';
import { Client as PgClient } from 'pg';
import { getSecret } from '@wep/aws-clients';
import { type Result, success, failure, type DomainError, domainError } from '@wep/domain-types';
import type { JitResource } from '../../domain/entities/jit-resource.js';
import type { ServiceRequest } from '../../domain/entities/service-request.js';

export interface DbCredentials {
  type: 'postgres' | 'redshift';
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  expiresAt: string;
  /** Connection-string convenience for the requester. */
  connectionString: string;
}

const HARD_MAX_DURATION_MINUTES = 720;
const DEFAULT_DURATION_MINUTES = 60;

/**
 * Issues short-lived Postgres credentials. Two strategies:
 *
 *   1. temp-user (default): connect as platform admin, CREATE USER with a random
 *      password and `VALID UNTIL` expiry, GRANT the requested role, return creds.
 *      The user lingers until a cleanup pass drops it; auth fails at the DB
 *      level once VALID UNTIL passes regardless.
 *
 *   2. iam-token (TODO): rds:generate-db-auth-token. Defers to a future task —
 *      requires the RDS instance to have IAM auth enabled and an IAM-mapped DB
 *      user already provisioned.
 */
export class PostgresCredentialIssuer {
  async issue(
    resource: JitResource,
    request: ServiceRequest,
    role: string,
  ): Promise<Result<DbCredentials, DomainError>> {
    if (resource.type !== 'rds-postgres') {
      return failure(domainError('WRONG_RESOURCE_TYPE', `Expected rds-postgres, got ${resource.type}`));
    }
    const strategy = resource.postgresAuth ?? 'temp-user';
    if (strategy === 'iam-token') {
      return failure(domainError('NOT_IMPLEMENTED', 'IAM-token Postgres auth not yet implemented'));
    }

    if (!resource.host || !resource.port || !resource.dbName || !resource.masterSecretId) {
      return failure(domainError('RESOURCE_INCOMPLETE',
        'Postgres JitResource must have host, port, dbName, and masterSecretId for temp-user strategy',
      ));
    }
    if (resource.allowedPostgresRoles && !resource.allowedPostgresRoles.includes(role)) {
      return failure(domainError('ROLE_NOT_ALLOWED', `Role '${role}' is not in the resource's allowedPostgresRoles`));
    }

    const durationMinutes = clampDuration(request.durationMinutes ?? DEFAULT_DURATION_MINUTES, resource.maxDurationMinutes ?? HARD_MAX_DURATION_MINUTES);
    const expiresAt = new Date(Date.now() + durationMinutes * 60_000);
    const expiresAtIso = expiresAt.toISOString();
    const username = generateUsername(request.requesterAwsArn ?? request.requesterAwsUsername ?? request.requesterId);
    const password = generatePassword();

    // Master connection string lives in Secrets Manager.
    const secretResult = await getSecret(resource.masterSecretId);
    if (!secretResult.ok) {
      return failure(domainError('SECRET_FETCH_FAILED', `Could not read master secret ${resource.masterSecretId}: ${secretResult.error.message}`));
    }
    const masterConnUrl = parseSecretAsConnUrl(secretResult.value);
    if (!masterConnUrl.ok) return masterConnUrl;

    if (!/^[a-z0-9_-]{5,63}$/.test(username)) {
      return failure(domainError('USERNAME_INVALID', 'Generated username failed sanitisation'));
    }
    if (!/^[A-Za-z0-9_-]{20,40}$/.test(password)) {
      return failure(domainError('PASSWORD_INVALID', 'Generated password failed sanitisation'));
    }

    const provisionResult = await connectAndProvision(masterConnUrl.value, username, password, expiresAt, role);
    if (!provisionResult.ok) return provisionResult;

    return success({
      type: 'postgres',
      host: resource.host,
      port: resource.port,
      database: resource.dbName,
      username,
      password,
      expiresAt: expiresAtIso,
      connectionString: `postgresql://${username}:${encodeURIComponent(password)}@${resource.host}:${resource.port}/${resource.dbName}?sslmode=require`,
    });
  }
}

/**
 * Derives a Postgres-safe username from the requester's IAM identity.
 * Format: <name>-<unix_seconds>
 *
 * For federated users (arn:aws:sts::...:assumed-role/RoleName/session)
 * the session part (e.g. "omar.bizreh") is used as the name segment.
 * Dots are replaced with hyphens; result is lowercased and truncated so
 * the full username fits within Postgres's 63-char identifier limit.
 */
function generateUsername(requesterIdentity: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const suffix = `-${ts}`;

  // Extract session name from assumed-role ARN: last segment after final '/'
  let namePart = requesterIdentity;
  if (requesterIdentity.includes('/')) {
    namePart = requesterIdentity.split('/').pop() ?? requesterIdentity;
  }
  // Sanitize: lowercase, replace dots and invalid chars with hyphens, collapse repeated hyphens
  const sanitized = namePart
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const maxNameLen = 63 - suffix.length;
  return `${sanitized.slice(0, maxNameLen)}${suffix}`;
}

function generatePassword(): string {
  // 32 url-safe-ish chars.
  return randomBytes(24).toString('base64url').slice(0, 32);
}

function clampDuration(requested: number, max: number): number {
  const upper = Math.min(max, HARD_MAX_DURATION_MINUTES);
  if (!Number.isFinite(requested) || requested < 1) return Math.min(DEFAULT_DURATION_MINUTES, upper);
  return Math.min(requested, upper);
}

const SSL_CERT_ERRORS = new Set([
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function isSslCertError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const code = (e as NodeJS.ErrnoException).code ?? '';
  return SSL_CERT_ERRORS.has(code) || e.message.toLowerCase().includes('certificate');
}

async function connectAndProvision(
  connUrl: string,
  username: string,
  password: string,
  expiresAt: Date,
  role: string,
): Promise<Result<void, DomainError>> {
  const validUntil = expiresAt.toISOString().replace('T', ' ').slice(0, 19);
  const sql = `CREATE USER "${username}" WITH PASSWORD '${password}' VALID UNTIL '${validUntil}'; GRANT "${role}" TO "${username}";`;

  // Attempt 1: SSL on (connection string as-is).
  const clientSsl = new PgClient({ connectionString: connUrl });
  try {
    await clientSsl.connect();
    await clientSsl.query(sql);
    return success(undefined);
  } catch (e) {
    try { await clientSsl.end(); } catch { /* ignore */ }
    if (!isSslCertError(e)) {
      return failure(domainError('PG_PROVISION_FAILED', e instanceof Error ? e.message : String(e)));
    }
    console.warn('[postgres-issuer] SSL cert verification failed, retrying without SSL:', e instanceof Error ? e.message : e);
  }

  // Attempt 2: SSL disabled — strip sslmode from URL and connect with ssl:false.
  const noSslUrl = connUrl.replace(/[?&]sslmode=[^&]*/g, '').replace(/\?$/, '');
  const clientNoSsl = new PgClient({ connectionString: noSslUrl, ssl: false });
  try {
    await clientNoSsl.connect();
    await clientNoSsl.query(sql);
    return success(undefined);
  } catch (e) {
    return failure(domainError('PG_PROVISION_FAILED', e instanceof Error ? e.message : String(e)));
  } finally {
    try { await clientNoSsl.end(); } catch { /* ignore */ }
  }
}

function parseSecretAsConnUrl(secret: string): Result<string, DomainError> {
  const trimmed = secret.trim();
  if (trimmed.startsWith('postgresql://') || trimmed.startsWith('postgres://')) {
    return success(trimmed);
  }
  // Try JSON shape: { username, password, host, port, dbname/database }
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    const u = String(obj['username'] ?? '');
    const p = String(obj['password'] ?? '');
    const h = String(obj['host'] ?? '');
    const port = String(obj['port'] ?? '5432');
    const db = String(obj['dbname'] ?? obj['database'] ?? 'postgres');
    if (!u || !p || !h) return failure(domainError('SECRET_SHAPE', 'Master secret JSON missing username/password/host'));
    return success(`postgresql://${encodeURIComponent(u)}:${encodeURIComponent(p)}@${h}:${port}/${db}?sslmode=require`);
  } catch {
    return failure(domainError('SECRET_SHAPE', 'Master secret is neither a connection URL nor JSON'));
  }
}
