export interface RepoRunSummary {
  repoFullName: string;
  runCount: number;
  totalMinutes: number;           // sum of all run durations (rounded up per run)
  estimatedCostUsd: number;       // based on $0.008/min Linux
  successRate: number;            // 0-100
  avgDurationSeconds: number;
  slowestWorkflow: string | null; // workflow name with highest avg duration
  lastRunAt: string | null;
  scannedAt: string;
}

export interface CiCostScanRun {
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'scanning' | 'done' | 'failed';
  reposScanned: number;
  reposTotal: number;
  error: string | null;
}
