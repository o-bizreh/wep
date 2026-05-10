import { randomUUID } from 'node:crypto';
import {
  type Result,
  success,
  failure,
  domainError,
  EventSource,
  DeploymentErrorCode,
  type DomainError,
} from '@wep/domain-types';
import {
  type Deployment,
  completeDeployment,
  markAsRollback,
  createDeployment,
} from '../../domain/entities/deployment.js';
import { createSnapshot } from '../../domain/entities/environment-snapshot.js';
import type { DeploymentRepository } from '../../domain/ports/deployment-repository.js';
import type { EventPublisher } from '@wep/event-bus';

export interface CompleteDeploymentInput {
  deploymentId?: string;
  serviceId?: string;
  environment?: string;
  sha?: string;
  status: 'success' | 'failure' | 'cancelled';
  completedAt?: string;
  actor?: string;
}

export class RecordDeploymentCompletedHandler {
  constructor(
    private readonly deploymentRepo: DeploymentRepository,
    private readonly eventPublisher: EventPublisher,
  ) {}

  async execute(
    input: CompleteDeploymentInput,
  ): Promise<Result<Deployment, DomainError<DeploymentErrorCode>>> {
    let deployment: Deployment | null = null;

    if (input.deploymentId) {
      const result = await this.deploymentRepo.findById(input.deploymentId);
      if (result.ok) deployment = result.value;
    }

    if (!deployment && input.serviceId && input.environment && input.sha) {
      const dupResult = await this.deploymentRepo.findDuplicate(
        input.serviceId,
        input.environment,
        input.sha,
        2,
      );
      if (dupResult.ok) deployment = dupResult.value;
    }

    if (!deployment) {
      if (!input.serviceId || !input.environment || !input.sha) {
        return failure(
          domainError(DeploymentErrorCode.DEPLOYMENT_NOT_FOUND, 'Cannot find or create deployment without serviceId, environment, and sha'),
        );
      }

      deployment = createDeployment({
        serviceId: input.serviceId,
        environment: input.environment,
        sha: input.sha,
        actor: input.actor ?? 'unknown',
        triggerSource: 'github-actions',
      });
    }

    const completedResult = completeDeployment(deployment, input.status, input.completedAt);
    if (!completedResult.ok) return completedResult;

    let completed = completedResult.value;

    if (input.status === 'success') {
      const snapshotResult = await this.deploymentRepo.getSnapshot(completed.serviceId, completed.environment);
      const currentSha = snapshotResult.ok ? snapshotResult.value?.currentSha : null;

      if (currentSha && completed.sha < currentSha) {
        completed = markAsRollback(completed);

        await this.eventPublisher.publish(EventSource.DEPLOYMENT_TRACKER, 'deployment.rolled-back', {
          eventId: randomUUID(),
          entityId: completed.deploymentId,
          entityType: 'deployment',
          timestamp: completed.completedAt!,
          version: 1,
          data: {
            deploymentId: completed.deploymentId,
            serviceId: completed.serviceId,
            environment: completed.environment,
            rolledBackSha: currentSha,
            rolledBackToSha: completed.sha,
            rollbackReason: 'manual',
          },
        });
      }

      const snapshot = createSnapshot(
        completed.serviceId,
        completed.environment,
        completed.sha,
        completed.actor,
        completed.deploymentId,
      );
      await this.deploymentRepo.saveSnapshot(snapshot);
    }

    const saveResult = await this.deploymentRepo.save(completed);
    if (!saveResult.ok) return saveResult;

    await this.eventPublisher.publish(EventSource.DEPLOYMENT_TRACKER, 'deployment.completed', {
      eventId: randomUUID(),
      entityId: completed.deploymentId,
      entityType: 'deployment',
      timestamp: completed.completedAt ?? new Date().toISOString(),
      version: 1,
      data: {
        deploymentId: completed.deploymentId,
        serviceId: completed.serviceId,
        environment: completed.environment,
        sha: completed.sha,
        actor: completed.actor,
        status: completed.status,
        durationSeconds: completed.durationSeconds ?? 0,
        previousSha: completed.previousSha,
        changedFiles: null,
      },
    });

    return success(completed);
  }
}
