export type RunStatus = 'success' | 'failure' | 'cancelled' | 'skipped';
export type TriggerEvent = 'push' | 'pull_request' | 'schedule' | 'workflow_dispatch';
export type FailureCategory =
  | 'test-failure'
  | 'build-error'
  | 'dependency-error'
  | 'infrastructure-error'
  | 'lint-error'
  | 'docker-error'
  | 'deployment-error'
  | 'unknown'
  | null;

export interface JobSummary {
  name: string;
  status: string;
  durationSeconds: number;
  runnerType: string;
}

export interface PipelineRun {
  runId: number;
  workflowId: number;
  workflowName: string;
  repositoryUrl: string;
  serviceId: string | null;
  branch: string;
  triggerEvent: TriggerEvent;
  status: RunStatus;
  startedAt: string;
  completedAt: string | null;
  durationSeconds: number;
  queueTimeSeconds: number;
  billableMinutes: number;
  costEstimate: number;
  jobs: JobSummary[];
  failureCategory: FailureCategory;
}
