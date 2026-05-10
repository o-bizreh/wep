import type { Result, DomainError } from '@wep/domain-types';
import type { ServiceCostRecord } from '../entities/service-cost-record.js';
import type { TeamCostSummary } from '../entities/team-cost-summary.js';
import type { CostAnomaly, AnomalyStatus } from '../entities/cost-anomaly.js';
import type { OptimizationRecommendation, RecommendationStatus } from '../entities/optimization-recommendation.js';

export interface CostRepository {
  saveDailyCost(record: ServiceCostRecord): Promise<Result<void, DomainError>>;
  getDailyCost(serviceId: string, date: string): Promise<Result<ServiceCostRecord | null, DomainError>>;
  getDailyCostRange(serviceId: string, startDate: string, endDate: string): Promise<Result<ServiceCostRecord[], DomainError>>;

  saveTeamSummary(summary: TeamCostSummary): Promise<Result<void, DomainError>>;
  getTeamSummary(teamId: string, month: string): Promise<Result<TeamCostSummary | null, DomainError>>;

  saveAnomaly(anomaly: CostAnomaly): Promise<Result<void, DomainError>>;
  getAnomalies(status?: AnomalyStatus): Promise<Result<CostAnomaly[], DomainError>>;
  updateAnomalyStatus(anomalyId: string, status: AnomalyStatus, resolvedBy?: string, resolution?: string): Promise<Result<void, DomainError>>;

  saveRecommendation(rec: OptimizationRecommendation): Promise<Result<void, DomainError>>;
  getRecommendations(status?: RecommendationStatus): Promise<Result<OptimizationRecommendation[], DomainError>>;
  updateRecommendationStatus(id: string, status: RecommendationStatus): Promise<Result<void, DomainError>>;

  getUnattributedCost(date: string): Promise<Result<Record<string, number>, DomainError>>;
  saveUnattributedCost(date: string, breakdown: Record<string, number>): Promise<Result<void, DomainError>>;
}
