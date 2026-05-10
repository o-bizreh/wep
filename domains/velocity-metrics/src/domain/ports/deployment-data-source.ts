import type { Result, DomainError, VelocityErrorCode } from '@wep/domain-types';

export interface DeploymentRecord {
  deploymentId: string;
  serviceId: string;
  teamId: string;
  environment: string;
  sha: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationSeconds: number | null;
  previousSha: string | null;
  wasRollback: boolean;
}

export interface DeploymentDataSource {
  getDeploymentsForTeam(
    teamId: string,
    serviceIds: string[],
    startDate: string,
    endDate: string,
  ): Promise<Result<DeploymentRecord[], DomainError<VelocityErrorCode>>>;

  getProductionDeployments(
    startDate: string,
    endDate: string,
  ): Promise<Result<DeploymentRecord[], DomainError<VelocityErrorCode>>>;
}
