import { randomUUID } from 'node:crypto';
import {
  type Result,
  success,
  failure,
  type DomainError,
  domainError,
  DeploymentErrorCode,
} from '@wep/domain-types';

export type DeploymentStatus = 'started' | 'success' | 'failure' | 'cancelled' | 'rolled-back';
export type TriggerSource = 'github-actions' | 'ecs-direct' | 'manual' | 'cloudformation';

export interface Deployment {
  deploymentId: string;
  serviceId: string;
  environment: string;
  sha: string;
  previousSha: string | null;
  actor: string;
  triggerSource: TriggerSource;
  status: DeploymentStatus;
  startedAt: string;
  completedAt: string | null;
  durationSeconds: number | null;
  metadata: Record<string, unknown>;
}

export interface CreateDeploymentInput {
  serviceId: string;
  environment: string;
  sha: string;
  actor: string;
  triggerSource: TriggerSource;
  previousSha?: string;
  metadata?: Record<string, unknown>;
}

export function createDeployment(input: CreateDeploymentInput): Deployment {
  return {
    deploymentId: randomUUID(),
    serviceId: input.serviceId,
    environment: input.environment,
    sha: input.sha,
    previousSha: input.previousSha ?? null,
    actor: input.actor,
    triggerSource: input.triggerSource,
    status: 'started',
    startedAt: new Date().toISOString(),
    completedAt: null,
    durationSeconds: null,
    metadata: input.metadata ?? {},
  };
}

const validTransitions: Record<string, DeploymentStatus[]> = {
  started: ['success', 'failure', 'cancelled', 'rolled-back'],
};

export function completeDeployment(
  deployment: Deployment,
  status: 'success' | 'failure' | 'cancelled',
  completedAt?: string,
): Result<Deployment, DomainError<DeploymentErrorCode>> {
  const allowed = validTransitions[deployment.status];
  if (!allowed?.includes(status)) {
    return failure(
      domainError(
        DeploymentErrorCode.INVALID_STATUS_TRANSITION,
        `Cannot transition from ${deployment.status} to ${status}`,
      ),
    );
  }

  const completed = completedAt ?? new Date().toISOString();
  const durationSeconds = (new Date(completed).getTime() - new Date(deployment.startedAt).getTime()) / 1000;

  return success({
    ...deployment,
    status,
    completedAt: completed,
    durationSeconds: Math.round(durationSeconds),
  });
}

export function isRollback(deployment: Deployment, currentSha: string | null): boolean {
  if (!currentSha || !deployment.previousSha) return false;
  return deployment.sha < currentSha;
}

export function markAsRollback(deployment: Deployment): Deployment {
  return { ...deployment, status: 'rolled-back' };
}
