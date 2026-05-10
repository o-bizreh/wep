import { Router } from 'express';
import { Octokit } from '@octokit/rest';
import { GitHubClient } from '@wep/github-client';
import type { SearchServicesHandler } from '@wep/service-catalog';
import {
  CloudWatchClient,
  GetMetricDataCommand,
  CostExplorerClient,
  GetCostAndUsageCommand,
  credentialStore,
  type MetricDataQuery,
} from '@wep/aws-clients';

// ── Constants ────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;
const STALE_DAYS = 30;
const REPO_CONCURRENCY = 8;          // parallel per-repo fetches
const CACHE_TTL_MS = 5 * 60_000;     // 5 minutes — first cold load is slow, rest snappy

// ── Types ────────────────────────────────────────────────────────────────────

type Environment = 'production' | 'development' | 'unknown';

interface PersonCount {
  login: string;
  count: number;
}

export interface ProjectMetrics {
  owner: string;
  repo: string;
  fullName: string;
  defaultBranch: string;
  language: string | null;
  htmlUrl: string;
  topics: string[];

  // Activity
  lastActivityAt: string | null;     // pushedAt
  daysSinceActivity: number | null;
  isStale: boolean;

  // Change volume (last 30d)
  commits30d: number;
  contributors30d: number;
  topContributor: PersonCount | null;
  /** Up to top 5 contributors by commit count in the window, descending. */
  topContributors: PersonCount[];

  // Pull requests
  openPrCount: number;
  oldestOpenPrDays: number | null;
  mergedPrs30d: number;

  // Deployments (last 30d, derived from workflow runs on default + matching env branches)
  deploys30d: { production: number; development: number; total: number };
  deploySuccessRate30d: number | null;   // % across runs with conclusion
  lastDeployAt: { production: string | null; development: string | null };
  topDeployer: { production: PersonCount | null; development: PersonCount | null; overall: PersonCount | null };
  /** Up to top 5 deployers per environment + overall, descending. */
  topDeployers: { production: PersonCount[]; development: PersonCount[]; overall: PersonCount[] };

  // Catalog linkage (services in service-catalog pointing at this repo)
  linkedServiceCount: number;

  // Composite signals (rendered as chips)
  signals: ProjectSignal[];
}

export type ProjectSignal =
  | 'high-activity'         // > 20 merged PRs in 30d
  | 'low-activity'          // ≤ 1 merged PR in 30d AND > 14 days since activity
  | 'stale'                 // no push in > 30 days
  | 'bus-factor-risk'       // high activity but only 1 contributor
  | 'deploy-failures'       // deploy success rate < 80%
  | 'review-backlog'        // oldest open PR > 14 days
  | 'no-deploys'            // 0 deploys in 30d but had commits
  | 'healthy';              // active + multi-contributor + no failures

export interface ProjectListing {
  owner: string;
  repo: string;
  fullName: string;
  defaultBranch: string;
  language: string | null;
  htmlUrl: string;
  topics: string[];
  linkedServiceCount: number;
}

export interface ProjectsListResponse {
  generatedAt: string;
  staleCutoffDays: number;
  windowDays: number;
  total: number;
  excludedArchived: number;
  repos: ProjectListing[];
}

/** @deprecated kept for type compatibility — consumers should use the lazy `repos` + per-repo metrics endpoints. */
export interface ProjectsResponse {
  generatedAt: string;
  staleCutoffDays: number;
  windowDays: number;
  total: number;
  excludedArchived: number;
  projects: ProjectMetrics[];
}

// ── Cache ────────────────────────────────────────────────────────────────────

interface ListCacheEntry {
  generatedAt: number;
  payload: ProjectsListResponse;
}
let listCache: ListCacheEntry | null = null;
let listInflight: Promise<ProjectsListResponse> | null = null;

interface MetricsCacheEntry {
  generatedAt: number;
  payload: ProjectMetrics;
}
const metricsCache = new Map<string, MetricsCacheEntry>();
const metricsInflight = new Map<string, Promise<ProjectMetrics>>();

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Branch → environment heuristic. Workflow_dispatch runs that take an env as
 * an `inputs` parameter aren't visible from the run list, so we fall back to
 * branch name. Anything else is 'unknown' and rolls into the overall top
 * deployer rather than a specific env bucket.
 */
function branchToEnv(branch: string | null): Environment {
  if (!branch) return 'unknown';
  const b = branch.toLowerCase();
  if (['main', 'master', 'prod', 'production', 'release'].includes(b)) return 'production';
  if (['develop', 'dev', 'development', 'staging'].includes(b)) return 'development';
  if (b.startsWith('release/')) return 'production';
  return 'unknown';
}

