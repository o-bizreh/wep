import { randomUUID } from 'node:crypto';
import { type Result, success, EventSource, type DomainError, type VelocityErrorCode } from '@wep/domain-types';
import type { MetricSnapshot } from '../../domain/entities/metric-snapshot.js';
import type { MetricAnomaly } from '../../domain/entities/metric-anomaly.js';
import type { MetricRepository } from '../../domain/ports/metric-repository.js';
import type { EventPublisher } from '@wep/event-bus';

const DEVIATION_THRESHOLD = 2;

export class DetectAnomaliesHandler {
  constructor(
    private readonly metricRepo: MetricRepository,
    private readonly eventPublisher: EventPublisher,
  ) {}

  async execute(
    teamId: string,
    latestSnapshot: MetricSnapshot,
  ): Promise<Result<MetricAnomaly[], DomainError<VelocityErrorCode>>> {
    const historyResult = await this.metricRepo.getTeamHistory(teamId, 'week', 8);
    if (!historyResult.ok) return historyResult;

    const history = historyResult.value;
    if (history.length < 3) return success([]);

    const anomalies: MetricAnomaly[] = [];
    const metricsToCheck = [
      { name: 'deploymentFrequency', getValue: (s: MetricSnapshot) => s.deploymentFrequency.value, higherIsBetter: true },
      { name: 'leadTimeForChanges', getValue: (s: MetricSnapshot) => s.leadTimeForChanges.value, higherIsBetter: false },
      { name: 'changeFailureRate', getValue: (s: MetricSnapshot) => s.changeFailureRate.value, higherIsBetter: false },
    ];

    for (const metric of metricsToCheck) {
      const values = history.map(metric.getValue);
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
      const stdDev = Math.sqrt(variance);

      if (stdDev === 0) continue;

      const currentValue = metric.getValue(latestSnapshot);
      const deviationMultiple = Math.abs(currentValue - mean) / stdDev;

      if (deviationMultiple >= DEVIATION_THRESHOLD) {
        const isImproved = metric.higherIsBetter
          ? currentValue > mean
          : currentValue < mean;

        const anomaly: MetricAnomaly = {
          anomalyId: randomUUID(),
          teamId,
          metricName: metric.name,
          currentValue,
          rollingAverage: Math.round(mean * 100) / 100,
          standardDeviation: Math.round(stdDev * 100) / 100,
          deviationMultiple: Math.round(deviationMultiple * 100) / 100,
          direction: isImproved ? 'improved' : 'degraded',
          detectedAt: new Date().toISOString(),
          acknowledged: false,
        };

        await this.metricRepo.saveAnomaly(anomaly);
        anomalies.push(anomaly);

        await this.eventPublisher.publish(
          EventSource.VELOCITY_METRICS,
          'anomaly.detected',
          {
            eventId: randomUUID(),
            entityId: teamId,
            entityType: 'team',
            timestamp: anomaly.detectedAt,
            version: 1,
            data: {
              teamId,
              metricName: metric.name,
              currentValue,
              rollingAverage: anomaly.rollingAverage,
              standardDeviations: anomaly.deviationMultiple,
              direction: anomaly.direction,
            },
          },
        );
      }
    }

    return success(anomalies);
  }
}
