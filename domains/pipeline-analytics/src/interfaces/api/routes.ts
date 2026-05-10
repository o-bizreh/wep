import { Router, type Request, type Response } from 'express';
import { problemDetails } from '@wep/domain-types';
import type { GetPipelineHealthHandler } from '../../application/queries/get-pipeline-health.js';
import type { GetFailureAnalysisHandler } from '../../application/queries/get-failure-analysis.js';
import type { GetCostBreakdownHandler } from '../../application/queries/get-cost-breakdown.js';
import type { PipelineRepository } from '../../domain/ports/pipeline-repository.js';

export interface PipelineRouteHandlers {
  getPipelineHealth: GetPipelineHealthHandler;
  getFailureAnalysis: GetFailureAnalysisHandler;
  getCostBreakdown: GetCostBreakdownHandler;
  pipelineRepo: PipelineRepository;
}

export function createPipelineRouter(handlers: PipelineRouteHandlers): Router {
  const router = Router();

  router.get('/health', async (req: Request, res: Response) => {
    const result = await handlers.getPipelineHealth.execute({
      serviceId: req.query['serviceId'] as string | undefined,
      startDate: req.query['startDate'] as string | undefined,
      endDate: req.query['endDate'] as string | undefined,
    });
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Error', result.error.message)); return; }
    res.json(result.value);
  });

  router.get('/failures', async (req: Request, res: Response) => {
    const result = await handlers.getFailureAnalysis.execute({
      serviceId: req.query['serviceId'] as string | undefined,
      startDate: req.query['startDate'] as string | undefined,
      endDate: req.query['endDate'] as string | undefined,
    });
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Error', result.error.message)); return; }
    res.json(result.value);
  });

  router.get('/failures/patterns', async (_req: Request, res: Response) => {
    const result = await handlers.pipelineRepo.getPatterns();
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Error', result.error.message)); return; }
    res.json(result.value);
  });

  router.post('/failures/patterns', async (req: Request, res: Response) => {
    const pattern = req.body;
    const result = await handlers.pipelineRepo.savePattern(pattern);
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Error', result.error.message)); return; }
    res.status(201).json({ status: 'created' });
  });

  router.get('/costs', async (req: Request, res: Response) => {
    const entityId = (req.query['teamId'] as string) ?? 'org:washmen';
    const period = (req.query['period'] as string) ?? new Date().toISOString().slice(0, 7);
    const result = await handlers.getCostBreakdown.execute(entityId, period);
    if (!result.ok) {
      const status = result.error.code === 'NOT_FOUND' ? 404 : 500;
      res.status(status).json(problemDetails(status, result.error.code, result.error.message));
      return;
    }
    res.json(result.value);
  });

  router.get('/runs', async (req: Request, res: Response) => {
    const serviceId = req.query['serviceId'] as string | undefined;
    const limit = parseInt(req.query['limit'] as string, 10) || 20;
    const result = await handlers.pipelineRepo.findRuns(
      { serviceId },
      { limit, cursor: req.query['cursor'] as string | undefined },
    );
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Error', result.error.message)); return; }
    res.json(result.value);
  });

  return router;
}
