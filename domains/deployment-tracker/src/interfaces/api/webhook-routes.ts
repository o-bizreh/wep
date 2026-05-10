import { Router, type Request, type Response } from 'express';
import { problemDetails } from '@wep/domain-types';
import { GitHubClient } from '@wep/github-client';
import { validateWebhookSignature } from '../../infrastructure/github/webhook-validator.js';
import type { RecordDeploymentCompletedHandler } from '../../application/commands/record-deployment-completed.js';

export interface WebhookHandlers {
  recordCompleted: RecordDeploymentCompletedHandler;
}

/**
 * Parses the flat artifact files produced by deploy-ecs-monorepo into a structured map:
 *   "task-def-srv-order" artifact → { folderName: "srv-order", ecsService, cluster, arn, image }
 */
function parseDeployArtifacts(artifacts: Array<{ name: string; files: Array<{ name: string; content: string }> }>): Array<{
  folderName: string;
  ecsService: string;
  cluster: string;
  arn: string;
  image: string;
}> {
  const results = [];

  for (const artifact of artifacts) {
    // artifact.name = "task-def-srv-order"
    if (!artifact.name.startsWith('task-def-')) continue;
    const folderName = artifact.name.replace(/^task-def-/, '');

    const get = (ext: string) =>
      artifact.files.find((f) => f.name === `${folderName}.${ext}`)?.content ?? '';

    const ecsService = get('ecs_service');
    const cluster = get('cluster');
    const arn = get('arn');
    const image = get('image');

    if (ecsService && cluster) {
      results.push({ folderName, ecsService, cluster, arn, image });
    }
  }

  return results;
}

/**
 * Handles a completed workflow_run event by recording deployments for each service.
 * Returns a count of services processed.
 */
async function processWorkflowRun(
  owner: string,
  repo: string,
  runId: number,
  headSha: string,
  githubClient: GitHubClient,
  recordCompleted: RecordDeploymentCompletedHandler,
): Promise<{ processed: number; errors: string[] }> {
  const artifactsResult = await githubClient.downloadRunArtifacts(owner, repo, runId);
  if (!artifactsResult.ok) {
    return { processed: 0, errors: [artifactsResult.error.message] };
  }

  const deployedServices = parseDeployArtifacts(artifactsResult.value);
  const errors: string[] = [];

  for (const svc of deployedServices) {
    const environment = svc.cluster.startsWith('prod')
      ? 'production'
      : svc.cluster.startsWith('stg')
      ? 'staging'
      : 'development';

    const result = await recordCompleted.execute({
      // Synthetic serviceId: repo/folder. Links to catalog by ecsService name in metadata.
      serviceId: `${repo}/${svc.folderName}`,
      environment,
      sha: headSha,
      actor: 'github-actions',
      status: 'success',
    });

    if (!result.ok) {
      errors.push(`${svc.folderName}: ${result.error.message}`);
    }
  }

  return { processed: deployedServices.length, errors };
}

export function createWebhookRouter(handlers: WebhookHandlers): Router {
  // IMPORTANT: This router must be mounted BEFORE express.json() so it can read raw body.
  // The caller (server.ts) must use express.raw() for this router.
  const router = Router();
  const githubClient = new GitHubClient();

  /**
   * POST /webhooks/github
   * Receives GitHub workflow_run webhook events.
   * Signature is verified using GITHUB_WEBHOOK_SECRET env var.
   */
  router.post('/', async (req: Request, res: Response) => {
    const rawBody = req.body as Buffer;
    const payload = rawBody.toString('utf-8');
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const event = req.headers['x-github-event'] as string | undefined;

    // --- Signature verification ---
    const secret = process.env['GITHUB_WEBHOOK_SECRET'] ?? '';
    if (!secret) {
      res.status(500).json(problemDetails(500, 'Server Misconfiguration', 'GITHUB_WEBHOOK_SECRET is not set'));
      return;
    }

    const sigResult = validateWebhookSignature(payload, signature, secret);
    if (!sigResult.ok) {
      res.status(401).json(problemDetails(401, 'Unauthorized', sigResult.error.message));
      return;
    }

    // --- Event filtering ---
    if (event !== 'workflow_run') {
      // Acknowledge other events without processing
      res.json({ accepted: false, reason: 'event_not_handled' });
      return;
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      res.status(400).json(problemDetails(400, 'Invalid Payload', 'Could not parse JSON'));
      return;
    }

    const action = body['action'] as string;
    const run = body['workflow_run'] as Record<string, unknown> | undefined;

    if (action !== 'completed' || !run) {
      res.json({ accepted: false, reason: 'not_a_completed_run' });
      return;
    }

    const conclusion = run['conclusion'] as string | null;
    const workflowName = (run['name'] as string) ?? '';
    const runId = run['id'] as number;
    const headSha = run['head_sha'] as string;
    const repository = body['repository'] as Record<string, unknown>;
    const owner = (repository['owner'] as Record<string, unknown>)['login'] as string;
    const repo = repository['name'] as string;

    // Only process successful monorepo deploy runs
    if (conclusion !== 'success' || !workflowName.toLowerCase().includes('monorepo')) {
      res.json({ accepted: false, reason: 'not_a_successful_monorepo_deploy' });
      return;
    }

    // Process asynchronously — respond immediately to GitHub (10s timeout)
    res.json({ accepted: true, runId, repo });

    // Fire-and-forget processing
    processWorkflowRun(owner, repo, runId, headSha, githubClient, handlers.recordCompleted)
      .catch(console.error);
  });

  /**
   * POST /webhooks/github/refresh
   * Manual trigger to process a specific workflow run's artifacts.
   * Body: { owner: string, repo: string, runId?: number }
   * If runId is omitted, the latest completed monorepo deploy run is used.
   */
  router.post('/refresh', async (req: Request, res: Response) => {
    // This route uses parsed JSON (express.json() applied after raw body parsing)
    const body = req.body as { owner?: string; repo?: string; runId?: number };

    if (!body.owner || !body.repo) {
      res.status(400).json(problemDetails(400, 'Invalid Body', 'owner and repo are required'));
      return;
    }

    const { owner, repo } = body;
    let runId = body.runId;

    // If no runId provided, find the latest successful monorepo deploy
    if (!runId) {
      const runsResult = await githubClient.listWorkflowRuns(owner, repo, { status: 'completed', per_page: 20 });
      if (!runsResult.ok) {
        res.status(502).json(problemDetails(502, 'GitHub API Error', runsResult.error.message));
        return;
      }

      const latestRun = runsResult.value.items.find(
        (r) => r.conclusion === 'success' && r.name.toLowerCase().includes('monorepo'),
      );

      if (!latestRun) {
        res.status(404).json(problemDetails(404, 'No Run Found', 'No successful monorepo deploy found for this repo'));
        return;
      }

      runId = latestRun.id;
    }

    // Fetch the run's head SHA for the deployment record
    const runsResult = await githubClient.listWorkflowRuns(owner, repo, { per_page: 1 });
    const headSha = runsResult.ok && runsResult.value.items.length > 0 ? runsResult.value.items[0]!.headSha : 'unknown';

    const { processed, errors } = await processWorkflowRun(
      owner,
      repo,
      runId!, // narrowed: either provided by caller or assigned from latestRun.id above
      headSha,
      githubClient,
      handlers.recordCompleted,
    );

    res.json({
      runId,
      owner,
      repo,
      processed,
      errors: errors.length > 0 ? errors : undefined,
    });
  });

  return router;
}
