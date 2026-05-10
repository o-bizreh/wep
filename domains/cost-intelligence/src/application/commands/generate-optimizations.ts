import { randomUUID } from 'node:crypto';
import { type Result, success, type DomainError } from '@wep/domain-types';
import type { OptimizationRecommendation } from '../../domain/entities/optimization-recommendation.js';
import type { CostRepository } from '../../domain/ports/cost-repository.js';

export class GenerateOptimizationsHandler {
  constructor(private readonly costRepo: CostRepository) {}

  async execute(serviceId: string): Promise<Result<OptimizationRecommendation[], DomainError>> {
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const historyResult = await this.costRepo.getDailyCostRange(serviceId, startDate, endDate);
    if (!historyResult.ok) return historyResult;

    const recommendations: OptimizationRecommendation[] = [];
    const records = historyResult.value;

    if (records.length === 0) return success([]);

    const avgCpu = records.reduce((s, r) => s + (r.utilizationMetrics.cpuAverage ?? 100), 0) / records.length;
    const avgMem = records.reduce((s, r) => s + (r.utilizationMetrics.memoryAverage ?? 100), 0) / records.length;
    const avgCost = records.reduce((s, r) => s + r.totalCost, 0) / records.length;

    if (avgCpu < 20 && avgCost > 1) {
      recommendations.push({
        recommendationId: randomUUID(),
        serviceId,
        type: 'right-size-ecs',
        currentConfiguration: `Average CPU utilization: ${avgCpu.toFixed(1)}%`,
        recommendedConfiguration: 'Reduce task CPU allocation by 50%',
        estimatedMonthlySaving: Math.round(avgCost * 15) / 100,
        confidence: 'high',
        evidence: `30-day average CPU utilization is ${avgCpu.toFixed(1)}%, well below the 50% threshold`,
        status: 'open',
        implementedAt: null,
        actualSaving: null,
      });
    }

    if (avgMem < 30 && avgCost > 1) {
      recommendations.push({
        recommendationId: randomUUID(),
        serviceId,
        type: 'right-size-ecs',
        currentConfiguration: `Average memory utilization: ${avgMem.toFixed(1)}%`,
        recommendedConfiguration: 'Reduce task memory allocation',
        estimatedMonthlySaving: Math.round(avgCost * 10) / 100,
        confidence: 'medium',
        evidence: `30-day average memory utilization is ${avgMem.toFixed(1)}%`,
        status: 'open',
        implementedAt: null,
        actualSaving: null,
      });
    }

    for (const rec of recommendations) {
      await this.costRepo.saveRecommendation(rec);
    }

    return success(recommendations);
  }
}
