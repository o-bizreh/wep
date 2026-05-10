import { randomUUID } from 'node:crypto';
import { type Result, success, EventSource, type DomainError, type DeploymentErrorCode } from '@wep/domain-types';
import type { DeploymentRepository } from '../../domain/ports/deployment-repository.js';
import type { EventPublisher } from '@wep/event-bus';

const COMMITS_BEHIND_THRESHOLD = 5;
const DAYS_BEHIND_THRESHOLD = 7;

export class DriftDetectionService {
  constructor(
    private readonly deploymentRepo: DeploymentRepository,
    private readonly eventPublisher: EventPublisher,
  ) {}

  async detectDrift(
    serviceIds: string[],
  ): Promise<Result<void, DomainError<DeploymentErrorCode>>> {
    for (const serviceId of serviceIds) {
      const stagingResult = await this.deploymentRepo.getSnapshot(serviceId, 'staging');
      const productionResult = await this.deploymentRepo.getSnapshot(serviceId, 'production');

      if (!stagingResult.ok || !productionResult.ok) continue;
      if (!stagingResult.value || !productionResult.value) continue;

      const staging = stagingResult.value;
      const production = productionResult.value;

      if (staging.currentSha === production.currentSha) continue;

      const daysBehind = Math.round(
        (new Date(staging.deployedAt).getTime() - new Date(production.deployedAt).getTime()) /
          (1000 * 60 * 60 * 24),
      );

      if (daysBehind >= DAYS_BEHIND_THRESHOLD) {
        await this.eventPublisher.publish(
          EventSource.DEPLOYMENT_TRACKER,
          'environment.drift-detected',
          {
            eventId: randomUUID(),
            entityId: serviceId,
            entityType: 'service',
            timestamp: new Date().toISOString(),
            version: 1,
            data: {
              serviceId,
              stagingSha: staging.currentSha,
              productionSha: production.currentSha,
              commitsBehind: 0,
              daysBehind,
            },
          },
        );
      }
    }

    return success(undefined);
  }
}
