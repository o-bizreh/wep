export type TrendDirection = 'improving' | 'stable' | 'declining';

export interface MetricTrend {
  direction: TrendDirection;
  rateOfChange: number;
  window: number;
}

export function calculateTrend(values: number[], higherIsBetter: boolean): MetricTrend {
  if (values.length < 2) {
    return { direction: 'stable', rateOfChange: 0, window: values.length };
  }

  const recent = values[values.length - 1]!;
  const average = values.slice(0, -1).reduce((sum, v) => sum + v, 0) / (values.length - 1);

  if (average === 0) {
    return { direction: 'stable', rateOfChange: 0, window: values.length };
  }

  const changePercent = ((recent - average) / average) * 100;
  const STABILITY_THRESHOLD = 10;

  let direction: TrendDirection;
  if (Math.abs(changePercent) <= STABILITY_THRESHOLD) {
    direction = 'stable';
  } else if (higherIsBetter) {
    direction = changePercent > 0 ? 'improving' : 'declining';
  } else {
    direction = changePercent < 0 ? 'improving' : 'declining';
  }

  return { direction, rateOfChange: Math.round(changePercent * 100) / 100, window: values.length };
}
