import { Router } from 'express';
import { Octokit } from '@octokit/rest';
import { GitHubClient, type GitHubRepo } from '@wep/github-client';
import { withGitHubLimit, recordRateLimit } from '../services/github-throttle.js';

// ── Constants ────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const WEEK_MS = 7 * DAY_MS;
const REDEPLOY_WINDOW_MS = 4 * HOUR_MS;
const CACHE_TTL_MS = 30 * 60_000;
const MIN_WEEKS = 4;
const MAX_WEEKS = 12;
const DEFAULT_WEEKS = 12;
const PR_PAGE_CAP = 30;
const COMMIT_PAGE_CAP = 40;

const HOTFIX_BRANCH_RE = /^(hotfix|fix|revert)[/-]/i;
const REVERT_COMMIT_RE = /^revert\b/i;

// ── Types ────────────────────────────────────────────────────────────────────

type Environment = 'production' | 'development' | 'unknown';

export interface QualityRepoListing {
  owner: string;
  repo: string;
  fullName: string;
  htmlUrl: string;
  language: string | null;
  pushedAt: string | null;
  defaultBranch: string;
}

// ── Artifact types — the actual events behind each metric ────────────────────

export interface RevertCommitArtifact {
  sha: string;
  shortSha: string;
  message: string;
  branch: string;          // the repo's default branch (where listCommits sources from)
  authorLogin: string | null;
  authorName: string | null;
  date: string;            // commit author date
  htmlUrl: string;
}

export interface HotfixDeployArtifact {
  workflowName: string;
  branch: string;
  actor: string | null;
  conclusion: string;
  startedAt: string;
  htmlUrl: string;
}

export interface FailedDeployArtifact {
  workflowName: string;
  branch: string;
  actor: string | null;
  conclusion: string;      // 'failure' | 'timed_out'
  startedAt: string;
  htmlUrl: string;
}

export type RedeployReason = 'manual-re-run' | 'same-sha' | 'fix-forward';

export interface RedeployArtifact {
  branch: string;
  actor: string | null;
  startedAt: string;          // the deploy that was flagged
  prevStartedAt: string | null;
  gapMinutes: number | null;
  htmlUrl: string;
  prevHtmlUrl: string | null;
  reason: RedeployReason;
  /** Truncated head_sha (7 chars) of this deploy. */
  shortSha: string;
  /** Truncated head_sha of the previous deploy (when applicable). */
  prevShortSha: string | null;
  prevConclusion: string | null;
}

export interface QualityArtifacts {
  revertCommits: RevertCommitArtifact[];
  hotfixDeploys: HotfixDeployArtifact[];
  failedDeploys: FailedDeployArtifact[];
  sameDayRedeploys: RedeployArtifact[];
}

export interface QualityReposResponse {
  weeks: number;
  windowStart: string;
  windowEnd: string;
  repos: QualityRepoListing[];
  excludedArchived: number;
  excludedQuiet: number;
  generatedAt: string;
}

export interface QualityWeekBucket {
  weekStart: string;
  weekEnd: string;
  prodDeploys: number;
  totalDeploys: number;
  succeededDeploys: number;
  completedDeploys: number;
  failedDeploys: number;
  hotfixDeploys: number;
  sameDayRedeploys: number;
  revertCommits: number;
}

export interface QualityRepoResponse {
  owner: string;
  repo: string;
  defaultBranch: string;
  windowStart: string;
  windowEnd: string;
  weeks: QualityWeekBucket[];
  artifacts: QualityArtifacts;
  generatedAt: string;
}

// ── Cache ────────────────────────────────────────────────────────────────────

interface ListCacheEntry { generatedAt: number; payload: QualityReposResponse }
interface RepoCacheEntry { generatedAt: number; payload: QualityRepoResponse }
const listCache = new Map<string, ListCacheEntry>();
const listInflight = new Map<string, Promise<QualityReposResponse>>();
const repoCache = new Map<string, RepoCacheEntry>();
const repoInflight = new Map<string, Promise<QualityRepoResponse>>();

// ── Window resolution ────────────────────────────────────────────────────────

function roundToHour(d: Date): Date {
  const out = new Date(d);
  out.setUTCMinutes(0, 0, 0);
  return out;
}

