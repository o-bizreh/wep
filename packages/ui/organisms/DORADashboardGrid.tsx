import { MetricCard } from '../molecules/MetricCard.js';

interface DORAMetrics {
  deploymentFrequency: { value: number; classification: 'elite' | 'high' | 'medium' | 'low' };
  leadTimeForChanges: { value: number; classification: 'elite' | 'high' | 'medium' | 'low' };
  meanTimeToRecovery: { value: number; classification: 'elite' | 'high' | 'medium' | 'low' } | null;
  changeFailureRate: { value: number; classification: 'elite' | 'high' | 'medium' | 'low' };
}

interface DORADashboardGridProps {
  metrics: DORAMetrics;
  trends?: {
    deploymentFrequency?: 'improving' | 'stable' | 'declining';
    leadTimeForChanges?: 'improving' | 'stable' | 'declining';
    meanTimeToRecovery?: 'improving' | 'stable' | 'declining';
    changeFailureRate?: 'improving' | 'stable' | 'declining';
  };
}

export function DORADashboardGrid({ metrics, trends }: DORADashboardGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        metricName="Deploy Frequency"
        value={metrics.deploymentFrequency.value.toFixed(2)}
        unit="/day"
        classification={metrics.deploymentFrequency.classification}
        trend={trends?.deploymentFrequency}
      />
      <MetricCard
        metricName="Lead Time"
        value={metrics.leadTimeForChanges.value.toFixed(1)}
        unit="h"
        classification={metrics.leadTimeForChanges.classification}
        trend={trends?.leadTimeForChanges}
      />
      <MetricCard
        metricName="MTTR"
        value={metrics.meanTimeToRecovery?.value.toFixed(1) ?? 'N/A'}
        unit={metrics.meanTimeToRecovery ? 'h' : undefined}
        classification={metrics.meanTimeToRecovery?.classification ?? 'low'}
        trend={trends?.meanTimeToRecovery}
      />
      <MetricCard
        metricName="Change Failure Rate"
        value={metrics.changeFailureRate.value.toFixed(1)}
        unit="%"
        classification={metrics.changeFailureRate.classification}
        trend={trends?.changeFailureRate}
      />
    </div>
  );
}
