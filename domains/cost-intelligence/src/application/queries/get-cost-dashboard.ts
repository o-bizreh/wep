import { type Result, success, type DomainError } from '@wep/domain-types';
import type { CostRepository } from '../../domain/ports/cost-repository.js';
import type { CostAnomaly } from '../../domain/entities/cost-anomaly.js';
import type { OptimizationRecommendation } from '../../domain/entities/optimization-recommendation.js';

export interface CostDashboardResponse {
  teamSummary: { teamId: string; month: string; totalCost: number } | null;
  anomalies: CostAnomaly[];
  recommendations: OptimizationRecommendation[];
  unattributedCost: Record<string, number>;
}

export class GetCostDashboardHandler {
  constructor(private readonly costRepo: CostRepository) {}

  async execute(teamId: string | null, month: string): Promise<Result<CostDashboardResponse, DomainError>> {
    const summary = teamId
      ? await this.costRepo.getTeamSummary(teamId, month)
      : { ok: true as const, value: null };

    const anomalies = await this.costRepo.getAnomalies('detected');
    const recommendations = await this.costRepo.getRecommendations('open');
    const today = new Date().toISOString().slice(0, 10);
    const unattributed = await this.costRepo.getUnattributedCost(today);

    return success({
      teamSummary: summary.ok ? summary.value : null,
      anomalies: anomalies.ok ? anomalies.value : [],
      recommendations: recommendations.ok ? recommendations.value : [],
      unattributedCost: unattributed.ok ? unattributed.value : {},
    });
  }
}
