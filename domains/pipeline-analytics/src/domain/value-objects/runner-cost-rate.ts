export const RUNNER_COST_RATES: Record<string, number> = {
  'ubuntu-latest': 0.008,
  'ubuntu-22.04': 0.008,
  'ubuntu-20.04': 0.008,
  'ubuntu-latest-4-cores': 0.016,
  'ubuntu-latest-8-cores': 0.032,
  'ubuntu-latest-16-cores': 0.064,
  'macos-latest': 0.08,
  'macos-13': 0.08,
  'macos-14': 0.08,
  'windows-latest': 0.016,
};

export function calculateRunCost(billableMinutes: number, runnerType: string): number {
  const rate = RUNNER_COST_RATES[runnerType] ?? RUNNER_COST_RATES['ubuntu-latest']!;
  return Math.round(billableMinutes * rate * 1000) / 1000;
}
