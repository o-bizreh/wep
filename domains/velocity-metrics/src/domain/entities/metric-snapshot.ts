export type DORALevel = 'elite' | 'high' | 'medium' | 'low';
export type Period = 'day' | 'week' | 'month';

export interface MetricValue {
  value: number;
  classification: DORALevel;
}

export interface MetricSnapshot {
  snapshotId: string;
  entityId: string;
  entityType: 'team' | 'organization';
  period: Period;
  periodIdentifier: string;
  deploymentFrequency: MetricValue;
  leadTimeForChanges: MetricValue;
  meanTimeToRecovery: MetricValue | null;
  changeFailureRate: MetricValue;
  sampleSize: number;
  calculatedAt: string;
}
