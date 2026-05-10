import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

export interface CredentialOverride {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export type CredentialSource = 'override' | 'environment' | 'iam-role';

/**
 * Server-side credential store.
 *
 * Priority:
 *   1. Explicit override (set via Settings UI / API) — SSO temp credentials
 *   2. Node provider chain — IAM role attached to ECS task (production)
 *
 * IMPORTANT: Once an override has been set in this process, the store is
 * "pinned" to override mode. Clearing the override (or letting it expire)
 * will NOT fall back to the local CLI profile or environment variables —
 * it will throw so the caller gets an explicit credential error instead of
 * silently operating under a different identity.
 *
 * The only exception is when no override has ever been set (fresh process
 * start), which is the production path where ECS task-role credentials are
 * resolved through the provider chain.
 */
class CredentialStore {
  private override: CredentialOverride | null = null;
  /** True once set() has been called at least once in this process lifetime. */
  private overrideEverSet = false;

  set(creds: CredentialOverride): void {
    this.override = creds;
    this.overrideEverSet = true;
  }

  clear(): void {
    this.override = null;
    // overrideEverSet stays true — the process remains pinned.
  }

  getSource(): CredentialSource {
    if (this.override) return 'override';
    if (process.env['AWS_ACCESS_KEY_ID']) return 'environment';
    return 'iam-role';
  }

  /**
   * Returns an AwsCredentialIdentityProvider that AWS SDK clients accept.
   * The function is called on each AWS API call, so credential changes
   * take effect without recreating clients.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getProvider(): () => Promise<any> {
    const self = this;
    return async () => {
      if (self.override) {
        return {
          accessKeyId: self.override.accessKeyId,
          secretAccessKey: self.override.secretAccessKey,
          sessionToken: self.override.sessionToken,
        };
      }

      // If the user has ever pasted credentials into the Settings UI, refuse to
      // silently fall back to the local CLI profile or environment variables.
      // This prevents operating under a different identity when SSO tokens expire.
      if (self.overrideEverSet) {
        throw new Error(
          'AWS credentials have been cleared or have expired. ' +
          'Paste fresh SSO session keys in Settings → Your Profile.',
        );
      }

      // Fresh process with no override — use the provider chain (ECS task role
      // in production, or explicit AWS_* env vars set at process start).
      return fromNodeProviderChain()();
    };
  }
}

/** Singleton — one store for the lifetime of the API process. */
export const credentialStore = new CredentialStore();