function clampWeeks(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_WEEKS;
  return Math.max(MIN_WEEKS, Math.min(MAX_WEEKS, Math.round(n)));
}

interface ResolvedWindow {
  weeks: number;
  start: Date;
  end: Date;
}

function resolveWindow(raw: unknown): ResolvedWindow {
  const weeks = clampWeeks(raw);
  const end = roundToHour(new Date());
  const start = new Date(end.getTime() - weeks * WEEK_MS);
  return { weeks, start, end };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function branchToEnv(branch: string | null): Environment {
  if (!branch) return 'unknown';
  const b = branch.toLowerCase();
  if (['main', 'master', 'prod', 'production', 'release'].includes(b)) return 'production';
  if (b.startsWith('release/')) return 'production';
  if (['develop', 'dev', 'development', 'staging'].includes(b)) return 'development';
  return 'unknown';
}

function isHotfixBranch(branch: string | null): boolean {
  if (!branch) return false;
  return HOTFIX_BRANCH_RE.test(branch);
}

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p; } catch { return fallback; }
}

// ── Per-repo fetch ───────────────────────────────────────────────────────────

interface BagRun {
  id: number;
  name?: string | null;
  display_title?: string;
  head_branch: string | null;
  head_sha: string;
  run_attempt?: number | null;
  status: string | null;
  conclusion: string | null;
  actor?: { login?: string | null } | null;
  run_started_at?: string | null;
  created_at: string;
  html_url: string;
}

interface BagCommit {
  sha: string;
  html_url: string;
  author: { login?: string | null } | null;
  commit: {
    message: string;
    author: { name?: string | null; date?: string | null } | null;
  };
}

interface RepoBag {
  runs: BagRun[];
  commits: BagCommit[];
}

// ── Org-repos cache (so per-repo handlers can resolve defaultBranch cheaply) ──

interface OrgReposCacheEntry { repos: GitHubRepo[]; expiresAt: number }
const orgReposCache = new Map<string, OrgReposCacheEntry>();
const orgReposInflight = new Map<string, Promise<GitHubRepo[]>>();
const ORG_REPOS_TTL_MS = 5 * 60_000;

async function getOrgRepos(org: string): Promise<GitHubRepo[]> {
  const cached = orgReposCache.get(org);
  if (cached && cached.expiresAt > Date.now()) return cached.repos;
  let p = orgReposInflight.get(org);
  if (!p) {
    p = (async () => {
      try {
        const ghClient = new GitHubClient();
        const result = await ghClient.listOrgRepos(org);
        if (!result.ok) throw new Error(result.error.message);
        orgReposCache.set(org, { repos: result.value, expiresAt: Date.now() + ORG_REPOS_TTL_MS });
        return result.value;
      } finally {
        orgReposInflight.delete(org);
      }
    })();
    orgReposInflight.set(org, p);
  }
  return p;
}

async function fetchRepoBag(
  octokit: Octokit,
  owner: string,
  repo: string,
  start: Date,
  end: Date,
): Promise<RepoBag> {
  const since = start.toISOString();
  const until = end.toISOString();

  const [runs, commits] = await Promise.all([
    safe(
      withGitHubLimit(async (): Promise<BagRun[]> => {
        // Workflow runs paginated by created date filter.
        const all: BagRun[] = [];
        let page = 1;
        while (page <= PR_PAGE_CAP) {
          const r = await octokit.actions.listWorkflowRunsForRepo({
            owner, repo, per_page: 100, created: `${since}..${until}`, page,
          });
          recordRateLimit(r.headers);
          all.push(...(r.data.workflow_runs as BagRun[]));
          if (r.data.workflow_runs.length < 100) break;
          page++;
        }
        return all;
      }),
      [] as BagRun[],
    ),
    safe(
      withGitHubLimit(async (): Promise<BagCommit[]> => {
        let pages = 0;
        return octokit.paginate(octokit.repos.listCommits, {
          owner, repo, since, until, per_page: 100,
        }, (response, done) => {
          recordRateLimit(response.headers);
          pages++;
          if (pages >= COMMIT_PAGE_CAP) done();
          return response.data;
        }) as Promise<BagCommit[]>;
      }),
      [] as BagCommit[],
    ),
  ]);

  return { runs, commits };
}

