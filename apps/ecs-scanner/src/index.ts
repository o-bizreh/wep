// Runs all background scan jobs sequentially.
// Each job failure is caught and logged — one failing job does not abort others.
// Exits 0 if all jobs succeed, 1 if any job failed.

import { catalogSyncJob } from './jobs/catalog-sync.js';
import { npmAuditJob } from './jobs/npm-audit.js';
import { ciCostJob } from './jobs/ci-cost.js';
import { driftCacheJob } from './jobs/drift-cache.js';

interface JobResult {
  name: string;
  succeeded: boolean;
  durationSeconds: number;
  error?: string;
}

async function runJob(name: string, job: () => Promise<void>): Promise<JobResult> {
  console.log(`[${name}] Starting...`);
  const start = Date.now();

  try {
    await job();
    const durationSeconds = Math.round((Date.now() - start) / 1000);
    console.log(`[${name}] Done in ${durationSeconds}s`);
    return { name, succeeded: true, durationSeconds };
  } catch (err) {
    const durationSeconds = Math.round((Date.now() - start) / 1000);
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${name}] FAILED: ${message}`);
    return { name, succeeded: false, durationSeconds, error: message };
  }
}

async function main(): Promise<void> {
  console.log('WEP Background Scanner starting...');
  console.log(`Environment: ${process.env['WEP_ENVIRONMENT'] ?? 'development'}`);
  console.log(`Started at: ${new Date().toISOString()}\n`);

  const jobs: Array<{ name: string; job: () => Promise<void> }> = [
    { name: 'catalog-sync', job: catalogSyncJob },
    { name: 'npm-audit',    job: npmAuditJob },
    { name: 'ci-cost',      job: ciCostJob },
    { name: 'drift-cache',  job: driftCacheJob },
  ];

  const results: JobResult[] = [];
  for (const { name, job } of jobs) {
    results.push(await runJob(name, job));
  }

  const totalJobs = results.length;
  const succeededJobs = results.filter((r) => r.succeeded).length;
  const failedJobs = totalJobs - succeededJobs;

  console.log(`\nScanner complete. Jobs: ${totalJobs} total, ${succeededJobs} succeeded, ${failedJobs} failed.`);

  process.exit(failedJobs > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Unhandled fatal error:', err);
  process.exit(1);
});
