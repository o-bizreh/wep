import { type Result, success, type DomainError } from '@wep/domain-types';
import type { PipelineRepository, PipelineRunFilters } from '../../domain/ports/pipeline-repository.js';

export interface PipelineHealthResponse {
  totalRuns: number;
  successRate: number;
  averageDurationSeconds: number;
  averageQueueTimeSeconds: number;
  failureCategoryBreakdown: Record<string, number>;
  totalCost: number;
}

export class GetPipelineHealthHandler {
  constructor(private readonly pipelineRepo: PipelineRepository) {}

  async execute(filters: PipelineRunFilters): Promise<Result<PipelineHealthResponse, DomainError>> {
    const result = await this.pipelineRepo.findRuns(filters, { limit: 1000 });
    if (!result.ok) return result;

    const runs = result.value.items;
    const total = runs.length;
    if (total === 0) {
      return success({
        totalRuns: 0,
        successRate: 0,
        averageDurationSeconds: 0,
        averageQueueTimeSeconds: 0,
        failureCategoryBreakdown: {},
        totalCost: 0,
      });
    }

    const successCount = runs.filter((r) => r.status === 'success').length;
    const avgDuration = runs.reduce((s, r) => s + r.durationSeconds, 0) / total;
    const avgQueue = runs.reduce((s, r) => s + r.queueTimeSeconds, 0) / total;
    const totalCost = runs.reduce((s, r) => s + r.costEstimate, 0);

    const failureBreakdown: Record<string, number> = {};
    for (const run of runs) {
      if (run.failureCategory) {
        failureBreakdown[run.failureCategory] = (failureBreakdown[run.failureCategory] ?? 0) + 1;
      }
    }

    return success({
      totalRuns: total,
      successRate: Math.round((successCount / total) * 1000) / 10,
      averageDurationSeconds: Math.round(avgDuration),
      averageQueueTimeSeconds: Math.round(avgQueue),
      failureCategoryBreakdown: failureBreakdown,
      totalCost: Math.round(totalCost * 100) / 100,
    });
  }
}
