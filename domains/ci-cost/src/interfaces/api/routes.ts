import { Router } from 'express';
import type { CiCostRepository } from '../../infrastructure/dynamodb/ci-cost-repository.js';
import { runCiCostScan, getCiCostScanStatus } from '../../application/services/ci-cost-scanner.js';

export function createCiCostRouter(repo: CiCostRepository, org: string): Router {
  const router = Router();

  router.post('/scan', (_req, res) => {
    const token = process.env['GITHUB_TOKEN'];
    if (!token) {
      res.status(503).json({ error: 'GITHUB_TOKEN not configured' });
      return;
    }
    const current = getCiCostScanStatus();
    if (current?.status === 'scanning') {
      res.status(409).json({ error: 'Scan already in progress', scan: current });
      return;
    }
    runCiCostScan(org, repo, token).catch((e) => console.error('[ci-cost] error:', e));
    res.status(202).json({ message: 'Scan started' });
  });

  router.get('/status', async (_req, res) => {
    const inMemory = getCiCostScanStatus();
    if (inMemory) {
      res.json(inMemory);
      return;
    }
    const latest = await repo.getLatestScanRun();
    res.json(latest ?? { status: 'idle' });
  });

  router.get('/results', async (_req, res) => {
    const results = await repo.listRepoSummaries();
    results.sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);
    res.json(results);
  });

  return router;
}
