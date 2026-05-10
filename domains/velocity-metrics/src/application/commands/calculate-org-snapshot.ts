import { randomUUID } from 'node:crypto';
import { type Result, success, type DomainError, type VelocityErrorCode } from '@wep/domain-types';
import { type MetricSnapshot, type Period } from '../../domain/entities/metric-snapshot.js';
import { classify } from '../../domain/value-objects/dora-classification.js';
import type { MetricRepository } from '../../domain/ports/metric-repository.js';

export class CalculateOrgSnapshotHandler {
  constructor(private readonly metricRepo: MetricRepository) {}

  async execute(
    teamSnapshots: MetricSnapshot[],
    period: Period,
    periodIdentifier: string,
  ): Promise<Result<MetricSnapshot, DomainError<VelocityErrorCode>>> {
    if (teamSnapshots.length === 0) {
      const empty: MetricSnapshot = {
        snapshotId: randomUUID(),
        entityId: 'org:washmen',
        entityType: 'organization',
        period,
        periodIdentifier,
        deploymentFrequency: { value: 0, classification: 'low' },
        leadTimeForChanges: { value: 0, classification: 'low' },
        meanTimeToRecovery: null,
        changeFailureRate: { value: 0, classification: 'elite' },
        sampleSize: 0,
        calculatedAt: new Date().toISOString(),
      };
      await this.metricRepo.saveSnapshot(empty);
      return success(empty);
    }

    const totalSampleSize = teamSnapshots.reduce((sum, s) => sum + s.sampleSize, 0);

    const weightedAvg = (getter: (s: MetricSnapshot) => number) => {
      if (totalSampleSize === 0) return 0;
      return (
        teamSnapshots.reduce((sum, s) => sum + getter(s) * s.sampleSize, 0) / totalSampleSize
      );
    };

    const df = weightedAvg((s) => s.deploymentFrequency.value);
    const lt = weightedAvg((s) => s.leadTimeForChanges.value);
    const cfr = weightedAvg((s) => s.changeFailureRate.value);

    const snapshot: MetricSnapshot = {
      snapshotId: randomUUID(),
      entityId: 'org:washmen',
      entityType: 'organization',
      period,
      periodIdentifier,
      deploymentFrequency: {
        value: Math.round(df * 1000) / 1000,
        classification: classify('deploymentFrequency', df),
      },
      leadTimeForChanges: {
        value: Math.round(lt * 10) / 10,
        classification: classify('leadTimeForChanges', lt),
      },
      meanTimeToRecovery: null,
      changeFailureRate: {
        value: Math.round(cfr * 10) / 10,
        classification: classify('changeFailureRate', cfr),
      },
      sampleSize: totalSampleSize,
      calculatedAt: new Date().toISOString(),
    };

    const saveResult = await this.metricRepo.saveSnapshot(snapshot);
    if (!saveResult.ok) return saveResult;

    return success(snapshot);
  }
}