// ── Bucketing ────────────────────────────────────────────────────────────────

/**
 * 7-day rolling buckets ending at `end`. bucket[0] = oldest, bucket[N-1] = newest.
 * Each bucket spans [end - (i+1)*7d, end - i*7d). Same boundaries cross repos
 * because they're computed from the same `end` rounded to the hour.
 */
function makeBuckets(start: Date, end: Date, weeks: number): QualityWeekBucket[] {
  const out: QualityWeekBucket[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const bucketEnd = new Date(end.getTime() - i * WEEK_MS);
    const bucketStart = new Date(bucketEnd.getTime() - WEEK_MS);
    // Clamp the oldest bucket to never start before the requested window
    const effectiveStart = bucketStart.getTime() < start.getTime() ? start : bucketStart;
    out.push({
      weekStart: effectiveStart.toISOString(),
      weekEnd: bucketEnd.toISOString(),
      prodDeploys: 0,
      totalDeploys: 0,
      succeededDeploys: 0,
      completedDeploys: 0,
      failedDeploys: 0,
      hotfixDeploys: 0,
      sameDayRedeploys: 0,
      revertCommits: 0,
    });
  }
  return out;
}

function bucketIndex(buckets: QualityWeekBucket[], iso: string | null | undefined): number {
  if (!iso) return -1;
  const t = new Date(iso).getTime();
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i]!;
    if (t >= new Date(b.weekStart).getTime() && t < new Date(b.weekEnd).getTime()) return i;
  }
  return -1;
}

