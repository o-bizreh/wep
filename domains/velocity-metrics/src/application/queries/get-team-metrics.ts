import {
  type Result,
  failure,
  domainError,
  VelocityErrorCode,
  type DomainError,
} from '@wep/domain-types';
import type { MetricSnapshot } from '../../domain/entities/metric-snapshot.js';
import type { MetricRepository } from '../../domain/ports/metric-repository.js';
import { enforceMinimumTeamSize } from '../../domain/services/privacy-enforcer.js';

export interface TeamMetricsResponse {
  current: MetricSnapshot | null;
  history: MetricSnapshot[];
}

export class GetTeamMetricsHandler {
  constructor(private readonly metricRepo: MetricRepository) {}

  async execute(
    teamId: string,
    memberCount: number,
    includeHistory: boolean = true,
  ): Promise<Result<TeamMetricsResponse, DomainError<VelocityErrorCode>>> {
    const privacyCheck = enforceMinimumTeamSize(teamId, memberCount);
    if (!privacyCheck.ok) return privacyCheck;

    const currentResult = await this.metricRepo.getTeamCurrent(teamId);
    if (!currentResult.ok) return currentResult;

    let history: MetricSnapshot[] = [];
    if (includeHistory) {
      const historyResult = await this.metricRepo.getTeamHistory(teamId, 'week', 12);
      if (historyResult.ok) {
        history = historyResult.value;
      }
    }

    return { ok: true, value: { current: currentResult.value, history } };
  }
}
