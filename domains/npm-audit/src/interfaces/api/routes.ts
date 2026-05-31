import { Router } from 'express';
import type { NpmAuditRepository } from '../../infrastructure/dynamodb/npm-audit-repository.js';
import { runAuditScan, getScanStatus } from '../../application/services/audit-scanner.js';

export function createNpmAuditRouter(repo: NpmAuditRepository, org: string): Router {
  const router = Router();

  router.post('/scan', (_req, res) => {
    const current = getScanStatus();
    if (current?.status === 'scanning') {
      res.status(409).json({ error: 'Scan already in progress', run: current });
      return;
    }
    runAuditScan(org, repo).catch((e) => console.error('[npm-audit] unhandled error:', e));
    res.status(202).json({ message: 'Scan started', runId: getScanStatus()?.runId });
  });

  router.get('/status', async (_req, res) => {
    const inMemory = getScanStatus();
    if (inMemory) {
      res.json(inMemory);
      return;
    }
    const latest = await repo.getLatestRun();
    res.json(latest ?? { status: 'idle' });
  });

  router.get('/results', async (_req, res) => {
    const results = await repo.listAllRepoResults();
    results.sort((a, b) => {
      const score = (r: typeof a) => r.critical * 1000 + r.high * 100 + r.moderate * 10 + r.low;
      return score(b) - score(a);
    });
    res.json(results);
  });

  router.get('/results/:owner/:name', async (req, res) => {
    const repoFullName = `${req.params['owner']}/${req.params['name']}`;
    const result = await repo.getRepoResult(repoFullName);
    if (!result) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(result);
  });

  router.delete('/results/:owner/:name', async (req, res) => {
    const repoFullName = `${req.params['owner']}/${req.params['name']}`;
    await repo.deleteRepoResult(repoFullName);
    res.status(204).end();
  });

  return router;
}