function aggregateRepo(bag: RepoBag, start: Date, end: Date, weeks: number, defaultBranch: string): { weeks: QualityWeekBucket[]; artifacts: QualityArtifacts } {
  const buckets = makeBuckets(start, end, weeks);
  const artifacts: QualityArtifacts = {
    revertCommits: [],
    hotfixDeploys: [],
    failedDeploys: [],
    sameDayRedeploys: [],
  };

  // Workflow runs → deploy stats + artifacts per bucket
  for (const run of bag.runs) {
    if (run.conclusion === 'cancelled' || run.conclusion === 'skipped') continue;
    const startedAt = run.run_started_at ?? run.created_at;
    const idx = bucketIndex(buckets, startedAt);
    if (idx < 0) continue;
    const b = buckets[idx]!;
    b.totalDeploys++;
    if (run.conclusion) {
      b.completedDeploys++;
      if (run.conclusion === 'success') b.succeededDeploys++;
      else if (run.conclusion === 'failure' || run.conclusion === 'timed_out') {
        b.failedDeploys++;
        artifacts.failedDeploys.push({
          workflowName: run.name ?? run.display_title ?? 'workflow',
          branch: run.head_branch ?? '',
          actor: run.actor?.login ?? null,
          conclusion: run.conclusion,
          startedAt,
          htmlUrl: run.html_url,
        });
      }
    }
    if (branchToEnv(run.head_branch) === 'production') b.prodDeploys++;
    if (isHotfixBranch(run.head_branch)) {
      b.hotfixDeploys++;
      artifacts.hotfixDeploys.push({
        workflowName: run.name ?? run.display_title ?? 'workflow',
        branch: run.head_branch ?? '',
        actor: run.actor?.login ?? null,
        conclusion: run.conclusion ?? run.status ?? 'unknown',
        startedAt,
        htmlUrl: run.html_url,
      });
    }
  }

  // Same-day re-deploys — only count REAL redeploys, not "two unrelated PRs that
  // both happened to ship within 4h of each other". Three accepted patterns:
  //
  //   1. manual-re-run : the run itself is run_attempt > 1 (someone hit "Re-run")
  //   2. same-sha      : same head_sha as a prior successful prod run within 4h
  //   3. fix-forward   : a FAILED prod run on this repo was followed within 4h
  //                      by a successful prod run (any sha — patching forward)
  //
  // Two successful prod runs with different SHAs are NOT counted — that's normal
  // back-to-back shipping, not re-deploying.
  const prodRuns = bag.runs
    .filter((r) => branchToEnv(r.head_branch) === 'production')
    .filter((r) => r.conclusion !== 'cancelled' && r.conclusion !== 'skipped')
    .sort((a, b) => new Date(a.run_started_at ?? a.created_at).getTime() - new Date(b.run_started_at ?? b.created_at).getTime());

  for (let i = 0; i < prodRuns.length; i++) {
    const curr = prodRuns[i]!;
    if (curr.conclusion !== 'success') continue;
    const currStart = curr.run_started_at ?? curr.created_at;
    const idx = bucketIndex(buckets, currStart);
    if (idx < 0) continue;

    let reason: RedeployReason | null = null;
    let prev: BagRun | null = null;

    // Pattern 1: manual re-run
    if ((curr.run_attempt ?? 1) > 1) {
      reason = 'manual-re-run';
    }

    // Walk back through prior prod runs within the 4h window
    if (!reason) {
      for (let j = i - 1; j >= 0; j--) {
        const candidate = prodRuns[j]!;
        const candStart = candidate.run_started_at ?? candidate.created_at;
        const gap = new Date(currStart).getTime() - new Date(candStart).getTime();
        if (gap >= REDEPLOY_WINDOW_MS) break;     // outside the window — stop walking back
        // Pattern 2: same SHA as a prior successful prod run
        if (candidate.conclusion === 'success' && candidate.head_sha === curr.head_sha) {
          reason = 'same-sha';
          prev = candidate;
          break;
        }
        // Pattern 3: fix-forward after a failure
        if (candidate.conclusion === 'failure' || candidate.conclusion === 'timed_out') {
          reason = 'fix-forward';
          prev = candidate;
          break;
        }
      }
    }

    if (!reason) continue;

    buckets[idx]!.sameDayRedeploys++;
    const prevStart = prev ? (prev.run_started_at ?? prev.created_at) : null;
    artifacts.sameDayRedeploys.push({
      branch: curr.head_branch ?? '',
      actor: curr.actor?.login ?? null,
      startedAt: currStart,
      prevStartedAt: prevStart,
      gapMinutes: prevStart ? Math.round((new Date(currStart).getTime() - new Date(prevStart).getTime()) / 60_000) : null,
      htmlUrl: curr.html_url,
      prevHtmlUrl: prev?.html_url ?? null,
      reason,
      shortSha: curr.head_sha.slice(0, 7),
      prevShortSha: prev?.head_sha.slice(0, 7) ?? null,
      prevConclusion: prev?.conclusion ?? null,
    });
  }

  // Revert commits + artifacts (always sourced from default branch since
  // listCommits without `sha` returns commits on the repo's default branch)
  for (const c of bag.commits) {
    const date = c.commit.author?.date;
    if (!date) continue;
    if (!REVERT_COMMIT_RE.test(c.commit.message)) continue;
    const idx = bucketIndex(buckets, date);
    if (idx < 0) continue;
    buckets[idx]!.revertCommits++;
    const firstLine = c.commit.message.split('\n')[0] ?? '';
    artifacts.revertCommits.push({
      sha: c.sha,
      shortSha: c.sha.slice(0, 7),
      message: firstLine,
      branch: defaultBranch,
      authorLogin: c.author?.login ?? null,
      authorName: c.commit.author?.name ?? null,
      date,
      htmlUrl: c.html_url,
    });
  }

  // Sort artifacts newest-first for nicer drawer reading
  artifacts.revertCommits.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  artifacts.hotfixDeploys.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  artifacts.failedDeploys.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  artifacts.sameDayRedeploys.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  return { weeks: buckets, artifacts };
}

// ── Builders ─────────────────────────────────────────────────────────────────

