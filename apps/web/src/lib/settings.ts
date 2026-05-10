/** Keys used in localStorage */
const KEYS = {
  githubToken: 'wep-github-token',
  awsAccessKeyId: 'wep-aws-access-key-id',
  awsSecretAccessKey: 'wep-aws-secret-access-key',
  awsSessionToken: 'wep-aws-session-token',
  onboardingSeen: 'wep-onboarding-seen',
  firstRunSetupDone: 'wep-first-run-setup-done',
} as const;

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export const settings = {
  getGithubToken(): string | null {
    return localStorage.getItem(KEYS.githubToken);
  },

  setGithubToken(token: string | null): void {
    if (token) localStorage.setItem(KEYS.githubToken, token);
    else localStorage.removeItem(KEYS.githubToken);
  },

  getAwsCredentials(): AwsCredentials | null {
    const accessKeyId = localStorage.getItem(KEYS.awsAccessKeyId);
    const secretAccessKey = localStorage.getItem(KEYS.awsSecretAccessKey);
    if (!accessKeyId || !secretAccessKey) return null;
    return {
      accessKeyId,
      secretAccessKey,
      sessionToken: localStorage.getItem(KEYS.awsSessionToken) ?? undefined,
    };
  },

  setAwsCredentials(creds: AwsCredentials | null): void {
    if (creds) {
      localStorage.setItem(KEYS.awsAccessKeyId, creds.accessKeyId);
      localStorage.setItem(KEYS.awsSecretAccessKey, creds.secretAccessKey);
      if (creds.sessionToken) localStorage.setItem(KEYS.awsSessionToken, creds.sessionToken);
      else localStorage.removeItem(KEYS.awsSessionToken);
    } else {
      Object.values(KEYS).forEach((k) => {
        if (k !== KEYS.githubToken) localStorage.removeItem(k);
      });
    }
  },

  hasGithubToken(): boolean {
    return Boolean(localStorage.getItem(KEYS.githubToken));
  },

  hasAwsCredentials(): boolean {
    return Boolean(
      localStorage.getItem(KEYS.awsAccessKeyId) &&
      localStorage.getItem(KEYS.awsSecretAccessKey),
    );
  },

  /** First-time onboarding flow: shown until the user clicks Skip or Finish. */
  hasSeenOnboarding(): boolean {
    return localStorage.getItem(KEYS.onboardingSeen) === '1';
  },

  setOnboardingSeen(seen: boolean): void {
    if (seen) localStorage.setItem(KEYS.onboardingSeen, '1');
    else localStorage.removeItem(KEYS.onboardingSeen);
  },

  /** True once the user has completed first-run setup (creds + GitHub token). */
  hasCompletedFirstRunSetup(): boolean {
    return localStorage.getItem(KEYS.firstRunSetupDone) === '1';
  },

  setFirstRunSetupDone(): void {
    localStorage.setItem(KEYS.firstRunSetupDone, '1');
  },
};
