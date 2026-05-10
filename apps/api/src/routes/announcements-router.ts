import { Router } from 'express';
import { randomUUID } from 'crypto';

interface Announcement {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
  createdAt: string;
  author: string;
}

const store: Announcement[] = [
  {
    id: randomUUID(),
    title: 'Planned maintenance: eu-west-1 DynamoDB tables',
    body: 'AWS is performing maintenance on DynamoDB in eu-west-1 on Saturday 2026-04-18 02:00–04:00 UTC.',
    severity: 'warning',
    createdAt: new Date(Date.now() - 180 * 60_000).toISOString(),
    author: 'omar.bizreh',
  },
  {
    id: randomUUID(),
    title: 'GitHub Actions runner upgrade complete',
    body: 'All self-hosted runners have been upgraded to ubuntu-24.04. Build times are ~15% faster.',
    severity: 'info',
    createdAt: new Date(Date.now() - 1440 * 60_000).toISOString(),
    author: 'platform-bot',
  },
];

export function createAnnouncementsRouter(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const sorted = [...store].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    res.json(sorted);
  });

  router.post('/', (req, res) => {
    const { title, body, severity, author } = req.body as Partial<Announcement>;
    if (!title || !body || !severity || !author) {
      res.status(400).json({ type: 'about:blank', title: 'Bad Request', status: 400, detail: 'title, body, severity, and author are required' });
      return;
    }
    if (!['info', 'warning', 'critical'].includes(severity)) {
      res.status(400).json({ type: 'about:blank', title: 'Bad Request', status: 400, detail: 'severity must be info, warning, or critical' });
      return;
    }
    const announcement: Announcement = {
      id: randomUUID(),
      title,
      body,
      severity,
      author,
      createdAt: new Date().toISOString(),
    };
    store.unshift(announcement);
    res.status(201).json(announcement);
  });

  return router;
}
