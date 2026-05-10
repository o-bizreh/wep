import { Router, type Request, type Response } from 'express';
import { problemDetails } from '@wep/domain-types';
import {
  ListDeploymentsQuerySchema,
  GetCurrentStateQuerySchema,
  GetEnvironmentDiffQuerySchema,
} from './schemas.js';
import type { RecordDeploymentStartedHandler } from '../../application/commands/record-deployment-started.js';
import type { RecordDeploymentCompletedHandler } from '../../application/commands/record-deployment-completed.js';
import type { GetCurrentStateHandler } from '../../application/queries/get-current-state.js';
import type { GetEnvironmentDiffHandler } from '../../application/queries/get-environment-diff.js';
import type { ListDeploymentsHandler } from '../../application/queries/list-deployments.js';

export interface DeploymentRouteHandlers {
  recordStarted: RecordDeploymentStartedHandler;
  recordCompleted: RecordDeploymentCompletedHandler;
  getCurrentState: GetCurrentStateHandler;
  getEnvironmentDiff: GetEnvironmentDiffHandler;
  listDeployments: ListDeploymentsHandler;
}

export function createDeploymentRouter(handlers: DeploymentRouteHandlers): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    const parsed = ListDeploymentsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json(problemDetails(400, 'Invalid Query', parsed.error.message));
      return;
    }

    const { limit, cursor, ...filters } = parsed.data;
    const result = await handlers.listDeployments.execute(filters, { limit, cursor });

    if (!result.ok) {
      res.status(500).json(problemDetails(500, 'Query Failed', result.error.message));
      return;
    }

    res.json(result.value);
  });

  router.get('/:deploymentId', async (req: Request, res: Response) => {
    const result = await handlers.listDeployments.execute(
      {},
      { limit: 1 },
    );

    if (!result.ok) {
      res.status(500).json(problemDetails(500, 'Query Failed', result.error.message));
      return;
    }

    res.json(result.value.items[0] ?? null);
  });

  router.get('/services/:serviceId/current', async (req: Request, res: Response) => {
    const parsed = GetCurrentStateQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json(problemDetails(400, 'Invalid Query', parsed.error.message));
      return;
    }

    const result = await handlers.getCurrentState.execute(
      String(req.params['serviceId']),
      parsed.data.environment,
    );

    if (!result.ok) {
      res.status(500).json(problemDetails(500, 'Query Failed', result.error.message));
      return;
    }

    res.json(result.value);
  });

  router.get('/services/:serviceId/current/:environment', async (req: Request, res: Response) => {
    const result = await handlers.getCurrentState.execute(
      String(req.params['serviceId']),
      String(req.params['environment']),
    );

    if (!result.ok) {
      res.status(500).json(problemDetails(500, 'Query Failed', result.error.message));
      return;
    }

    res.json(result.value[0] ?? null);
  });

  router.get('/services/:serviceId/diff', async (req: Request, res: Response) => {
    const parsed = GetEnvironmentDiffQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json(problemDetails(400, 'Invalid Query', parsed.error.message));
      return;
    }

    const result = await handlers.getEnvironmentDiff.execute(
      String(req.params['serviceId']),
      parsed.data.source,
      parsed.data.target,
    );

    if (!result.ok) {
      const status = result.error.code === 'DEPLOYMENT_NOT_FOUND' ? 404 : 500;
      res.status(status).json(problemDetails(status, result.error.code, result.error.message));
      return;
    }

    res.json(result.value);
  });

  router.get('/services/:serviceId/history', async (req: Request, res: Response) => {
    const parsed = ListDeploymentsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json(problemDetails(400, 'Invalid Query', parsed.error.message));
      return;
    }

    const result = await handlers.listDeployments.execute(
      { serviceId: String(req.params['serviceId']) },
      { limit: parsed.data.limit, cursor: parsed.data.cursor },
    );

    if (!result.ok) {
      res.status(500).json(problemDetails(500, 'Query Failed', result.error.message));
      return;
    }

    res.json(result.value);
  });

  router.get('/environments/:environment/recent', async (req: Request, res: Response) => {
    const result = await handlers.listDeployments.execute(
      { environment: String(req.params['environment']) },
      { limit: 20 },
    );

    if (!result.ok) {
      res.status(500).json(problemDetails(500, 'Query Failed', result.error.message));
      return;
    }

    res.json(result.value);
  });

  return router;
}
