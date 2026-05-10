export interface MetricAnomaly {
  anomalyId: string;
  teamId: string;
  metricName: string;
  currentValue: number;
  rollingAverage: number;
  standardDeviation: number;
  deviationMultiple: number;
  direction: 'improved' | 'degraded';
  detectedAt: string;
  acknowledged: boolean;
}
