import type { Result, DomainError, PaginatedRequest, PaginatedResponse } from '@wep/domain-types';
import type { PipelineRun, FailureCategory } from '../entities/pipeline-run.js';
import type { PipelineCostSummary } from '../entities/pipeline-cost-summary.js';
import type { FailurePattern } from '../value-objects/failure-pattern.js';

export interface PipelineRunFilters {
  serviceId?: string;
  workflowId?: number;
  status?: string;
  failureCategory?: string;
  startDate?: string;
  endDate?: string;
}

export interface PipelineRepository {
  saveRun(run: PipelineRun): Promise<Result<void, DomainError>>;
  findRunById(runId: number): Promise<Result<PipelineRun | null, DomainError>>;
  findRuns(filters: PipelineRunFilters, pagination: PaginatedRequest): Promise<Result<PaginatedResponse<PipelineRun>, DomainError>>;
  findRunsByService(serviceId: string, pagination: PaginatedRequest): Promise<Result<PaginatedResponse<PipelineRun>, DomainError>>;

  saveCostSummary(summary: PipelineCostSummary): Promise<Result<void, DomainError>>;
  getCostSummary(entityId: string, billingPeriod: string): Promise<Result<PipelineCostSummary | null, DomainError>>;

  savePattern(pattern: FailurePattern): Promise<Result<void, DomainError>>;
  getPatterns(): Promise<Result<FailurePattern[], DomainError>>;

  getLastPollTimestamp(repoFullName: string): Promise<Result<string | null, DomainError>>;
  saveLastPollTimestamp(repoFullName: string, timestamp: string): Promise<Result<void, DomainError>>;
}
