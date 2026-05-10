import { Router } from 'express';
import { Octokit } from '@octokit/rest';
import { GitHubClient } from '@wep/github-client';
import { withGitHubLimit, recordRateLimit } from '../services/github-throttle.js';

// ── Constants ────────────────────────────────────────────────────────────────

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const CACHE_TTL_MS = 15 * 60_000;        // 15 min — sprint data rarely changes minute-to-minute
const PR_PAGE_CAP = 20;                  // safety cap on closed-PR pagination
const COMMIT_PAGE_CAP = 30;              // safety cap on commit pagination

// "Off-hours" window in UTC. 09:00-18:00 UTC ≈ business hours for Dubai/MENA.
const BUSINESS_HOUR_START_UTC = 9;
const BUSINESS_HOUR_END_UTC = 18;

const HOTFIX_BRANCH_RE = /^(hotfix|fix|revert)[/-]/i;

// ── Types ────────────────────────────────────────────────────────────────────

type WindowKind = '1w' | '2w' | '4w' | 'custom';
type Environment = 'production' | 'development' | 'unknown';

export interface ShippedPr {
  repo: string;
  number: number;
  title: string;
  author: string;
  branch: string;
  mergedAt: string;
  htmlUrl: string;
}

export interface DeployEntry {
  repo: string;
  workflowName: string;
  branch: string;
  env: Environment;
  actor: string;
  conclusion: string;
  startedAt: string;
  durationSeconds: number | null;
  htmlUrl: string;
  isHotfix: boolean;
  isOffHours: boolean;
}

export interface RepoListing {
  owner: string;
  repo: string;
  fullName: string;
  htmlUrl: string;
  language: string | null;
  pushedAt: string | null;
}

export interface SprintReposResponse {
  windowKind: WindowKind;
  windowStart: string;
  windowEnd: string;
  prevWindowStart: string;
  prevWindowEnd: string;
  windowDays: number;
  repos: RepoListing[];
  excludedArchived: number;
  excludedQuiet: number;     // skipped because pushed_at is older than prev window
  generatedAt: string;
}

/** Aggregated counts per repo for one window. */
export interface RepoWindowStats {
  mergedPrs: number;
  totalDeploys: number;
  prodDeploys: number;
  succeededDeploys: number;
  completedDeploys: number;
  hotfixDeploys: number;
  offHoursProdDeploys: number;
  cycleTimesHours: number[];
}

export interface RepoEngineerStat {
  prsMerged: number;
  commits: number;
  deploysTriggered: number;
  /** Open PRs authored by this engineer in this repo at the moment of fetch. */
  openPrCount: number;
  /** Age in days of their oldest open PR in this repo (null if none open). */
  oldestOpenPrAgeDays: number | null;
  /** Commits whose author date falls outside business hours / on weekends. */
  offHoursCommits: number;
  /** Successful deploys this engineer triggered off-hours. */
  offHoursDeploys: number;
}

export interface SprintRepoResponse {
  repo: string;
  owner: string;
  windowStart: string;
  windowEnd: string;
  prevWindowStart: string;
  prevWindowEnd: string;
  current: RepoWindowStats;
  previous: RepoWindowStats;
  shipped: ShippedPr[];
  deploys: DeployEntry[];
  engineerStats: Record<string, RepoEngineerStat>;
  generatedAt: string;
}

// ── Cache ────────────────────────────────────────────────────────────────────

interface ListCacheEntry { generatedAt: number; payload: SprintReposResponse }
interface RepoCacheEntry { generatedAt: number; payload: SprintRepoResponse }
const listCache = new Map<string, ListCacheEntry>();
const listInflight = new Map<string, Promise<SprintReposResponse>>();
const repoCache = new Map<string, RepoCacheEntry>();
const repoInflight = new Map<string, Promise<SprintRepoResponse>>();

// ── Window resolution ────────────────────────────────────────────────────────

function roundToHour(d: Date): Date {
  const out = new Date(d);
  out.setUTCMinutes(0, 0, 0);
  return out;
}

