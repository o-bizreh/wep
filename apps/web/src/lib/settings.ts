/** Keys used in localStorage */
const KEYS = {
  onboardingSeen: 'wep-onboarding-seen',
} as const;

export const settings = {
  /** First-time onboarding flow: shown until the user clicks Skip or Finish. */
  hasSeenOnboarding(): boolean {
    return localStorage.getItem(KEYS.onboardingSeen) === '1';
  },

  setOnboardingSeen(seen: boolean): void {
    if (seen) localStorage.setItem(KEYS.onboardingSeen, '1');
    else localStorage.removeItem(KEYS.onboardingSeen);
  },
};
