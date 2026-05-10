import type { Result, DomainError, DeploymentErrorCode, PaginatedRequest, PaginatedResponse } from '@wep/domain-types';
import type { Deployment } from '../../domain/entities/deployment.js';
import type { DeploymentRepository, DeploymentFilters } from '../../domain/ports/deployment-repository.js';

export class ListDeploymentsHandler {
  constructor(private readonly deploymentRepo: DeploymentRepository) {}

  async execute(
    filters: DeploymentFilters,
    pagination: PaginatedRequest,
  ): Promise<Result<PaginatedResponse<Deployment>, DomainError<DeploymentErrorCode>>> {
    if (filters.serviceId) {
      return this.deploymentRepo.findByService(filters.serviceId, pagination);
    }
    if (filters.environment) {
      return this.deploymentRepo.findByEnvironment(filters.environment, pagination);
    }
    return this.deploymentRepo.findRecent(filters, pagination);
  }
}
