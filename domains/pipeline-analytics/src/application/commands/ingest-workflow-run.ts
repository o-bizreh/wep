import { type Result, success, type DomainError } from '@wep/domain-types';
import type { PipelineRun, RunStatus, TriggerEvent, JobSummary } from '../../domain/entities/pipeline-run.js';
import { calculateRunCost } from '../../domain/value-objects/runner-cost-rate.js';
import type { PipelineRepository } from '../../domain/ports/pipeline-repository.js';

export interface RawWorkflowRun {
  id: number;
  workflow_id: number;
  name: string;
  repository_url: string;
  head_branch: string;
  event: string;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  run_started_at: string;
  jobs: Array<{
    name: string;
    conclusion: string;
    started_at: string;
    completed_at: string;
    runner_name: string;
    labels: string[];
  }>;
}

export class IngestWorkflowRunHandler {
  constructor(private readonly pipelineRepo: PipelineRepository) {}

  async execute(
    raw: RawWorkflowRun,
    serviceId: string | null,
  ): Promise<Result<PipelineRun, DomainError>> {
    const existingResult = await this.pipelineRepo.findRunById(raw.id);
    if (existingResult.ok && existingResult.value) {
      return success(existingResult.value);
    }

    const jobs: JobSummary[] = raw.jobs.map((j) => {
      const dur = j.completed_at && j.started_at
        ? (new Date(j.completed_at).getTime() - new Date(j.started_at).getTime()) / 1000
        : 0;
      return {
        name: j.name,
        status: j.conclusion,
        durationSeconds: Math.round(dur),
        runnerType: j.labels[0] ?? 'ubuntu-latest',
      };
    });

    const totalDuration = jobs.reduce((s, j) => s + j.durationSeconds, 0);
    const billableMinutes = Math.ceil(totalDuration / 60);
    const primaryRunner = jobs[0]?.runnerType ?? 'ubuntu-latest';
    const costEstimate = calculateRunCost(billableMinutes, primaryRunner);

    const queueTime = raw.run_started_at && raw.created_at
      ? (new Date(raw.run_started_at).getTime() - new Date(raw.created_at).getTime()) / 1000
      : 0;

    const status: RunStatus = (raw.conclusion as RunStatus) ?? 'cancelled';

    const run: PipelineRun = {
      runId: raw.id,
      workflowId: raw.workflow_id,
      workflowName: raw.name,
      repositoryUrl: raw.repository_url,
      serviceId,
      branch: raw.head_branch,
      triggerEvent: raw.event as TriggerEvent,
      status,
      startedAt: raw.run_started_at || raw.created_at,
      completedAt: raw.updated_at,
      durationSeconds: Math.round(totalDuration),
      queueTimeSeconds: Math.max(0, Math.round(queueTime)),
      billableMinutes,
      costEstimate,
      jobs,
      failureCategory: null,
    };

    const saveResult = await this.pipelineRepo.saveRun(run);
    if (!saveResult.ok) return saveResult;

    return success(run);
  }
}
