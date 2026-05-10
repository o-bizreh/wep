import type { DORALevel } from '../entities/metric-snapshot.js';

export interface DORAThresholds {
  elite: number;
  high: number;
  medium: number;
}

const defaultThresholds: Record<string, DORAThresholds & { higherIsBetter: boolean }> = {
  deploymentFrequency: { elite: 1, high: 0.143, medium: 0.033, higherIsBetter: true },
  leadTimeForChanges: { elite: 1, high: 24, medium: 168, higherIsBetter: false },
  meanTimeToRecovery: { elite: 1, high: 24, medium: 168, higherIsBetter: false },
  changeFailureRate: { elite: 5, high: 10, medium: 15, higherIsBetter: false },
};

export function classify(
  metricName: string,
  value: number,
  customThresholds?: Record<string, DORAThresholds & { higherIsBetter: boolean }>,
): DORALevel {
  const thresholds = (customThresholds ?? defaultThresholds)[metricName];
  if (!thresholds) return 'low';

  if (thresholds.higherIsBetter) {
    if (value >= thresholds.elite) return 'elite';
    if (value >= thresholds.high) return 'high';
    if (value >= thresholds.medium) return 'medium';
    return 'low';
  } else {
    if (value <= thresholds.elite) return 'elite';
    if (value <= thresholds.high) return 'high';
    if (value <= thresholds.medium) return 'medium';
    return 'low';
  }
}
