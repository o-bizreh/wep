import {
  type Result,
  success,
  failure,
  domainError,
  DeploymentErrorCode,
  type DomainError,
} from '@wep/domain-types';
import type { EnvironmentDiff } from '../../domain/value-objects/environment-diff.js';
import type { DeploymentRepository } from '../../domain/ports/deployment-repository.js';
import type { CommitComparator } from '../../domain/ports/commit-comparator.js';

export class GetEnvironmentDiffHandler {
  constructor(
    private readonly deploymentRepo: DeploymentRepository,
    private readonly commitComparator: CommitComparator,
  ) {}

  async execute(
    serviceId: string,
    sourceEnvironment: string = 'staging',
    targetEnvironment: string = 'production',
  ): Promise<Result<EnvironmentDiff, DomainError<DeploymentErrorCode>>> {
    const sourceResult = await this.deploymentRepo.getSnapshot(serviceId, sourceEnvironment);
    if (!sourceResult.ok) return sourceResult;

    const targetResult = await this.deploymentRepo.getSnapshot(serviceId, targetEnvironment);
    if (!targetResult.ok) return targetResult;

    if (!sourceResult.value || !targetResult.value) {
      return failure(
        domainError(DeploymentErrorCode.DEPLOYMENT_NOT_FOUND, 'Missing environment snapshot'),
      );
    }

    const source = sourceResult.value;
    const target = targetResult.value;

    if (source.currentSha === target.currentSha) {
      return success({
        serviceId,
        sourceEnvironment,
        targetEnvironment,
        sourceSha: source.currentSha,
        targetSha: target.currentSha,
        commitsBehind: 0,
        daysBehind: 0,
        diffUrl: '',
      });
    }

    const daysBehind = Math.round(
      (new Date(source.deployedAt).getTime() - new Date(target.deployedAt).getTime()) /
        (1000 * 60 * 60 * 24),
    );

    const compareResult = await this.commitComparator.compare(
      '',
      target.currentSha,
      source.currentSha,
    );

    return success({
      serviceId,
      sourceEnvironment,
      targetEnvironment,
      sourceSha: source.currentSha,
      targetSha: target.currentSha,
      commitsBehind: compareResult.ok ? compareResult.value.commitCount : 0,
      daysBehind: Math.abs(daysBehind),
      diffUrl: compareResult.ok
        ? `https://github.com/compare/${target.currentSha}...${source.currentSha}`
        : '',
    });
  }
}
