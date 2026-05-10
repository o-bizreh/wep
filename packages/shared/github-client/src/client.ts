import * as https from 'node:https';
import AdmZip from 'adm-zip';
import { Octokit } from '@octokit/rest';
import { getSecret } from '@wep/aws-clients';
import { type Result, success, failure, type DomainError, domainError } from '@wep/domain-types';

export interface GitHubRepo {
  name: string;
  fullName: string;
  defaultBranch: string;
  language: string | null;
  archived: boolean;
  topics: string[];
  htmlUrl: string;
  pushedAt: string | null;     // most recent push to any branch
  updatedAt: string | null;    // most recent metadata change
}

export interface GitHubTeam {
  slug: string;
  name: string;
  description: string | null;
}

export interface GitHubTeamMember {
  login: string;
  role: 'maintainer' | 'member';
}

export interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  workflowId: number;
  headSha: string;
  headBranch: string | null;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  actor: string | null;
  headCommitMessage: string | null;
}

export interface ArtifactFile {
  name: string;    // e.g. "srv-order.ecs_service"
  content: string; // text content
}

export interface WorkflowArtifact {
  name: string;    // e.g. "task-def-srv-order"
  files: ArtifactFile[];
}

export interface GitHubCompareResult {
  totalCommits: number;
  authors: string[];
  files: number;
  pullRequests: Array<{ number: number; title: string }>;
  htmlUrl: string;
}

const etagCache = new Map<string, { etag: string; data: unknown }>();

/** Module-level token override — set via Settings API, used for all subsequent calls. */
let tokenOverride: string | null = null;

export function setGitHubTokenOverride(token: string | null): void {
  tokenOverride = token;
  // Reset cached Octokit so the next call picks up the new token
  GitHubClient.resetCache();
}

export class GitHubClient {
  private static cachedOctokit: Octokit | null = null;
  private rateLimitRemaining = 5000;

  constructor(private readonly secretId: string = 'wep/github-token') {}

  static resetCache(): void {
    GitHubClient.cachedOctokit = null;
  }

  private async getOctokit(): Promise<Result<Octokit, DomainError>> {
    // If there's a module-level override, always use it (no caching across token changes)
    if (tokenOverride) {
      return success(new Octokit({ auth: tokenOverride }));
    }

    // Check env var next (local dev without Secrets Manager)
    const envToken = process.env['GITHUB_TOKEN'];
    if (envToken) {
      if (!GitHubClient.cachedOctokit) {
        GitHubClient.cachedOctokit = new Octokit({ auth: envToken });
      }
      return success(GitHubClient.cachedOctokit);
    }

    // Fall back to Secrets Manager
    if (GitHubClient.cachedOctokit) return success(GitHubClient.cachedOctokit);

    const tokenResult = await getSecret(this.secretId);
    if (!tokenResult.ok) return tokenResult;

    GitHubClient.cachedOctokit = new Octokit({ auth: tokenResult.value });
    return success(GitHubClient.cachedOctokit);
  }

  private updateRateLimit(headers: Record<string, string | undefined>): void {
    const remaining = headers['x-ratelimit-remaining'];
    if (remaining) {
      this.rateLimitRemaining = parseInt(remaining, 10);
    }
  }

  getRateLimitRemaining(): number {
    return this.rateLimitRemaining;
  }

