import { Router, type Request, type Response } from 'express';
import { problemDetails } from '@wep/domain-types';
import type { GetTeamMetricsHandler } from '../../application/queries/get-team-metrics.js';
import type { GetOrgDashboardHandler } from '../../application/queries/get-org-dashboard.js';
import type { MetricRepository } from '../../domain/ports/metric-repository.js';

export interface VelocityRouteHandlers {
  getTeamMetrics: GetTeamMetricsHandler;
  getOrgDashboard: GetOrgDashboardHandler;
  metricRepo: MetricRepository;
}

export function createVelocityRouter(handlers: VelocityRouteHandlers): Router {
  const router = Router();

  router.get('/org', async (_req: Request, res: Response) => {
    const result = await handlers.getOrgDashboard.execute();

    if (!result.ok) {
      res.status(500).json(problemDetails(500, result.error.code, result.error.message));
      return;
    }

    res.json(result.value);
  });

  router.get('/teams/:teamId', async (req: Request, res: Response) => {
    const memberCount = parseInt(req.query['memberCount'] as string, 10) || 0;

    const result = await handlers.getTeamMetrics.execute(
      String(req.params['teamId']),
      memberCount,
      true,
    );

    if (!result.ok) {
      const status = result.error.code === 'TEAM_TOO_SMALL' ? 403 : 500;
      res.status(status).json(problemDetails(status, result.error.code, result.error.message));
      return;
    }

    res.json(result.value);
  });

  router.get('/teams/:teamId/trends', async (req: Request, res: Response) => {
    const memberCount = parseInt(req.query['memberCount'] as string, 10) || 0;

    const result = await handlers.getTeamMetrics.execute(
      String(req.params['teamId']),
      memberCount,
      true,
    );

    if (!result.ok) {
      const status = result.error.code === 'TEAM_TOO_SMALL' ? 403 : 500;
      res.status(status).json(problemDetails(status, result.error.code, result.error.message));
      return;
    }

    res.json(result.value.history);
  });

  router.get('/anomalies', async (req: Request, res: Response) => {
    const teamId = req.query['teamId'] as string | undefined;
    const result = await handlers.metricRepo.getAnomalies(teamId, 50);

    if (!result.ok) {
      res.status(500).json(problemDetails(500, result.error.code, result.error.message));
      return;
    }

    res.json(result.value);
  });

  router.post('/anomalies/:anomalyId/acknowledge', async (req: Request, res: Response) => {
    const result = await handlers.metricRepo.acknowledgeAnomaly(String(req.params['anomalyId']));

    if (!result.ok) {
      res.status(500).json(problemDetails(500, result.error.code, result.error.message));
      return;
    }

    res.status(204).send();
  });

  return router;
}
