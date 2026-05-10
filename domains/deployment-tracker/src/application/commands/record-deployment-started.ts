import { randomUUID } from 'node:crypto';
import {
  type Result,
  success,
  EventSource,
  type DomainError,
  type DeploymentErrorCode,
} from '@wep/domain-types';
import { type Deployment, createDeployment, type CreateDeploymentInput } from '../../domain/entities/deployment.js';
import type { DeploymentRepository } from '../../domain/ports/deployment-repository.js';
import type { EventPublisher } from '@wep/event-bus';

export class RecordDeploymentStartedHandler {
  constructor(
    private readonly deploymentRepo: DeploymentRepository,
    private readonly eventPublisher: EventPublisher,
  ) {}

  async execute(
    input: CreateDeploymentInput,
  ): Promise<Result<Deployment, DomainError<DeploymentErrorCode>>> {
    const dupResult = await this.deploymentRepo.findDuplicate(
      input.serviceId,
      input.environment,
      input.sha,
      2,
    );
    if (dupResult.ok && dupResult.value) {
      return success(dupResult.value);
    }

    const snapshotResult = await this.deploymentRepo.getSnapshot(input.serviceId, input.environment);
    const previousSha = snapshotResult.ok ? snapshotResult.value?.currentSha ?? null : null;

    const deployment = createDeployment({ ...input, previousSha: input.previousSha ?? previousSha ?? undefined });

    const saveResult = await this.deploymentRepo.save(deployment);
    if (!saveResult.ok) return saveResult;

    await this.eventPublisher.publish(EventSource.DEPLOYMENT_TRACKER, 'deployment.started', {
      eventId: randomUUID(),
      entityId: deployment.deploymentId,
      entityType: 'deployment',
      timestamp: deployment.startedAt,
      version: 1,
      data: {
        deploymentId: deployment.deploymentId,
        serviceId: deployment.serviceId,
        environment: deployment.environment,
        sha: deployment.sha,
        actor: deployment.actor,
        triggerSource: deployment.triggerSource,
      },
    });

    return success(deployment);
  }
}
