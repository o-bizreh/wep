import { randomUUID } from 'node:crypto';
import { type Result, success, type DomainError, type VelocityErrorCode } from '@wep/domain-types';
import { type MetricSnapshot, type Period } from '../../domain/entities/metric-snapshot.js';
import { classify } from '../../domain/value-objects/dora-classification.js';
import type { MetricRepository } from '../../domain/ports/metric-repository.js';
import type { DeploymentDataSource } from '../../domain/ports/deployment-data-source.js';

export class CalculateTeamSnapshotHandler {
  constructor(
    private readonly metricRepo: MetricRepository,
    private readonly deploymentSource: DeploymentDataSource,
  ) {}

  async execute(
    teamId: string,
    serviceIds: string[],
    period: Period,
    periodIdentifier: string,
    startDate: string,
    endDate: string,
  ): Promise<Result<MetricSnapshot, DomainError<VelocityErrorCode>>> {
    const deploymentsResult = await this.deploymentSource.getDeploymentsForTeam(
      teamId,
      serviceIds,
      startDate,
      endDate,
    );
    if (!deploymentsResult.ok) return deploymentsResult;

    const deployments = deploymentsResult.value;
    const productionDeploys = deployments.filter(
      (d) => d.environment === 'production' && d.status === 'success',
    );

    const periodDays = this.getPeriodDays(period, startDate, endDate);

    const deploymentFrequency = periodDays > 0 ? productionDeploys.length / periodDays : 0;

    let leadTimeSum = 0;
    let leadTimeCount = 0;
    for (const deploy of productionDeploys) {
      if (deploy.completedAt && deploy.startedAt) {
        const leadTime =
          (new Date(deploy.completedAt).getTime() - new Date(deploy.startedAt).getTime()) /
          (1000 * 60 * 60);
        leadTimeSum += leadTime;
        leadTimeCount++;
      }
    }
    const leadTimeForChanges = leadTimeCount > 0 ? leadTimeSum / leadTimeCount : 0;

    const failedDeploys = deployments.filter(
      (d) => d.environment === 'production' && (d.wasRollback || d.status === 'failure'),
    );
    const changeFailureRate =
      productionDeploys.length > 0
        ? (failedDeploys.length / productionDeploys.length) * 100
        : 0;

    const snapshot: MetricSnapshot = {
      snapshotId: randomUUID(),
      entityId: teamId,
      entityType: 'team',
      period,
      periodIdentifier,
      deploymentFrequency: {
        value: Math.round(deploymentFrequency * 1000) / 1000,
        classification: classify('deploymentFrequency', deploymentFrequency),
      },
      leadTimeForChanges: {
        value: Math.round(leadTimeForChanges * 10) / 10,
        classification: classify('leadTimeForChanges', leadTimeForChanges),
      },
      meanTimeToRecovery: null,
      changeFailureRate: {
        value: Math.round(changeFailureRate * 10) / 10,
        classification: classify('changeFailureRate', changeFailureRate),
      },
      sampleSize: productionDeploys.length,
      calculatedAt: new Date().toISOString(),
    };

    const saveResult = await this.metricRepo.saveSnapshot(snapshot);
    if (!saveResult.ok) return saveResult;

    return success(snapshot);
  }

  private getPeriodDays(period: Period, startDate: string, endDate: string): number {
    const ms = new Date(endDate).getTime() - new Date(startDate).getTime();
    return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)));
  }
}
