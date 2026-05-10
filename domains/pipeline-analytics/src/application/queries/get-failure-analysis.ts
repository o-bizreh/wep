import { type Result, success, type DomainError } from '@wep/domain-types';
import type { PipelineRepository, PipelineRunFilters } from '../../domain/ports/pipeline-repository.js';

export interface FailureAnalysisResponse {
  categoryDistribution: Record<string, number>;
  topFailingWorkflows: Array<{ workflowName: string; failureCount: number; dominantCategory: string }>;
  totalFailures: number;
}

export class GetFailureAnalysisHandler {
  constructor(private readonly pipelineRepo: PipelineRepository) {}

  async execute(filters: PipelineRunFilters): Promise<Result<FailureAnalysisResponse, DomainError>> {
    const result = await this.pipelineRepo.findRuns({ ...filters, status: 'failure' }, { limit: 1000 });
    if (!result.ok) return result;

    const failures = result.value.items;
    const categoryDist: Record<string, number> = {};
    const workflowFailures = new Map<string, { count: number; categories: Record<string, number> }>();

    for (const run of failures) {
      const cat = run.failureCategory ?? 'unknown';
      categoryDist[cat] = (categoryDist[cat] ?? 0) + 1;

      const wf = workflowFailures.get(run.workflowName) ?? { count: 0, categories: {} };
      wf.count++;
      wf.categories[cat] = (wf.categories[cat] ?? 0) + 1;
      workflowFailures.set(run.workflowName, wf);
    }

    const topFailingWorkflows = [...workflowFailures.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([name, data]) => ({
        workflowName: name,
        failureCount: data.count,
        dominantCategory: Object.entries(data.categories).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown',
      }));

    return success({
      categoryDistribution: categoryDist,
      topFailingWorkflows,
      totalFailures: failures.length,
    });
  }
}
