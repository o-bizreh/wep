import { type Result, success, failure, domainError, type DomainError } from '@wep/domain-types';
import type { PipelineRepository } from '../../domain/ports/pipeline-repository.js';
import type { PipelineCostSummary } from '../../domain/entities/pipeline-cost-summary.js';

export class GetCostBreakdownHandler {
  constructor(private readonly pipelineRepo: PipelineRepository) {}

  async execute(
    entityId: string,
    billingPeriod: string,
  ): Promise<Result<PipelineCostSummary, DomainError>> {
    const result = await this.pipelineRepo.getCostSummary(entityId, billingPeriod);
    if (!result.ok) return result;
    if (!result.value) {
      return failure(domainError('NOT_FOUND', `No cost data for ${entityId} in ${billingPeriod}`));
    }
    return success(result.value);
  }
}
