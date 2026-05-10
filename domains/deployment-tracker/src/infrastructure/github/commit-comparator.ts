import {
  type Result,
  success,
  failure,
  domainError,
  DeploymentErrorCode,
  type DomainError,
} from '@wep/domain-types';
import { GitHubClient } from '@wep/github-client';
import type { CommitComparator } from '../../domain/ports/commit-comparator.js';
import type { DeploymentDelta } from '../../domain/value-objects/deployment-delta.js';

const deltaCache = new Map<string, DeploymentDelta>();

export class GitHubCommitComparator implements CommitComparator {
  constructor(private readonly client: GitHubClient = new GitHubClient()) {}

  async compare(
    repositoryUrl: string,
    baseSha: string,
    headSha: string,
  ): Promise<Result<DeploymentDelta, DomainError<DeploymentErrorCode>>> {
    const cacheKey = `${baseSha}...${headSha}`;
    const cached = deltaCache.get(cacheKey);
    if (cached) return success(cached);

    const parts = repositoryUrl.replace('https://github.com/', '').split('/');
    const owner = parts[0];
    const repo = parts[1];

    if (!owner || !repo) {
      return failure(domainError(DeploymentErrorCode.INVALID_INPUT, 'Invalid repository URL'));
    }

    const result = await this.client.compareCommits(owner, repo, baseSha, headSha);
    if (!result.ok) {
      return failure(domainError(DeploymentErrorCode.INVALID_INPUT, 'Compare failed', {
        cause: result.error.message,
      }));
    }

    const delta: DeploymentDelta = {
      commitCount: result.value.totalCommits,
      authors: result.value.authors,
      pullRequests: result.value.pullRequests,
      changedFileCount: result.value.files,
      hasBreakingChanges: false,
    };

    deltaCache.set(cacheKey, delta);
    return success(delta);
  }
}
