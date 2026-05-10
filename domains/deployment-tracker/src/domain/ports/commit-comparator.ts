import type { Result, DomainError, DeploymentErrorCode } from '@wep/domain-types';
import type { DeploymentDelta } from '../value-objects/deployment-delta.js';

export interface CommitComparator {
  compare(
    repositoryUrl: string,
    baseSha: string,
    headSha: string,
  ): Promise<Result<DeploymentDelta, DomainError<DeploymentErrorCode>>>;
}