  async listOrgRepos(org: string): Promise<Result<GitHubRepo[], DomainError>> {
    const octokitResult = await this.getOctokit();
    if (!octokitResult.ok) return octokitResult;

    try {
      const repos: GitHubRepo[] = [];
      for await (const response of octokitResult.value.paginate.iterator(
        octokitResult.value.repos.listForOrg,
        { org, per_page: 100, type: 'all' },
      )) {
        this.updateRateLimit(response.headers as Record<string, string | undefined>);
        for (const repo of response.data) {
          repos.push({
            name: repo.name,
            fullName: repo.full_name,
            defaultBranch: repo.default_branch ?? 'main',
            language: repo.language ?? null,
            archived: repo.archived ?? false,
            topics: repo.topics ?? [],
            htmlUrl: repo.html_url,
            pushedAt: repo.pushed_at ?? null,
            updatedAt: repo.updated_at ?? null,
          });
        }
      }
      return success(repos);
    } catch (error) {
      return failure(domainError('GITHUB_API_ERROR', 'Failed to list org repos', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  /**
   * Yields pages of repos as they arrive from GitHub (50 per page by default).
   * Use this instead of `listOrgRepos` when you want to process repos incrementally
   * without waiting for the full org to load.
   */
  async *listOrgReposPages(org: string, perPage = 50): AsyncGenerator<GitHubRepo[]> {
    const octokitResult = await this.getOctokit();
    if (!octokitResult.ok) return;

    try {
      for await (const response of octokitResult.value.paginate.iterator(
        octokitResult.value.repos.listForOrg,
        { org, per_page: perPage, type: 'all' },
      )) {
        this.updateRateLimit(response.headers as Record<string, string | undefined>);
        const page: GitHubRepo[] = response.data.map((repo) => ({
          name: repo.name,
          fullName: repo.full_name,
          defaultBranch: repo.default_branch ?? 'main',
          language: repo.language ?? null,
          archived: repo.archived ?? false,
          topics: repo.topics ?? [],
          htmlUrl: repo.html_url,
          pushedAt: repo.pushed_at ?? null,
          updatedAt: repo.updated_at ?? null,
        }));
        if (page.length > 0) yield page;
      }
    } catch {
      // Swallow — caller sees an empty generator on auth/network failure
    }
  }

  async listOrgTeams(org: string): Promise<Result<GitHubTeam[], DomainError>> {
    const octokitResult = await this.getOctokit();
    if (!octokitResult.ok) return octokitResult;

    try {
      const teams: GitHubTeam[] = [];
      for await (const response of octokitResult.value.paginate.iterator(
        octokitResult.value.teams.list,
        { org, per_page: 100 },
      )) {
        this.updateRateLimit(response.headers as Record<string, string | undefined>);
        for (const team of response.data) {
          teams.push({
            slug: team.slug,
            name: team.name,
            description: team.description ?? null,
          });
        }
      }
      return success(teams);
    } catch (error) {
      return failure(domainError('GITHUB_API_ERROR', 'Failed to list org teams', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  /**
   * Returns a map of repo name → team slug for all repos managed by a given team.
   * Used as a fallback when repos don't have GitHub topics set.
   */
  async getTeamRepos(
    org: string,
    teamSlug: string,
  ): Promise<Result<string[], DomainError>> {
    const octokitResult = await this.getOctokit();
    if (!octokitResult.ok) return octokitResult;

    try {
      const repoNames: string[] = [];
      for await (const response of octokitResult.value.paginate.iterator(
        octokitResult.value.teams.listReposInOrg,
        { org, team_slug: teamSlug, per_page: 100 },
      )) {
        this.updateRateLimit(response.headers as Record<string, string | undefined>);
        for (const repo of response.data) {
          repoNames.push(repo.name);
        }
      }
      return success(repoNames);
    } catch (error) {
      return failure(domainError('GITHUB_API_ERROR', 'Failed to list team repos', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async getTeamMembers(
    org: string,
    teamSlug: string,
  ): Promise<Result<GitHubTeamMember[], DomainError>> {
    const octokitResult = await this.getOctokit();
    if (!octokitResult.ok) return octokitResult;

    try {
      const members: GitHubTeamMember[] = [];
      for await (const response of octokitResult.value.paginate.iterator(
        octokitResult.value.teams.listMembersInOrg,
        { org, team_slug: teamSlug, per_page: 100 },
      )) {
        this.updateRateLimit(response.headers as Record<string, string | undefined>);
        for (const member of response.data) {
          members.push({
            login: member.login,
            role: 'member',
          });
        }
      }
      return success(members);
    } catch (error) {
      return failure(domainError('GITHUB_API_ERROR', 'Failed to list team members', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<Result<string | null, DomainError>> {
    const octokitResult = await this.getOctokit();
    if (!octokitResult.ok) return octokitResult;

    const cacheKey = `${owner}/${repo}/${path}/${ref ?? 'default'}`;
    const cached = etagCache.get(cacheKey);

    try {
      const response = await octokitResult.value.repos.getContent({
        owner,
        repo,
        path,
        ref,
        headers: cached ? { 'if-none-match': cached.etag } : {},
      });

      this.updateRateLimit(response.headers as Record<string, string | undefined>);

      const etag = response.headers['etag'];
      if (etag) {
        etagCache.set(cacheKey, { etag, data: response.data });
      }

      const data = response.data;
      if ('content' in data && data.content) {
        return success(Buffer.from(data.content, 'base64').toString('utf-8'));
      }
      return success(null);
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'status' in error) {
        if ((error as { status: number }).status === 304 && cached) {
          const data = cached.data as { content?: string };
          if (data.content) {
            return success(Buffer.from(data.content, 'base64').toString('utf-8'));
          }
        }
        if ((error as { status: number }).status === 404) {
          return success(null);
        }
      }
      return failure(domainError('GITHUB_API_ERROR', `Failed to get file ${path}`, {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async compareCommits(
    owner: string,
    repo: string,
    baseSha: string,
    headSha: string,
  ): Promise<Result<GitHubCompareResult, DomainError>> {
    const octokitResult = await this.getOctokit();
    if (!octokitResult.ok) return octokitResult;

    try {
      const response = await octokitResult.value.repos.compareCommits({
        owner,
        repo,
        base: baseSha,
        head: headSha,
      });

      this.updateRateLimit(response.headers as Record<string, string | undefined>);

      const authors = [
        ...new Set(
          response.data.commits
            .map((c) => c.author?.login)
            .filter((login): login is string => login !== undefined && login !== null),
        ),
      ];

      return success({
        totalCommits: response.data.total_commits,
        authors,
        files: response.data.files?.length ?? 0,
        pullRequests: [],
        htmlUrl: response.data.html_url,
      });
    } catch (error) {
      return failure(domainError('GITHUB_API_ERROR', 'Failed to compare commits', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async listWorkflowRuns(
    owner: string,
    repo: string,
    filters?: { status?: string; per_page?: number; page?: number },
  ): Promise<Result<{ items: WorkflowRun[]; totalCount: number }, DomainError>> {
    const octokitResult = await this.getOctokit();
    if (!octokitResult.ok) return octokitResult;

    try {
      const response = await octokitResult.value.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        per_page: filters?.per_page ?? 10,
        page: filters?.page ?? 1,
      });

      this.updateRateLimit(response.headers as Record<string, string | undefined>);

      return success({
        totalCount: response.data.total_count,
        items: response.data.workflow_runs.map((run) => ({
          id: run.id,
          name: run.name ?? '',
          status: run.status ?? '',
          conclusion: run.conclusion ?? null,
          workflowId: run.workflow_id,
          headSha: run.head_sha,
          headBranch: run.head_branch ?? null,
          createdAt: run.created_at,
          updatedAt: run.updated_at,
          htmlUrl: run.html_url,
          actor: run.actor?.login ?? null,
          headCommitMessage: run.head_commit?.message?.split('\n')[0] ?? null,
        })),
      });
    } catch (error) {
      return failure(domainError('GITHUB_API_ERROR', 'Failed to list workflow runs', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async listPullRequests(
    owner: string,
    repo: string,
  ): Promise<Result<Array<{
    number: number;
    title: string;
    author: string;
    authorAvatarUrl: string;
    authorHtmlUrl: string;
    createdAt: string;
    updatedAt: string;
    draft: boolean;
    htmlUrl: string;
    labels: string[];
    reviewers: string[];
    commentsCount: number;
  }>, DomainError>> {
    const octokitResult = await this.getOctokit();
    if (!octokitResult.ok) return octokitResult;

    try {
      const response = await octokitResult.value.pulls.list({
        owner,
        repo,
        state: 'open',
        per_page: 50,
        sort: 'updated',
        direction: 'desc',
      });

      this.updateRateLimit(response.headers as Record<string, string | undefined>);

      return success(
        response.data.map((pr) => ({
          number: pr.number,
          title: pr.title,
          author: pr.user?.login ?? 'unknown',
          authorAvatarUrl: pr.user?.avatar_url ?? '',
          authorHtmlUrl: pr.user?.html_url ?? '',
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
          draft: pr.draft ?? false,
          htmlUrl: pr.html_url,
          labels: pr.labels.map((l) => l.name ?? '').filter(Boolean),
          reviewers: pr.requested_reviewers
            ?.map((r) => ('login' in r ? r.login : ''))
            .filter(Boolean) ?? [],
          commentsCount: 0, // list endpoint omits counts; full count requires per-PR fetch
        })),
      );
    } catch (error) {
      return failure(domainError('GITHUB_API_ERROR', 'Failed to list pull requests', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async getPullRequestFiles(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<Result<{ filename: string; status: string; additions: number; deletions: number; patch?: string }[], DomainError>> {
    const octokitResult = await this.getOctokit();
    if (!octokitResult.ok) return octokitResult;

    try {
      const response = await octokitResult.value.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      });
      this.updateRateLimit(response.headers as Record<string, string | undefined>);
      return success(
        response.data.map((f) => ({
          filename: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch?.slice(0, 500), // trim large patches
        })),
      );
    } catch (error) {
      return failure(domainError('GITHUB_API_ERROR', 'Failed to list PR files', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async listContributors(
    owner: string,
    repo: string,
    perPage = 10,
  ): Promise<Result<Array<{ login: string; contributions: number; avatarUrl: string; htmlUrl: string }>, DomainError>> {
    const octokitResult = await this.getOctokit();
    if (!octokitResult.ok) return octokitResult;

    try {
      const response = await octokitResult.value.repos.listContributors({
        owner,
        repo,
        per_page: perPage,
        anon: 'false',
      });

      this.updateRateLimit(response.headers as Record<string, string | undefined>);

      return success(
        response.data
          .filter((c): c is typeof c & { login: string } => !!c.login)
          .map((c) => ({
            login: c.login,
            contributions: c.contributions,
            avatarUrl: c.avatar_url ?? '',
            htmlUrl: c.html_url ?? `https://github.com/${c.login}`,
          })),
      );
    } catch (error) {
      return failure(domainError('GITHUB_API_ERROR', 'Failed to list contributors', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async downloadRunArtifacts(
    owner: string,
    repo: string,
    runId: number,
  ): Promise<Result<WorkflowArtifact[], DomainError>> {
    const octokitResult = await this.getOctokit();
    if (!octokitResult.ok) return octokitResult;

    try {
      const listResponse = await octokitResult.value.actions.listWorkflowRunArtifacts({
        owner,
        repo,
        run_id: runId,
        per_page: 50,
      });

      this.updateRateLimit(listResponse.headers as Record<string, string | undefined>);

      const artifacts: WorkflowArtifact[] = [];

      for (const artifact of listResponse.data.artifacts) {
        // Request returns a redirect — capture the Location URL then fetch binary
        let redirectUrl: string;
        try {
          await octokitResult.value.request(
            'GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}',
            { owner, repo, artifact_id: artifact.id, archive_format: 'zip', request: { redirect: 'manual' } },
          );
          // Shouldn't reach here with redirect: manual
          continue;
        } catch (redirectError: unknown) {
          const e = redirectError as { status?: number; response?: { headers?: { location?: string } } };
          if ((e.status === 302 || e.status === 301) && e.response?.headers?.location) {
            redirectUrl = e.response.headers.location;
          } else {
            continue;
          }
        }

        const zipBuffer = await this.fetchBinary(redirectUrl);
        const zip = new AdmZip(zipBuffer);
        const files: ArtifactFile[] = zip
          .getEntries()
          .filter((e) => !e.isDirectory)
          .map((e) => ({
            name: e.entryName,
            content: e.getData().toString('utf-8').trim(),
          }));

        artifacts.push({ name: artifact.name, files });
      }

      return success(artifacts);
    } catch (error) {
      return failure(domainError('GITHUB_API_ERROR', 'Failed to download run artifacts', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  private fetchBinary(url: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          const location = res.headers['location'];
          if (!location) return reject(new Error('Redirect with no location header'));
          this.fetchBinary(location).then(resolve, reject);
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject);
    });
  }
}
