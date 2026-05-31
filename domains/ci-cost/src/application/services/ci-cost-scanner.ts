import { randomUUID } from 'crypto';
import { Octokit } from '@octokit/rest';
import type { CiCostRepository } from '../../infrastructure/dynamodb/ci-cost-repository.js';
import type { CiCostScanRun, RepoRunSummary } from '../../domain/entities/ci-cost-types.js';

let currentScan: CiCostScanRun | null = null;

export function getCiCostScanStatus(): CiCostScanRun | null { return currentScan; }

const LINUX_COST_PER_MIN = 0.008;

async function batchedMap<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export async function runCiCostScan(org: string, repo: CiCostRepository, githubToken: string): Promise<void> {
  if (currentScan?.status === 'scanning') return;

  const runId = randomUUID();
  const scan: CiCostScanRun = {
    runId,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'scanning',
    reposScanned: 0,
    reposTotal: 0,
    error: null,
  };
  currentScan = scan;
  await repo.saveScanRun(scan);

  try {
    const octokit = new Octokit({ auth: githubToken });

    // List all non-archived repos
    const repos: Array<{ owner: string; name: string }> = [];
    let page = 1;
    while (true) {
      const r = await octokit.repos.listForOrg({ org, per_page: 100, page, type: 'all' });
      for (const r2 of r.data) {
        if (!r2.archived) repos.push({ owner: org, name: r2.name });
      }
      if (r.data.length < 100) break;
      page++;
    }

    scan.reposTotal = repos.length;
    currentScan = { ...scan };
    await repo.saveScanRun({ ...scan });

    // 30 days window
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    let scanned = 0;
    await batchedMap(repos, 10, async (r) => {
      try {
        // Fetch up to 100 runs from last 30 days
        const runsResp = await octokit.actions.listWorkflowRunsForRepo({
          owner: r.owner,
          repo: r.name,
          per_page: 100,
          created: `>${since.slice(0, 10)}`,
        });
        const runs = runsResp.data.workflow_runs;

        if (runs.length === 0) {
          scanned++;
          scan.reposScanned = scanned;
          currentScan = { ...scan };
          return;
        }

        let totalMs = 0;
        let succeeded = 0;
        const workflowDurations: Record<string, number[]> = {};

        for (const run of runs) {
          if (run.status !== 'completed') continue;
          const start = run.run_started_at
            ? new Date(run.run_started_at).getTime()
            : new Date(run.created_at).getTime();
          const end = run.updated_at ? new Date(run.updated_at).getTime() : start;
          const durationMs = Math.max(0, end - start);
          totalMs += durationMs;
          if (run.conclusion === 'success') succeeded++;
          const wf = run.name ?? run.workflow_id?.toString() ?? 'unknown';
          if (!workflowDurations[wf]) workflowDurations[wf] = [];
          workflowDurations[wf].push(durationMs);
        }

        const completedRuns = runs.filter((run) => run.status === 'completed');
        const totalMinutes = Math.ceil(totalMs / 60_000);
        const avgDurationSeconds =
          completedRuns.length > 0 ? Math.round(totalMs / completedRuns.length / 1000) : 0;
        const successRate =
          completedRuns.length > 0 ? Math.round((succeeded / completedRuns.length) * 100) : 0;
        const estimatedCostUsd = totalMinutes * LINUX_COST_PER_MIN;

        // Find slowest workflow by average duration
        let slowestWorkflow: string | null = null;
        let maxAvg = 0;
        for (const [wf, durations] of Object.entries(workflowDurations)) {
          const avg = durations.reduce((s, d) => s + d, 0) / durations.length;
          if (avg > maxAvg) {
            maxAvg = avg;
            slowestWorkflow = wf;
          }
        }

        const lastRun = runs[0];
        const summary: RepoRunSummary = {
          repoFullName: `${r.owner}/${r.name}`,
          runCount: completedRuns.length,
          totalMinutes,
          estimatedCostUsd,
          successRate,
          avgDurationSeconds,
          slowestWorkflow,
          lastRunAt: lastRun?.updated_at ?? null,
          scannedAt: new Date().toISOString(),
        };
        await repo.saveRepoSummary(summary);
      } catch {
        /* repo may have no actions enabled, skip */
      }

      scanned++;
      scan.reposScanned = scanned;
      currentScan = { ...scan };
    });

    const finished: CiCostScanRun = {
      ...scan,
      status: 'done',
      finishedAt: new Date().toISOString(),
      reposScanned: scanned,
    };
    currentScan = finished;
    await repo.saveScanRun(finished);
  } catch (e) {
    const failed: CiCostScanRun = {
      ...scan,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: e instanceof Error ? e.message : String(e),
    };
    currentScan = failed;
    await repo.saveScanRun(failed);
    console.error('[ci-cost] scan failed:', e);
  }
}
