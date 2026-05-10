import { type Result, success, failure, domainError, type DomainError } from '@wep/domain-types';
import { getSecret, SecretsManagerClient, DeleteSecretCommand, regionStore } from '@wep/aws-clients';
import { SlackNotifier, jitRevocationDM } from '@wep/slack-notifier';
import type { PortalRepository } from '../../domain/ports/portal-repository.js';
import type { JitSession } from '../../domain/entities/jit-session.js';
import { JitPostgresManager } from '../../infrastructure/postgres/jit-postgres-manager.js';

const smClient = new SecretsManagerClient({ region: regionStore.getProvider() });

export class RevokeJitSessionHandler {
  private readonly slack = new SlackNotifier();
  private readonly pgManager = new JitPostgresManager();

  constructor(private readonly portalRepo: PortalRepository) {}

  async execute(sessionId: string, revokedBy: string): Promise<Result<void, DomainError>> {
    // 1. Load session
    const sessionResult = await this.portalRepo.getJitSession(sessionId);
    if (!sessionResult.ok) return sessionResult;
    if (!sessionResult.value) return failure(domainError('NOT_FOUND', 'JIT session not found'));

    const session = sessionResult.value;
    if (session.status !== 'active') return success(undefined); // idempotent

    // 2. Load resource to get master connection URL
    const resourceResult = await this.portalRepo.getJitResource(session.resourceId);
    if (!resourceResult.ok) return resourceResult;
    if (!resourceResult.value) {
      return failure(domainError('NOT_FOUND', `JIT resource ${session.resourceId} not found`));
    }
    const resource = resourceResult.value;

    let masterConnectionUrl: string | null = null;
    if (resource.masterSecretId) {
      const secretResult = await getSecret(resource.masterSecretId);
      if (secretResult.ok) masterConnectionUrl = secretResult.value;
    }

    // 3a. Drop the DB user for db sessions (best-effort)
    if (session.sessionType !== 'aws-console' && masterConnectionUrl && session.dbUsername) {
      try {
        await this.pgManager.revokeUser({ masterConnectionUrl, username: session.dbUsername });
      } catch (err) {
        console.error(`[jit] Failed to drop user ${session.dbUsername}:`, err instanceof Error ? err.message : String(err));
      }
    }

    // 3b. Delete Secrets Manager secret for aws-console sessions (best-effort)
    //     This prevents further console URL generation — the STS session still expires naturally
    if (session.sessionType === 'aws-console' && session.credentialsSecretId) {
      smClient.send(new DeleteSecretCommand({
        SecretId: session.credentialsSecretId,
        ForceDeleteWithoutRecovery: true,
      })).catch((e) => console.error('[jit] Failed to delete credentials secret:', e instanceof Error ? e.message : String(e)));
    }

    // 4. Update session status
    const now = new Date().toISOString();
    const revoked: JitSession = {
      ...session,
      status: revokedBy === 'scheduler' ? 'expired' : 'revoked',
      revokedAt: now,
      revokedBy,
    };
    const saveResult = await this.portalRepo.saveJitSession(revoked);
    if (!saveResult.ok) return saveResult;

    // 5. Send Slack DM to notify requester
    if (session.requesterEmail) {
      const baseUrl = process.env['PORTAL_BASE_URL'] ?? 'http://localhost:5173';
      (async () => {
        const userId = await this.slack.resolveUserIdByEmail(session.requesterEmail!);
        if (!userId) return;
        await this.slack.sendDM(
          userId,
          jitRevocationDM({
            resourceName: session.resourceName,
            username: session.dbUsername ?? session.awsService ?? 'aws-console',
            revokedBy,
            sessionUrl: `${baseUrl}/portal/jit-sessions/${session.sessionId}`,
          }),
          `JIT access to ${session.resourceName} has been revoked`,
        );
      })().catch((e) => console.warn('[jit] Slack revocation DM failed:', e));
    }

    return success(undefined);
  }
}
