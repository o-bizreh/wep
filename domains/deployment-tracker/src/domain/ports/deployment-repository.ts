import type { Result, DomainError, DeploymentErrorCode, PaginatedRequest, PaginatedResponse } from '@wep/domain-types';
import type { Deployment } from '../entities/deployment.js';
import type { EnvironmentSnapshot } from '../entities/environment-snapshot.js';

export interface DeploymentFilters {
  serviceId?: string;
  environment?: string;
  actor?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}

export interface DeploymentRepository {
  save(deployment: Deployment): Promise<Result<void, DomainError<DeploymentErrorCode>>>;
  findById(deploymentId: string): Promise<Result<Deployment | null, DomainError<DeploymentErrorCode>>>;
  findByService(serviceId: string, pagination: PaginatedRequest): Promise<Result<PaginatedResponse<Deployment>, DomainError<DeploymentErrorCode>>>;
  findByEnvironment(environment: string, pagination: PaginatedRequest): Promise<Result<PaginatedResponse<Deployment>, DomainError<DeploymentErrorCode>>>;
  findRecent(filters: DeploymentFilters, pagination: PaginatedRequest): Promise<Result<PaginatedResponse<Deployment>, DomainError<DeploymentErrorCode>>>;
  findDuplicate(serviceId: string, environment: string, sha: string, withinHours: number): Promise<Result<Deployment | null, DomainError<DeploymentErrorCode>>>;
  saveSnapshot(snapshot: EnvironmentSnapshot): Promise<Result<void, DomainError<DeploymentErrorCode>>>;
  getSnapshot(serviceId: string, environment: string): Promise<Result<EnvironmentSnapshot | null, DomainError<DeploymentErrorCode>>>;
  getAllSnapshots(serviceId: string): Promise<Result<EnvironmentSnapshot[], DomainError<DeploymentErrorCode>>>;
}