async function batchedMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

function topByCount(map: Map<string, number>): PersonCount | null {
  let best: PersonCount | null = null;
  for (const [login, count] of map.entries()) {
    if (!best || count > best.count) best = { login, count };
  }
  return best;
}

function topNByCount(map: Map<string, number>, n = 5): PersonCount[] {
  return [...map.entries()]
    .map(([login, count]) => ({ login, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

function deriveSignals(p: ProjectMetrics): ProjectSignal[] {
  const out: ProjectSignal[] = [];
  if (p.isStale) out.push('stale');
  if (p.mergedPrs30d > 20) out.push('high-activity');
  if (p.mergedPrs30d <= 1 && (p.daysSinceActivity ?? 0) > 14 && !p.isStale) out.push('low-activity');
  if (p.mergedPrs30d > 10 && p.contributors30d <= 1) out.push('bus-factor-risk');
  if (p.deploySuccessRate30d !== null && p.deploySuccessRate30d < 80) out.push('deploy-failures');
  if ((p.oldestOpenPrDays ?? 0) > 14) out.push('review-backlog');
  if (p.commits30d > 5 && p.deploys30d.total === 0) out.push('no-deploys');

  const isHealthy = !p.isStale
    && p.mergedPrs30d >= 2
    && p.contributors30d >= 2
    && (p.deploySuccessRate30d === null || p.deploySuccessRate30d >= 90)
    && (p.oldestOpenPrDays ?? 0) <= 14;
  if (isHealthy && out.length === 0) out.push('healthy');
  return out;
}

// ── Per-repo metric fetch ───────────────────────────────────────────────────

async function fetchProjectMetrics(
  octokit: Octokit,
  owner: string,
  repo: {
    name: string; fullName: string; defaultBranch: string; language: string | null;
    htmlUrl: string; topics: string[]; pushedAt: string | null;
  },
  windowStart: Date,
  linkedServiceCount: number,
): Promise<ProjectMetrics> {
  const since = windowStart.toISOString();

  // Run all per-repo calls in parallel. Each may fail independently; we treat
  // failures as empty so one flaky repo doesn't break the whole list.
  const safe = async <T>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  // Minimal local shapes covering only the fields we use. Extracting Octokit's
  // pagination return types via generics fights the type system; this is
  // simpler and equivalent.
  type CommitItem = {
    author?: { login?: string | null } | null;
    commit: { author?: { name?: string | null } | null };
  };
  type PrItem = {
    created_at: string;
    updated_at: string;
    merged_at: string | null;
  };
  type RunItem = {
    conclusion: string | null;
    created_at: string;
    head_branch: string | null;
    actor?: { login?: string | null } | null;
  };

  const [commits, openPrsResult, closedPrs, runs] = await Promise.all([
    safe(
      octokit.paginate(octokit.repos.listCommits, {
        owner, repo: repo.name, since, per_page: 100,
      }) as Promise<CommitItem[]>,
      [] as CommitItem[],
    ),
    safe(
      octokit.paginate(octokit.pulls.list, {
        owner, repo: repo.name, state: 'open', per_page: 100,
      }) as Promise<PrItem[]>,
      [] as PrItem[],
    ),
    safe(
      octokit.paginate(octokit.pulls.list, {
        owner, repo: repo.name, state: 'closed', per_page: 100, sort: 'updated', direction: 'desc',
      }, (response, done) => {
        // PRs are sorted by updatedAt desc — once we hit one updated before
        // the window, no later page can have a merge inside the window.
        const last = response.data[response.data.length - 1];
        if (last && new Date(last.updated_at) < windowStart) done();
        return response.data;
      }) as Promise<PrItem[]>,
      [] as PrItem[],
    ),
    safe(
      octokit.actions.listWorkflowRunsForRepo({
        owner, repo: repo.name, per_page: 100, created: `>=${since}`,
      }).then((r) => r.data.workflow_runs as RunItem[]),
      [] as RunItem[],
    ),
  ]);

  // ── Aggregate commits ──
  const commitAuthors = new Map<string, number>();
  for (const c of commits) {
    const login = c.author?.login ?? c.commit.author?.name ?? null;
    if (!login) continue;
    commitAuthors.set(login, (commitAuthors.get(login) ?? 0) + 1);
  }
  const commits30d = commits.length;
  const contributors30d = commitAuthors.size;
  const topContributor = topByCount(commitAuthors);

  // ── Aggregate PRs ──
  const mergedPrs30d = closedPrs.filter((pr) => pr.merged_at && new Date(pr.merged_at) >= windowStart).length;
  const openPrCount = openPrsResult.length;
  let oldestOpenPrDays: number | null = null;
  for (const pr of openPrsResult) {
    const ageDays = Math.floor((Date.now() - new Date(pr.created_at).getTime()) / DAY_MS);
    if (oldestOpenPrDays === null || ageDays > oldestOpenPrDays) oldestOpenPrDays = ageDays;
  }

  // ── Aggregate workflow runs (deploys) ──
  const deploys = { production: 0, development: 0, total: 0 };
  const lastDeployAt: { production: string | null; development: string | null } = { production: null, development: null };
  let succeeded = 0;
  let completed = 0;
  const deployerBy = {
    production: new Map<string, number>(),
    development: new Map<string, number>(),
    overall: new Map<string, number>(),
  };
  for (const run of runs) {
    if (run.conclusion === 'cancelled' || run.conclusion === 'skipped') continue;
    deploys.total++;
    const env = branchToEnv(run.head_branch);
    if (env === 'production' || env === 'development') {
      deploys[env]++;
      if (!lastDeployAt[env] || run.created_at > lastDeployAt[env]!) lastDeployAt[env] = run.created_at;
    }
    if (run.conclusion) {
      completed++;
      if (run.conclusion === 'success') succeeded++;
    }
    const actor = run.actor?.login;
    if (actor) {
      deployerBy.overall.set(actor, (deployerBy.overall.get(actor) ?? 0) + 1);
      if (env === 'production' || env === 'development') {
        deployerBy[env].set(actor, (deployerBy[env].get(actor) ?? 0) + 1);
      }
    }
  }
  const deploySuccessRate30d = completed > 0 ? Math.round((succeeded / completed) * 1000) / 10 : null;

  // ── Last activity ──
  const lastActivityAt = repo.pushedAt;
  const daysSinceActivity = lastActivityAt
    ? Math.floor((Date.now() - new Date(lastActivityAt).getTime()) / DAY_MS)
    : null;
  const isStale = daysSinceActivity !== null && daysSinceActivity > STALE_DAYS;

  const project: ProjectMetrics = {
    owner,
    repo: repo.name,
    fullName: repo.fullName,
    defaultBranch: repo.defaultBranch,
    language: repo.language,
    htmlUrl: repo.htmlUrl,
    topics: repo.topics,
    lastActivityAt,
    daysSinceActivity,
    isStale,
    commits30d,
    contributors30d,
    topContributor,
    topContributors: topNByCount(commitAuthors, 5),
    openPrCount,
    oldestOpenPrDays,
    mergedPrs30d,
    deploys30d: deploys,
    deploySuccessRate30d,
    lastDeployAt,
    topDeployer: {
      production: topByCount(deployerBy.production),
      development: topByCount(deployerBy.development),
      overall: topByCount(deployerBy.overall),
    },
    topDeployers: {
      production: topNByCount(deployerBy.production, 5),
      development: topNByCount(deployerBy.development, 5),
      overall: topNByCount(deployerBy.overall, 5),
    },
    linkedServiceCount,
    signals: [],
  };
  project.signals = deriveSignals(project);
  return project;
}

// ── List aggregator (fast — no per-repo metrics) ─────────────────────────────

async function buildProjectsList(
  searchServices: SearchServicesHandler,
  org: string,
): Promise<ProjectsListResponse> {
  const ghClient = new GitHubClient();
  const reposResult = await ghClient.listOrgRepos(org);
  if (!reposResult.ok) {
    throw new Error(`Failed to list org repos: ${reposResult.error.message}`);
  }
  const allRepos = reposResult.value;
  const activeRepos = allRepos.filter((r) => !r.archived);
  const excludedArchived = allRepos.length - activeRepos.length;

  // Catalog drain → repoUrl → linked service count
  const linkCount = new Map<string, number>();
  let cursor: string | undefined;
  do {
    const r = await searchServices.execute({ pagination: { limit: 500, cursor } });
    if (!r.ok) break;
    for (const svc of r.value.items) {
      const url = svc.repositoryUrl.toLowerCase();
      linkCount.set(url, (linkCount.get(url) ?? 0) + 1);
    }
    cursor = r.value.nextCursor;
  } while (cursor);

  const repos: ProjectListing[] = activeRepos.map((repo) => ({
    owner: org,
    repo: repo.name,
    fullName: repo.fullName,
    defaultBranch: repo.defaultBranch,
    language: repo.language,
    htmlUrl: repo.htmlUrl,
    topics: repo.topics,
    linkedServiceCount: linkCount.get(repo.htmlUrl.toLowerCase()) ?? 0,
  }));

  return {
    generatedAt: new Date().toISOString(),
    staleCutoffDays: STALE_DAYS,
    windowDays: WINDOW_DAYS,
    total: repos.length,
    excludedArchived,
    repos,
  };
}

// ── Per-repo metrics fetch (lazy — one repo at a time) ──────────────────────

async function buildRepoMetrics(
  searchServices: SearchServicesHandler,
  org: string,
  repoName: string,
): Promise<ProjectMetrics> {
  const ghClient = new GitHubClient();
  const octokit = new Octokit({ auth: process.env['GITHUB_TOKEN'] });
  const windowStart = new Date(Date.now() - WINDOW_DAYS * DAY_MS);

  // Need the repo metadata (pushedAt etc.) — pull from the cached list if
  // available, else hit GitHub.
  let listing: ProjectListing | undefined;
  if (listCache) {
    listing = listCache.payload.repos.find((r) => r.repo === repoName);
  }
  // We always need the GitHub repo object for pushedAt/topics. Use list cache
  // for linkedServiceCount, otherwise compute fresh.
  const reposResult = await ghClient.listOrgRepos(org);
  if (!reposResult.ok) throw new Error(`Failed to list org repos: ${reposResult.error.message}`);
  const repo = reposResult.value.find((r) => r.name === repoName);
  if (!repo) throw new Error(`Repo ${org}/${repoName} not found or archived`);

  let linkedServiceCount = listing?.linkedServiceCount;
  if (linkedServiceCount === undefined) {
    let count = 0;
    let cursor: string | undefined;
    do {
      const r = await searchServices.execute({ pagination: { limit: 500, cursor } });
      if (!r.ok) break;
      for (const svc of r.value.items) {
        if (svc.repositoryUrl.toLowerCase() === repo.htmlUrl.toLowerCase()) count++;
      }
      cursor = r.value.nextCursor;
    } while (cursor);
    linkedServiceCount = count;
  }

  return fetchProjectMetrics(octokit, org, {
    name: repo.name,
    fullName: repo.fullName,
    defaultBranch: repo.defaultBranch,
    language: repo.language,
    htmlUrl: repo.htmlUrl,
    topics: repo.topics,
    pushedAt: repo.pushedAt,
  }, windowStart, linkedServiceCount);
}

// ── Detail endpoint types ────────────────────────────────────────────────────

interface PrReview {
  number: number;
  title: string;
  author: string;
  ageDays: number;
  htmlUrl: string;
  draft: boolean;
}

interface RecentRun {
  id: number;
  name: string;
  branch: string | null;
  env: Environment;
  status: string;
  conclusion: string | null;
  actor: string | null;
  startedAt: string;
  durationSeconds: number | null;
  htmlUrl: string;
}

interface LinkedAwsResource {
  resourceType: string;       // ECS_SERVICE | LAMBDA | ...
  identifier: string;
  region: string;
  arn?: string;
  clusterName?: string;
  consoleUrl: string;
  errors24h: number | null;   // null if metric not available
  invocations24h: number | null;
}

interface LinkedService {
  serviceId: string;
  serviceName: string;
  environments: string[];
  resources: { production: LinkedAwsResource[]; development: LinkedAwsResource[] };
}

interface ReviewStats {
  sampleSize: number;
  medianTimeToFirstReviewHours: number | null;
  p90TimeToFirstReviewHours: number | null;
}

interface CostBreakdown {
  available: boolean;
  reason: string | null;
  monthlyTotal: number | null;
  currency: string | null;
  byTag: { tag: string; amount: number }[];
}

interface ProjectDetail {
  metrics: ProjectMetrics;
  openPrs: PrReview[];
  reviewStats: ReviewStats;
  recentRuns: RecentRun[];
  linkedServices: LinkedService[];
  cost: CostBreakdown;
  generatedAt: string;
}

// ── Detail helpers ───────────────────────────────────────────────────────────

const HOUR_MS = 3_600_000;
const DETAIL_CACHE_TTL_MS = 5 * 60_000;
const detailCache = new Map<string, { generatedAt: number; payload: ProjectDetail }>();
const detailInflight = new Map<string, Promise<ProjectDetail>>();

function awsConsoleUrl(resource: { resourceType: string; identifier: string; region: string; arn?: string; clusterName?: string }): string {
  const r = resource.region;
  switch (resource.resourceType) {
    case 'LAMBDA':
      return `https://${r}.console.aws.amazon.com/lambda/home?region=${r}#/functions/${encodeURIComponent(resource.identifier)}?tab=monitor`;
    case 'ECS_SERVICE':
      return resource.clusterName
        ? `https://${r}.console.aws.amazon.com/ecs/v2/clusters/${encodeURIComponent(resource.clusterName)}/services/${encodeURIComponent(resource.identifier)}/health?region=${r}`
        : `https://${r}.console.aws.amazon.com/ecs/home?region=${r}#/clusters`;
    case 'RDS':
      return `https://${r}.console.aws.amazon.com/rds/home?region=${r}#database:id=${encodeURIComponent(resource.identifier)}`;
    case 'S3_BUCKET':
      return `https://${r}.console.aws.amazon.com/s3/buckets/${encodeURIComponent(resource.identifier)}?region=${r}`;
    case 'ECR_REPOSITORY':
      return `https://${r}.console.aws.amazon.com/ecr/repositories/private/${encodeURIComponent(resource.identifier)}?region=${r}`;
    default:
      return `https://${r}.console.aws.amazon.com/console/home?region=${r}`;
  }
}

/** Compute time-to-first-review for each merged PR; aggregate to median + p90. */
async function computeReviewStats(
  octokit: Octokit,
  owner: string,
  repo: string,
  windowStart: Date,
): Promise<ReviewStats> {
  type ListPr = Awaited<ReturnType<typeof octokit.pulls.list>>['data'][number];
  let mergedPrs: ListPr[] = [];
  try {
    mergedPrs = await octokit.paginate(octokit.pulls.list, {
      owner, repo, state: 'closed', per_page: 100, sort: 'updated', direction: 'desc',
    }, (response, done) => {
      const last = response.data[response.data.length - 1];
      if (last && new Date(last.updated_at) < windowStart) done();
      return response.data;
    }) as ListPr[];
  } catch {
    return { sampleSize: 0, medianTimeToFirstReviewHours: null, p90TimeToFirstReviewHours: null };
  }
  const merged = mergedPrs.filter((p) => p.merged_at && new Date(p.merged_at) >= windowStart);
  if (merged.length === 0) {
    return { sampleSize: 0, medianTimeToFirstReviewHours: null, p90TimeToFirstReviewHours: null };
  }

  // Cap to most recent 30 PRs to bound API calls
  const sample = merged.slice(0, 30);
  const reviewWaitsHours: number[] = [];

  await Promise.all(sample.map(async (pr) => {
    try {
      const reviews = await octokit.paginate(octokit.pulls.listReviews, {
        owner, repo, pull_number: pr.number, per_page: 100,
      }) as Array<{ submitted_at: string | null; user: { login: string } | null }>;
      const own = pr.user?.login;
      // First review by someone other than the PR author (drop self-reviews
      // and dependabot acks).
      const firstReview = reviews
        .filter((r) => r.submitted_at && r.user?.login && r.user.login !== own)
        .sort((a, b) => new Date(a.submitted_at!).getTime() - new Date(b.submitted_at!).getTime())[0];
      if (!firstReview || !firstReview.submitted_at) return;
      const waitMs = new Date(firstReview.submitted_at).getTime() - new Date(pr.created_at).getTime();
      if (waitMs >= 0) reviewWaitsHours.push(waitMs / HOUR_MS);
    } catch {
      // Skip PRs we can't read reviews for
    }
  }));

  if (reviewWaitsHours.length === 0) {
    return { sampleSize: 0, medianTimeToFirstReviewHours: null, p90TimeToFirstReviewHours: null };
  }
  reviewWaitsHours.sort((a, b) => a - b);
  const median = reviewWaitsHours[Math.floor(reviewWaitsHours.length / 2)]!;
  const p90Idx = Math.min(reviewWaitsHours.length - 1, Math.ceil(reviewWaitsHours.length * 0.9) - 1);
  const p90 = reviewWaitsHours[Math.max(0, p90Idx)]!;
  return {
    sampleSize: reviewWaitsHours.length,
    medianTimeToFirstReviewHours: Math.round(median * 10) / 10,
    p90TimeToFirstReviewHours: Math.round(p90 * 10) / 10,
  };
}

async function fetchOpenPrsDetail(octokit: Octokit, owner: string, repo: string): Promise<PrReview[]> {
  try {
    const list = await octokit.paginate(octokit.pulls.list, {
      owner, repo, state: 'open', per_page: 100,
    }) as Array<{ number: number; title: string; user: { login: string } | null; created_at: string; html_url: string; draft: boolean }>;
    return list.map((p) => ({
      number: p.number,
      title: p.title,
      author: p.user?.login ?? 'unknown',
      ageDays: Math.floor((Date.now() - new Date(p.created_at).getTime()) / DAY_MS),
      htmlUrl: p.html_url,
      draft: p.draft,
    })).sort((a, b) => b.ageDays - a.ageDays);
  } catch {
    return [];
  }
}

async function fetchRecentRuns(
  octokit: Octokit,
  owner: string,
  repo: string,
  windowStart: Date,
): Promise<RecentRun[]> {
  try {
    const result = await octokit.actions.listWorkflowRunsForRepo({
      owner, repo, per_page: 20, created: `>=${windowStart.toISOString()}`,
    });
    return result.data.workflow_runs.map((r) => {
      const env = branchToEnv(r.head_branch ?? null);
      const startedAt = r.run_started_at ?? r.created_at;
      const durationSeconds = r.conclusion
        ? Math.round((new Date(r.updated_at).getTime() - new Date(startedAt).getTime()) / 1000)
        : null;
      return {
        id: r.id,
        name: r.name ?? r.display_title ?? 'workflow',
        branch: r.head_branch ?? null,
        env,
        status: r.status ?? 'unknown',
        conclusion: r.conclusion ?? null,
        actor: r.actor?.login ?? null,
        startedAt,
        durationSeconds,
        htmlUrl: r.html_url,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Cross-references the catalogued AWS resources for a repo against CloudWatch
 * for last-24h error counts. Lambda → Errors metric, ECS → no clean error
 * metric (left null), others → null.
 */
async function fetchResourceErrors(
  cw: CloudWatchClient,
  resources: LinkedAwsResource[],
): Promise<void> {
  const lambdaResources = resources.filter((r) => r.resourceType === 'LAMBDA');
  if (lambdaResources.length === 0) return;
  const queries: MetricDataQuery[] = [];
  lambdaResources.forEach((r, i) => {
    queries.push({
      Id: `e${i}`,
      MetricStat: {
        Metric: { Namespace: 'AWS/Lambda', MetricName: 'Errors', Dimensions: [{ Name: 'FunctionName', Value: r.identifier }] },
        Period: 86_400,
        Stat: 'Sum',
      },
      ReturnData: true,
    });
    queries.push({
      Id: `i${i}`,
      MetricStat: {
        Metric: { Namespace: 'AWS/Lambda', MetricName: 'Invocations', Dimensions: [{ Name: 'FunctionName', Value: r.identifier }] },
        Period: 86_400,
        Stat: 'Sum',
      },
      ReturnData: true,
    });
  });
  const end = new Date();
  const start = new Date(end.getTime() - 24 * HOUR_MS);
  try {
    const result = await cw.send(new GetMetricDataCommand({
      MetricDataQueries: queries,
      StartTime: start,
      EndTime: end,
      ScanBy: 'TimestampDescending',
    }));
    for (const r of result.MetricDataResults ?? []) {
      const id = r.Id ?? '';
      const idx = Number(id.slice(1));
      const target = lambdaResources[idx];
      if (!target) continue;
      const sum = (r.Values ?? []).reduce((s, v) => s + v, 0);
      if (id.startsWith('e')) target.errors24h = Math.round(sum);
      else if (id.startsWith('i')) target.invocations24h = Math.round(sum);
    }
  } catch (err) {
    console.warn('[projects:detail] CloudWatch errors fetch failed:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Best-effort per-repo cost. Cost Explorer doesn't naturally know about
 * GitHub repos, so we GROUP BY the `Service` cost-allocation tag and only
 * keep groups whose tag value matches a linked service name. Returns
 * available=false when no matching tags exist (the typical case until tag
 * conventions are wired up).
 */
async function fetchRepoCost(
  ce: CostExplorerClient,
  linkedServiceNames: string[],
): Promise<CostBreakdown> {
  if (linkedServiceNames.length === 0) {
    return { available: false, reason: 'No catalogued services link to this repo.', monthlyTotal: null, currency: null, byTag: [] };
  }
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const end = now.toISOString().slice(0, 10);
  try {
    const result = await ce.send(new GetCostAndUsageCommand({
      TimePeriod: { Start: start, End: end },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'TAG', Key: 'Service' }],
    }));
    const wanted = new Set(linkedServiceNames.map((n) => n.toLowerCase()));
    const byTag: { tag: string; amount: number }[] = [];
    let total = 0;
    let currency = 'USD';
    for (const period of result.ResultsByTime ?? []) {
      for (const group of period.Groups ?? []) {
        const rawKey = group.Keys?.[0] ?? '';
        // Cost Explorer returns tag values as "Service$<value>"
        const tagValue = rawKey.includes('$') ? rawKey.split('$')[1]! : rawKey;
        if (!tagValue) continue;
        if (!wanted.has(tagValue.toLowerCase())) continue;
        const amt = Number(group.Metrics?.['UnblendedCost']?.Amount ?? '0');
        currency = group.Metrics?.['UnblendedCost']?.Unit ?? currency;
        if (amt > 0) {
          byTag.push({ tag: tagValue, amount: Math.round(amt * 100) / 100 });
          total += amt;
        }
      }
    }
    if (byTag.length === 0) {
      return {
        available: false,
        reason: 'No Service-tagged spend matched this repo. Apply a `Service=<service-name>` cost-allocation tag to enable per-repo cost.',
        monthlyTotal: null,
        currency: null,
        byTag: [],
      };
    }
    return {
      available: true,
      reason: null,
      monthlyTotal: Math.round(total * 100) / 100,
      currency,
      byTag,
    };
  } catch (err) {
    return {
      available: false,
      reason: `Cost Explorer call failed: ${err instanceof Error ? err.message : String(err)}`,
      monthlyTotal: null,
      currency: null,
      byTag: [],
    };
  }
}

// ── Detail aggregator ────────────────────────────────────────────────────────

async function buildProjectDetail(
  searchServices: SearchServicesHandler,
  owner: string,
  repoName: string,
): Promise<ProjectDetail> {
  const ghClient = new GitHubClient();
  const octokit = new Octokit({ auth: process.env['GITHUB_TOKEN'] });
  const region = process.env['AWS_REGION'] ?? 'me-south-1';
  const credentials = credentialStore.getProvider();
  const cw = new CloudWatchClient({ region, credentials });
  const ce = new CostExplorerClient({ region, credentials });
  const windowStart = new Date(Date.now() - WINDOW_DAYS * DAY_MS);

  // Find the repo metadata + linked services
  const reposResult = await ghClient.listOrgRepos(owner);
  if (!reposResult.ok) {
    throw new Error(`Failed to list org repos: ${reposResult.error.message}`);
  }
  const repo = reposResult.value.find((r) => r.name === repoName);
  if (!repo) {
    throw new Error(`Repo ${owner}/${repoName} not found in org`);
  }

  // Drain catalog services, filter to ones pointing at this repo
  const linkedServices: LinkedService[] = [];
  let cursor: string | undefined;
  do {
    const r = await searchServices.execute({ pagination: { limit: 500, cursor } });
    if (!r.ok) break;
    for (const svc of r.value.items) {
      if (svc.repositoryUrl.toLowerCase() !== repo.htmlUrl.toLowerCase()) continue;
      const prodResources = (svc.awsResources['production'] ?? []).map((res): LinkedAwsResource => ({
        resourceType: res.resourceType,
        identifier: res.identifier,
        region: res.region,
        arn: res.arn,
        clusterName: res.clusterName,
        consoleUrl: awsConsoleUrl(res),
        errors24h: null,
        invocations24h: null,
      }));
      const devResources = (svc.awsResources['development'] ?? []).map((res): LinkedAwsResource => ({
        resourceType: res.resourceType,
        identifier: res.identifier,
        region: res.region,
        arn: res.arn,
        clusterName: res.clusterName,
        consoleUrl: awsConsoleUrl(res),
        errors24h: null,
        invocations24h: null,
      }));
      linkedServices.push({
        serviceId: svc.serviceId,
        serviceName: svc.serviceName,
        environments: svc.environments,
        resources: { production: prodResources, development: devResources },
      });
    }
    cursor = r.value.nextCursor;
  } while (cursor);

  // Fetch in parallel: per-repo metrics, open PRs, review stats, recent runs, errors
  const linkCount = linkedServices.length;
  const [metrics, openPrs, reviewStats, recentRuns] = await Promise.all([
    fetchProjectMetrics(octokit, owner, {
      name: repo.name,
      fullName: repo.fullName,
      defaultBranch: repo.defaultBranch,
      language: repo.language,
      htmlUrl: repo.htmlUrl,
      topics: repo.topics,
      pushedAt: repo.pushedAt,
    }, windowStart, linkCount),
    fetchOpenPrsDetail(octokit, owner, repo.name),
    computeReviewStats(octokit, owner, repo.name, windowStart),
    fetchRecentRuns(octokit, owner, repo.name, windowStart),
  ]);

  // Errors per linked Lambda resource (mutates the resource arrays in place)
  const allResources = linkedServices.flatMap((s) => [...s.resources.production, ...s.resources.development]);
  await fetchResourceErrors(cw, allResources);

  // Cost (best-effort)
  const cost = await fetchRepoCost(ce, linkedServices.map((s) => s.serviceName));

  return {
    metrics,
    openPrs,
    reviewStats,
    recentRuns,
    linkedServices,
    cost,
    generatedAt: new Date().toISOString(),
  };
}

// ── Router ───────────────────────────────────────────────────────────────────

export function createProjectsRouter(searchServices: SearchServicesHandler): Router {
  const router = Router();

  // GET / — fast list of non-archived repos with linked-service counts. The
  // frontend renders skeleton rows from this and lazy-fetches per-repo metrics.
  router.get('/', async (_req, res) => {
    const org = process.env['GITHUB_ORG'];
    if (!org) {
      res.status(500).json({
        type: 'about:blank',
        title: 'GitHub org not configured',
        status: 500,
        detail: 'GITHUB_ORG environment variable is required.',
      });
      return;
    }

    const now = Date.now();
    if (listCache && now - listCache.generatedAt < CACHE_TTL_MS) {
      res.json(listCache.payload);
      return;
    }

    if (!listInflight) {
      listInflight = (async () => {
        try {
          const payload = await buildProjectsList(searchServices, org);
          listCache = { generatedAt: Date.now(), payload };
          return payload;
        } finally {
          listInflight = null;
        }
      })();
    }

    try {
      const payload = await listInflight;
      res.json(payload);
    } catch (err) {
      console.warn('[projects] list failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({
        type: 'about:blank',
        title: 'Project list failed',
        status: 500,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // GET /metrics/:owner/:repo — per-repo metrics for the list view. Cached
  // per repo (5 min) with single-flight dedup. The frontend fans out one of
  // these per row so each card lights up independently.
  router.get('/metrics/:owner/:repo', async (req, res) => {
    const owner = String(req.params['owner'] ?? '');
    const repoName = String(req.params['repo'] ?? '');
    if (!owner || !repoName) {
      res.status(400).json({
        type: 'about:blank', title: 'Bad request', status: 400,
        detail: 'owner and repo path params are required',
      });
      return;
    }
    const key = `${owner}/${repoName}`;
    const now = Date.now();
    const cached = metricsCache.get(key);
    if (cached && now - cached.generatedAt < CACHE_TTL_MS) {
      res.json(cached.payload);
      return;
    }

    let inflight = metricsInflight.get(key);
    if (!inflight) {
      inflight = (async () => {
        try {
          const payload = await buildRepoMetrics(searchServices, owner, repoName);
          metricsCache.set(key, { generatedAt: Date.now(), payload });
          return payload;
        } finally {
          metricsInflight.delete(key);
        }
      })();
      metricsInflight.set(key, inflight);
    }

    try {
      const payload = await inflight;
      res.json(payload);
    } catch (err) {
      console.warn(`[projects:metrics] ${key} failed:`, err instanceof Error ? err.message : String(err));
      res.status(500).json({
        type: 'about:blank', title: 'Project metrics failed', status: 500,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // GET /:owner/:repo — per-project drawer detail. Cached separately per repo.
  router.get('/:owner/:repo', async (req, res) => {
    const owner = String(req.params['owner'] ?? '');
    const repoName = String(req.params['repo'] ?? '');
    if (!owner || !repoName) {
      res.status(400).json({
        type: 'about:blank',
        title: 'Bad request',
        status: 400,
        detail: 'owner and repo path params are required',
      });
      return;
    }
    const key = `${owner}/${repoName}`;
    const now = Date.now();
    const cached = detailCache.get(key);
    if (cached && now - cached.generatedAt < DETAIL_CACHE_TTL_MS) {
      res.json(cached.payload);
      return;
    }

    let inflight = detailInflight.get(key);
    if (!inflight) {
      inflight = (async () => {
        try {
          const payload = await buildProjectDetail(searchServices, owner, repoName);
          detailCache.set(key, { generatedAt: Date.now(), payload });
          return payload;
        } finally {
          detailInflight.delete(key);
        }
      })();
      detailInflight.set(key, inflight);
    }

    try {
      const payload = await inflight;
      res.json(payload);
    } catch (err) {
      console.warn(`[projects:detail] ${key} failed:`, err instanceof Error ? err.message : String(err));
      res.status(500).json({
        type: 'about:blank',
        title: 'Project detail failed',
        status: 500,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
