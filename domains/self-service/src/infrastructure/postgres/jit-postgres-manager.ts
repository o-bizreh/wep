import { Client } from 'pg';
import { randomBytes } from 'node:crypto';

export interface JitUserCredentials {
  username: string;
  password: string;
}

export interface CreateJitUserParams {
  masterConnectionUrl: string;
  accessLevel: 'readonly' | 'readwrite';
  expiresAt: Date;
}

export interface RevokeJitUserParams {
  masterConnectionUrl: string;
  username: string;
}

/**
 * Manages ephemeral PostgreSQL users for JIT access sessions.
 *
 * Roles `jit_readonly` and `jit_readwrite` must exist in the target database
 * before any session is granted (one-time DBA setup).
 *
 * Revocation forcibly terminates open connections before dropping the user,
 * closing the compliance gap left by VALID UNTIL (which only blocks new logins).
 */
export class JitPostgresManager {
  /**
   * Creates an ephemeral DB user scoped to the given access level.
   * The user expires at expiresAt — VALID UNTIL acts as a belt;
   * the revocation handler acts as the suspender.
   */
  async createUser(params: CreateJitUserParams): Promise<JitUserCredentials> {
    const username = `jit_${randomBytes(4).toString('hex')}`;
    const password = randomBytes(24).toString('base64url');
    const expiresIso = params.expiresAt.toISOString().replace('T', ' ').substring(0, 19);
    const role = params.accessLevel === 'readwrite' ? 'jit_readwrite' : 'jit_readonly';

    const client = new Client({ connectionString: params.masterConnectionUrl, ssl: false });
    try {
      await client.connect();
      // CREATE USER with expiry
      await client.query(
        `CREATE USER "${username}" WITH PASSWORD $1 VALID UNTIL $2`,
        [password, expiresIso],
      );
      // Grant the pre-existing role
      await client.query(`GRANT "${role}" TO "${username}"`);
    } finally {
      await client.end().catch(() => undefined);
    }

    return { username, password };
  }

  /**
   * Revokes a JIT session:
   * 1. Terminates all active connections for the user.
   * 2. Drops the user.
   *
   * Idempotent — if the user doesn't exist (e.g. already dropped), succeeds silently.
   */
  async revokeUser(params: RevokeJitUserParams): Promise<void> {
    const client = new Client({ connectionString: params.masterConnectionUrl, ssl: false });
    try {
      await client.connect();
      // Kill open connections first so DROP USER doesn't fail
      await client.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1`,
        [params.username],
      );
      // Drop — IF EXISTS to be idempotent
      await client.query(`DROP USER IF EXISTS "${params.username}"`);
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}
