import type { Result, DomainError, DeploymentErrorCode } from '@wep/domain-types';
import type { EnvironmentSnapshot } from '../../domain/entities/environment-snapshot.js';
import type { DeploymentRepository } from '../../domain/ports/deployment-repository.js';

export class GetCurrentStateHandler {
  constructor(private readonly deploymentRepo: DeploymentRepository) {}

  async execute(
    serviceId: string,
    environment?: string,
  ): Promise<Result<EnvironmentSnapshot[], DomainError<DeploymentErrorCode>>> {
    if (environment) {
      const result = await this.deploymentRepo.getSnapshot(serviceId, environment);
      if (!result.ok) return result;
      return { ok: true, value: result.value ? [result.value] : [] };
    }
    return this.deploymentRepo.getAllSnapshots(serviceId);
  }
}