interface ResolvedWindow {
  windowKind: WindowKind;
  start: Date;
  end: Date;
  prevStart: Date;
  prevEnd: Date;
  windowDays: number;
}

function resolveWindow(windowKind: WindowKind, customStart?: string, customEnd?: string): ResolvedWindow {
  const now = roundToHour(new Date());
  let end = now;
  let start: Date;
  if (windowKind === 'custom' && customStart && customEnd) {
    const s = new Date(customStart);
    const e = new Date(customEnd);
    if (!isNaN(s.getTime()) && !isNaN(e.getTime()) && s < e) {
      start = roundToHour(s);
      end = roundToHour(e);
    } else {
      start = new Date(end.getTime() - 14 * DAY_MS);
    }
  } else {
    const days = windowKind === '4w' ? 28 : windowKind === '2w' ? 14 : 7;
    start = new Date(end.getTime() - days * DAY_MS);
  }
  const duration = end.getTime() - start.getTime();
  return {
    windowKind,
    start,
    end,
    prevStart: new Date(start.getTime() - duration),
    prevEnd: start,
    windowDays: Math.round(duration / DAY_MS),
  };
}

function parseWindowQuery(req: { query: Record<string, unknown> }): ResolvedWindow {
  const raw = String(req.query['window'] ?? '2w');
  const windowKind: WindowKind = raw === '1w' || raw === '4w' || raw === 'custom' || raw === '2w' ? raw : '2w';
  const customStart = typeof req.query['start'] === 'string' ? req.query['start'] : undefined;
  const customEnd = typeof req.query['end'] === 'string' ? req.query['end'] : undefined;
  return resolveWindow(windowKind, customStart, customEnd);
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

function isOffHours(iso: string): boolean {
  const d = new Date(iso);
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return true;
  const h = d.getUTCHours();
  return h < BUSINESS_HOUR_START_UTC || h >= BUSINESS_HOUR_END_UTC;
}

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p; } catch { return fallback; }
}

// ── Per-repo fetch ───────────────────────────────────────────────────────────

interface BagPr {
  number: number;
  title: string;
  user: { login?: string | null } | null;
  head: { ref: string };
  created_at: string;
  merged_at: string | null;
  updated_at: string;
  html_url: string;
}
interface BagRun {
  id: number;
  name?: string | null;
  display_title?: string;
  head_branch: string | null;
  status: string | null;
  conclusion: string | null;
  actor?: { login?: string | null } | null;
  run_started_at?: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
}
interface BagCommit {
  author: { login?: string | null } | null;
  commit: {
    author: { name?: string | null; date?: string | null } | null;
    message: string;
  };
}

interface BagOpenPr {
  number: number;
  user: { login?: string | null } | null;
  created_at: string;
}

interface RepoBag {
  mergedPrs: BagPr[];
  runs: BagRun[];
  commits: BagCommit[];
  /** Currently-open PRs (snapshot at fetch time, NOT window-bounded). */
  openPrs: BagOpenPr[];
}

/**
 * Fetch the full data range [start, end) in a single sweep. Each Octokit call
 * is throttled via the global GitHub semaphore + rate-limit guard. Pagination
 * is capped to bound the worst case for noisy repos.
 *
 * The caller splits the bag into per-window slices via `sliceBag` — fetching
 * once for [prevStart, end) instead of twice (once per window) halves the
 * GitHub call rate.
 */
