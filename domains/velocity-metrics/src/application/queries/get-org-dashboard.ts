import type { Result, DomainError, VelocityErrorCode } from '@wep/domain-types';
import type { MetricSnapshot } from '../../domain/entities/metric-snapshot.js';
import type { MetricRepository } from '../../domain/ports/metric-repository.js';

export interface OrgDashboardResponse {
  current: MetricSnapshot | null;
  history: MetricSnapshot[];
}

export class GetOrgDashboardHandler {
  constructor(private readonly metricRepo: MetricRepository) {}

  async execute(): Promise<Result<OrgDashboardResponse, DomainError<VelocityErrorCode>>> {
    const currentResult = await this.metricRepo.getOrgCurrent();
    if (!currentResult.ok) return currentResult;

    const historyResult = await this.metricRepo.getOrgHistory('week', 12);
    if (!historyResult.ok) return historyResult;

    return {
      ok: true,
      value: { current: currentResult.value, history: historyResult.value },
    };
  }
}
