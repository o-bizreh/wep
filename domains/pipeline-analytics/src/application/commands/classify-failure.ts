import { type Result, success, type DomainError } from '@wep/domain-types';
import type { PipelineRun, FailureCategory } from '../../domain/entities/pipeline-run.js';
import { classifyFailure } from '../../domain/value-objects/failure-pattern.js';
import type { PipelineRepository } from '../../domain/ports/pipeline-repository.js';

export class ClassifyFailureHandler {
  constructor(private readonly pipelineRepo: PipelineRepository) {}

  async execute(
    run: PipelineRun,
    logOutput: string,
  ): Promise<Result<FailureCategory, DomainError>> {
    const patternsResult = await this.pipelineRepo.getPatterns();
    if (!patternsResult.ok) return patternsResult;

    const category = classifyFailure(logOutput, patternsResult.value);

    const updatedRun: PipelineRun = { ...run, failureCategory: category };
    const saveResult = await this.pipelineRepo.saveRun(updatedRun);
    if (!saveResult.ok) return saveResult;

    return success(category);
  }
}