async function fetchRepoBag(
  octokit: Octokit,
  owner: string,
  repo: string,
  start: Date,
  end: Date,
): Promise<RepoBag> {
  const since = start.toISOString();
  const until = end.toISOString();

  const [closedPrs, runs, commits, openPrs] = await Promise.all([
    safe(
      withGitHubLimit(async (): Promise<BagPr[]> => {
        let pages = 0;
        return octokit.paginate(octokit.pulls.list, {
          owner, repo, state: 'closed', per_page: 100, sort: 'updated', direction: 'desc',
        }, (response, done) => {
          recordRateLimit(response.headers);
          pages++;
          const last = response.data[response.data.length - 1];
          if (last && new Date(last.updated_at) < start) done();
          if (pages >= PR_PAGE_CAP) done();
          return response.data;
        }) as Promise<BagPr[]>;
      }),
      [] as BagPr[],
    ),
    safe(
      withGitHubLimit(async (): Promise<BagRun[]> => {
        const r = await octokit.actions.listWorkflowRunsForRepo({
          owner, repo, per_page: 100, created: `${since}..${until}`,
        });
        recordRateLimit(r.headers);
        return r.data.workflow_runs as BagRun[];
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
    safe(
      withGitHubLimit(async (): Promise<BagOpenPr[]> => {
        // Snapshot of currently-open PRs (not window-bounded). Used to detect
        // engineers stuck on long-running PRs.
        const r = await octokit.pulls.list({
          owner, repo, state: 'open', per_page: 100,
        });
        recordRateLimit(r.headers);
        return r.data as BagOpenPr[];
      }),
      [] as BagOpenPr[],
    ),
  ]);

  const mergedPrs = closedPrs.filter(
    (pr) => pr.merged_at && new Date(pr.merged_at) >= start && new Date(pr.merged_at) < end,
  );

  return { mergedPrs, runs, commits, openPrs };
}

/**
 * Filter an existing bag down to PRs/runs/commits whose timestamps fall in the
 * slice. Open PRs pass through unchanged — they represent current load and
 * aren't window-dependent.
 */
function sliceBag(bag: RepoBag, start: Date, end: Date): RepoBag {
  const inWindow = (iso: string | null | undefined): boolean => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return t >= start.getTime() && t < end.getTime();
  };
  return {
    mergedPrs: bag.mergedPrs.filter((pr) => inWindow(pr.merged_at)),
    runs: bag.runs.filter((run) => inWindow(run.run_started_at ?? run.created_at)),
    commits: bag.commits.filter((c) => inWindow(c.commit.author?.date ?? null)),
    openPrs: bag.openPrs,
  };
}

// ── Aggregation per repo (per window) ────────────────────────────────────────

function summarizeRepo(bag: RepoBag): RepoWindowStats {
  let mergedPrs = 0;
  let totalDeploys = 0;
  let prodDeploys = 0;
  let succeededDeploys = 0;
  let completedDeploys = 0;
  let hotfixDeploys = 0;
  let offHoursProdDeploys = 0;
  const cycleTimesHours: number[] = [];

  for (const pr of bag.mergedPrs) {
    mergedPrs++;
    if (pr.merged_at) {
      const ms = new Date(pr.merged_at).getTime() - new Date(pr.created_at).getTime();
      if (ms >= 0) cycleTimesHours.push(ms / HOUR_MS);
    }
  }
  for (const run of bag.runs) {
    if (run.conclusion === 'cancelled' || run.conclusion === 'skipped') continue;
    const env = branchToEnv(run.head_branch);
    totalDeploys++;
    if (run.conclusion) {
      completedDeploys++;
      if (run.conclusion === 'success') succeededDeploys++;
    }
    if (env === 'production') {
      prodDeploys++;
      const startedAt = run.run_started_at ?? run.created_at;
      if (isOffHours(startedAt)) offHoursProdDeploys++;
    }
    if (isHotfixBranch(run.head_branch)) hotfixDeploys++;
  }

  return {
    mergedPrs,
    totalDeploys,
    prodDeploys,
    succeededDeploys,
    completedDeploys,
    hotfixDeploys,
    offHoursProdDeploys,
    cycleTimesHours,
  };
}

function shippedFromBag(bag: RepoBag, repo: string): ShippedPr[] {
  const out: ShippedPr[] = [];
  for (const pr of bag.mergedPrs) {
    if (!pr.merged_at) continue;
    out.push({
      repo,
      number: pr.number,
      title: pr.title,
      author: pr.user?.login ?? 'unknown',
      branch: pr.head?.ref ?? '',
      mergedAt: pr.merged_at,
      htmlUrl: pr.html_url,
    });
  }
  return out.sort((a, b) => new Date(b.mergedAt).getTime() - new Date(a.mergedAt).getTime());
}

function deploysFromBag(bag: RepoBag, repo: string): DeployEntry[] {
  const out: DeployEntry[] = [];
  for (const run of bag.runs) {
    if (run.conclusion === 'cancelled' || run.conclusion === 'skipped') continue;
    const env = branchToEnv(run.head_branch);
    const startedAt = run.run_started_at ?? run.created_at;
    const durationSeconds = run.conclusion
      ? Math.round((new Date(run.updated_at).getTime() - new Date(startedAt).getTime()) / 1000)
      : null;
    out.push({
      repo,
      workflowName: run.name ?? run.display_title ?? 'workflow',
      branch: run.head_branch ?? '',
      env,
      actor: run.actor?.login ?? 'unknown',
      conclusion: run.conclusion ?? run.status ?? 'unknown',
      startedAt,
      durationSeconds,
      htmlUrl: run.html_url,
      isHotfix: isHotfixBranch(run.head_branch),
      isOffHours: env === 'production' && isOffHours(startedAt),
    });
  }
  return out.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

function engineerStatsFromBag(bag: RepoBag): Record<string, RepoEngineerStat> {
  const out: Record<string, RepoEngineerStat> = {};
  const get = (login: string): RepoEngineerStat => {
    let s = out[login];
    if (!s) {
      s = {
        prsMerged: 0,
        commits: 0,
        deploysTriggered: 0,
        openPrCount: 0,
        oldestOpenPrAgeDays: null,
        offHoursCommits: 0,
        offHoursDeploys: 0,
      };
      out[login] = s;
    }
    return s;
  };

  for (const pr of bag.mergedPrs) {
    const login = pr.user?.login;
    if (login) get(login).prsMerged++;
  }
  for (const c of bag.commits) {
    const login = c.author?.login;
    if (login) {
      const s = get(login);
      s.commits++;
      const date = c.commit.author?.date;
      if (date && isOffHours(date)) s.offHoursCommits++;
    }
  }
  for (const run of bag.runs) {
    if (run.conclusion !== 'success') continue;
    const login = run.actor?.login;
    if (!login) continue;
    const s = get(login);
    s.deploysTriggered++;
    const startedAt = run.run_started_at ?? run.created_at;
    if (isOffHours(startedAt)) s.offHoursDeploys++;
  }
  // Currently-open PRs — load + stuck signal. Independent of window.
  const now = Date.now();
  for (const pr of bag.openPrs) {
    const login = pr.user?.login;
    if (!login) continue;
    const s = get(login);
    s.openPrCount++;
    const ageDays = Math.floor((now - new Date(pr.created_at).getTime()) / DAY_MS);
    if (s.oldestOpenPrAgeDays === null || ageDays > s.oldestOpenPrAgeDays) {
      s.oldestOpenPrAgeDays = ageDays;
    }
  }
  return out;
}

// ── List builder ─────────────────────────────────────────────────────────────

async function buildSprintRepoList(
  org: string,
  win: ResolvedWindow,
): Promise<SprintReposResponse> {
  const ghClient = new GitHubClient();
  const reposResult = await ghClient.listOrgRepos(org);
  if (!reposResult.ok) throw new Error(`Failed to list org repos: ${reposResult.error.message}`);

  const allRepos = reposResult.value;
  const active = allRepos.filter((r) => !r.archived);
  const excludedArchived = allRepos.length - active.length;

  // Skip repos that haven't been pushed since the start of the comparison
  // window — they can't contribute either current or prev period data.
  const cutoff = win.prevStart;
  let excludedQuiet = 0;
  const eligible: RepoListing[] = [];
  for (const r of active) {
    if (r.pushedAt && new Date(r.pushedAt) < cutoff) {
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
    });
  }
  // Most-recently-pushed first so important repos load first in the lazy fan-out.
  eligible.sort((a, b) => {
    const aT = a.pushedAt ? new Date(a.pushedAt).getTime() : 0;
    const bT = b.pushedAt ? new Date(b.pushedAt).getTime() : 0;
    return bT - aT;
  });

  return {
    windowKind: win.windowKind,
    windowStart: win.start.toISOString(),
    windowEnd: win.end.toISOString(),
    prevWindowStart: win.prevStart.toISOString(),
    prevWindowEnd: win.prevEnd.toISOString(),
    windowDays: win.windowDays,
    repos: eligible,
    excludedArchived,
    excludedQuiet,
    generatedAt: new Date().toISOString(),
  };
}

// ── Per-repo builder ─────────────────────────────────────────────────────────

async function buildSprintRepo(
  org: string,
  repoName: string,
  win: ResolvedWindow,
): Promise<SprintRepoResponse> {
  const octokit = new Octokit({ auth: process.env['GITHUB_TOKEN'] });

  // Single fetch across the union [prevStart, end), then slice locally —
  // halves GitHub calls per repo vs fetching each window separately.
  const fullBag = await fetchRepoBag(octokit, org, repoName, win.prevStart, win.end);
  const currentBag = sliceBag(fullBag, win.start, win.end);
  const prevBag = sliceBag(fullBag, win.prevStart, win.prevEnd);

  return {
    repo: repoName,
    owner: org,
    windowStart: win.start.toISOString(),
    windowEnd: win.end.toISOString(),
    prevWindowStart: win.prevStart.toISOString(),
    prevWindowEnd: win.prevEnd.toISOString(),
    current: summarizeRepo(currentBag),
    previous: summarizeRepo(prevBag),
    shipped: shippedFromBag(currentBag, repoName),
    deploys: deploysFromBag(currentBag, repoName),
    engineerStats: engineerStatsFromBag(currentBag),
    generatedAt: new Date().toISOString(),
  };
}

// ── Router ───────────────────────────────────────────────────────────────────

export function createSprintRouter(): Router {
  const router = Router();

  // GET /repos — fast list of eligible repos for the window. Frontend uses this
  // to render skeleton rows and then fans out one /repo/:owner/:repo call per
  // repo, aggregating client-side as each lands.
  router.get('/repos', async (req, res) => {
    const org = process.env['GITHUB_ORG'];
    if (!org) {
      res.status(500).json({
        type: 'about:blank', title: 'GitHub org not configured', status: 500,
        detail: 'GITHUB_ORG environment variable is required.',
      });
      return;
    }
    const win = parseWindowQuery(req);
    const cacheKey = `${win.windowKind}:${win.start.toISOString()}:${win.end.toISOString()}`;
    const now = Date.now();
    const cached = listCache.get(cacheKey);
    if (cached && now - cached.generatedAt < CACHE_TTL_MS) { res.json(cached.payload); return; }

    let inf = listInflight.get(cacheKey);
    if (!inf) {
      inf = (async () => {
        try {
          const payload = await buildSprintRepoList(org, win);
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
      console.warn('[sprint:list] failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({
        type: 'about:blank', title: 'Sprint list failed', status: 500,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // GET /repo/:owner/:repo — per-repo sprint data for one window. Cached per
  // (window, repo) tuple.
  router.get('/repo/:owner/:repo', async (req, res) => {
    const owner = String(req.params['owner'] ?? '');
    const repoName = String(req.params['repo'] ?? '');
    if (!owner || !repoName) {
      res.status(400).json({ type: 'about:blank', title: 'Bad request', status: 400, detail: 'owner and repo path params are required' });
      return;
    }
    const win = parseWindowQuery(req);
    const cacheKey = `${win.windowKind}:${win.start.toISOString()}:${win.end.toISOString()}:${owner}/${repoName}`;
    const now = Date.now();
    const cached = repoCache.get(cacheKey);
    if (cached && now - cached.generatedAt < CACHE_TTL_MS) { res.json(cached.payload); return; }

    let inf = repoInflight.get(cacheKey);
    if (!inf) {
      inf = (async () => {
        try {
          const payload = await buildSprintRepo(owner, repoName, win);
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
      console.warn(`[sprint:repo] ${owner}/${repoName} failed:`, err instanceof Error ? err.message : String(err));
      res.status(500).json({
        type: 'about:blank', title: 'Sprint repo failed', status: 500,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