async function buildQualityList(org: string, win: ResolvedWindow): Promise<QualityReposResponse> {
  const allRepos = await getOrgRepos(org);
  const active = allRepos.filter((r) => !r.archived);
  const excludedArchived = allRepos.length - active.length;

  let excludedQuiet = 0;
  const eligible: QualityRepoListing[] = [];
  for (const r of active) {
    if (r.pushedAt && new Date(r.pushedAt) < win.start) {
      excludedQuiet++;
      continue;
    }
    eligible.push({
      owner: org,
      repo: r.name,
      fullName: r.fullName,
      htmlUrl: r.htmlUrl,
      language: r.language,
      pushedAt: r.pushedAt,
      defaultBranch: r.defaultBranch,
    });
  }
  eligible.sort((a, b) => {
    const aT = a.pushedAt ? new Date(a.pushedAt).getTime() : 0;
    const bT = b.pushedAt ? new Date(b.pushedAt).getTime() : 0;
    return bT - aT;
  });

  return {
    weeks: win.weeks,
    windowStart: win.start.toISOString(),
    windowEnd: win.end.toISOString(),
    repos: eligible,
    excludedArchived,
    excludedQuiet,
    generatedAt: new Date().toISOString(),
  };
}

async function buildQualityRepo(org: string, repoName: string, win: ResolvedWindow): Promise<QualityRepoResponse> {
  const octokit = new Octokit({ auth: process.env['GITHUB_TOKEN'] });
  const allRepos = await getOrgRepos(org);
  const repo = allRepos.find((r) => r.name === repoName);
  const defaultBranch = repo?.defaultBranch ?? 'main';

  const bag = await fetchRepoBag(octokit, org, repoName, win.start, win.end);
  const { weeks: buckets, artifacts } = aggregateRepo(bag, win.start, win.end, win.weeks, defaultBranch);
  return {
    owner: org,
    repo: repoName,
    defaultBranch,
    windowStart: win.start.toISOString(),
    windowEnd: win.end.toISOString(),
    weeks: buckets,
    artifacts,
    generatedAt: new Date().toISOString(),
  };
}

// ── Router ───────────────────────────────────────────────────────────────────

export function createQualityRouter(): Router {
  const router = Router();

  router.get('/repos', async (req, res) => {
    const org = process.env['GITHUB_ORG'];
    if (!org) {
      res.status(500).json({
        type: 'about:blank', title: 'GitHub org not configured', status: 500,
        detail: 'GITHUB_ORG environment variable is required.',
      });
      return;
    }
    const win = resolveWindow(req.query['weeks']);
    const cacheKey = `${win.weeks}:${win.start.toISOString()}:${win.end.toISOString()}`;
    const cached = listCache.get(cacheKey);
    if (cached && Date.now() - cached.generatedAt < CACHE_TTL_MS) { res.json(cached.payload); return; }

    let inf = listInflight.get(cacheKey);
    if (!inf) {
      inf = (async () => {
        try {
          const payload = await buildQualityList(org, win);
          listCache.set(cacheKey, { generatedAt: Date.now(), payload });
          return payload;
        } finally {
          listInflight.delete(cacheKey);
        }
      })();
      listInflight.set(cacheKey, inf);
    }
    try {
      res.json(await inf);
    } catch (err) {
      console.warn('[quality:list] failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({
        type: 'about:blank', title: 'Quality list failed', status: 500,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.get('/repo/:owner/:repo', async (req, res) => {
    const owner = String(req.params['owner'] ?? '');
    const repoName = String(req.params['repo'] ?? '');
    if (!owner || !repoName) {
      res.status(400).json({ type: 'about:blank', title: 'Bad request', status: 400, detail: 'owner and repo path params are required' });
      return;
    }
    const win = resolveWindow(req.query['weeks']);
    const cacheKey = `${win.weeks}:${win.start.toISOString()}:${win.end.toISOString()}:${owner}/${repoName}`;
    const cached = repoCache.get(cacheKey);
    if (cached && Date.now() - cached.generatedAt < CACHE_TTL_MS) { res.json(cached.payload); return; }

    let inf = repoInflight.get(cacheKey);
    if (!inf) {
      inf = (async () => {
        try {
          const payload = await buildQualityRepo(owner, repoName, win);
          repoCache.set(cacheKey, { generatedAt: Date.now(), payload });
          return payload;
        } finally {
          repoInflight.delete(cacheKey);
        }
      })();
      repoInflight.set(cacheKey, inf);
    }
    try {
      res.json(await inf);
    } catch (err) {
      console.warn(`[quality:repo] ${owner}/${repoName} failed:`, err instanceof Error ? err.message : String(err));
      res.status(500).json({
        type: 'about:blank', title: 'Quality repo failed', status: 500,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
