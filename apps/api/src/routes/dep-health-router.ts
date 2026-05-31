import { Router, Request, Response } from 'express';
import {
  type DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  ScanCommand,
} from '@wep/aws-clients';
import { getTableName } from '@wep/aws-clients';

// ── Domain Types ──────────────────────────────────────────────────────────────

export interface DepEntry {
  name: string;
  currentVersion: string;
  resolvedVersion?: string;
  latestVersion?: string;
  latestMajor?: number;
  majorsBehind?: number;
  hasKnownCVE?: boolean;
  isOutdated?: boolean;
  license?: string;
}

export interface DepSnapshot {
  serviceName: string;
  repoUrl: string;
  scannedAt: string;
  nodeVersion?: string;
  dependencies: DepEntry[];
  devDependencies: DepEntry[];
}

interface DepSnapshotRecord extends DepSnapshot {
  PK: string; // SERVICE#<serviceName>
  SK: string; // SNAPSHOT#<scannedAt>
  GSI1PK: string; // SNAPSHOT
  GSI1SK: string; // <scannedAt>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function serviceKey(serviceName: string): string {
  return `SERVICE#${serviceName}`;
}

function snapshotKey(scannedAt: string): string {
  return `SNAPSHOT#${scannedAt}`;
}

function allDeps(snapshot: DepSnapshot): DepEntry[] {
  return [...snapshot.dependencies, ...snapshot.devDependencies];
}

function outdatedCount(snapshot: DepSnapshot): number {
  return allDeps(snapshot).filter((d) => d.isOutdated || (d.majorsBehind ?? 0) > 0).length;
}

function cveCount(snapshot: DepSnapshot): number {
  return allDeps(snapshot).filter((d) => d.hasKnownCVE).length;
}

function healthScore(snapshot: DepSnapshot): number {
  const deps = allDeps(snapshot);
  if (deps.length === 0) return 100;
  const outdated = outdatedCount(snapshot);
  const cves = cveCount(snapshot);
  const base = Math.max(0, 100 - Math.round((outdated / deps.length) * 60) - cves * 5);
  return Math.min(100, base);
}

// ── Router Factory ────────────────────────────────────────────────────────────

export function createDepHealthRouter(dynamoClient: DynamoDBDocumentClient): Router {
  const router = Router();
  const tableName = getTableName('dep-health');

  // ── GET /summary ────────────────────────────────────────────────────────────
  router.get('/summary', async (_req: Request, res: Response) => {
    try {
      // Scan all items, then pick the latest snapshot per service
      const result = await dynamoClient.send(new ScanCommand({ TableName: tableName }));
      const items = (result.Items ?? []) as DepSnapshotRecord[];

      // Group by service, keep only latest per service
      const latestByService = new Map<string, DepSnapshotRecord>();
      for (const item of items) {
        const existing = latestByService.get(item.serviceName);
        if (!existing || item.scannedAt > existing.scannedAt) {
          latestByService.set(item.serviceName, item);
        }
      }

      const snapshots = Array.from(latestByService.values());

      const totalServices = snapshots.length;
      const allDepNames = new Set<string>();
      let totalOutdated = 0;
      let totalDeps = 0;

      // Dep usage map: depName → { services, totalMajorsBehind, hasCVE }
      const depUsage = new Map<string, { services: Set<string>; totalMajorsBehind: number; hasCVE: boolean }>();

      for (const snap of snapshots) {
        const deps = allDeps(snap);
        totalDeps += deps.length;
        for (const dep of deps) {
          allDepNames.add(dep.name);
          if (dep.isOutdated || (dep.majorsBehind ?? 0) > 0) totalOutdated++;
          const entry = depUsage.get(dep.name) ?? { services: new Set(), totalMajorsBehind: 0, hasCVE: false };
          entry.services.add(snap.serviceName);
          entry.totalMajorsBehind += dep.majorsBehind ?? 0;
          if (dep.hasKnownCVE) entry.hasCVE = true;
          depUsage.set(dep.name, entry);
        }
      }

      const pctOutdated = totalDeps > 0 ? Math.round((totalOutdated / totalDeps) * 100) : 0;

      // Top 10 most-outdated deps (by avg majors behind desc)
      const topOutdated = Array.from(depUsage.entries())
        .map(([name, info]) => ({
          name,
          serviceCount: info.services.size,
          avgMajorsBehind: info.services.size > 0 ? info.totalMajorsBehind / info.services.size : 0,
          hasCVE: info.hasCVE,
        }))
        .filter((d) => d.avgMajorsBehind > 0)
        .sort((a, b) => b.avgMajorsBehind - a.avgMajorsBehind)
        .slice(0, 10);

      // Top 10 most-used deps (by number of services)
      const topUsed = Array.from(depUsage.entries())
        .map(([name, info]) => ({ name, serviceCount: info.services.size, hasCVE: info.hasCVE }))
        .sort((a, b) => b.serviceCount - a.serviceCount)
        .slice(0, 10);

      // Services with most outdated deps
      const servicesWithMostOutdated = snapshots
        .map((snap) => ({
          serviceName: snap.serviceName,
          outdatedCount: outdatedCount(snap),
          totalDeps: allDeps(snap).length,
        }))
        .sort((a, b) => b.outdatedCount - a.outdatedCount)
        .slice(0, 10);

      res.json({
        totalServices,
        totalUniqueDeps: allDepNames.size,
        pctOutdated,
        topOutdated,
        topUsed,
        servicesWithMostOutdated,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ type: 'about:blank', title: 'Failed to load summary', status: 500, detail: message });
    }
  });

  // ── GET /services ────────────────────────────────────────────────────────────
  router.get('/services', async (_req: Request, res: Response) => {
    try {
      const result = await dynamoClient.send(new ScanCommand({ TableName: tableName }));
      const items = (result.Items ?? []) as DepSnapshotRecord[];

      // Latest snapshot per service
      const latestByService = new Map<string, DepSnapshotRecord>();
      for (const item of items) {
        const existing = latestByService.get(item.serviceName);
        if (!existing || item.scannedAt > existing.scannedAt) {
          latestByService.set(item.serviceName, item);
        }
      }

      const services = Array.from(latestByService.values()).map((snap) => ({
        serviceName: snap.serviceName,
        repoUrl: snap.repoUrl,
        scannedAt: snap.scannedAt,
        depCount: allDeps(snap).length,
        outdatedCount: outdatedCount(snap),
        cveCount: cveCount(snap),
        healthScore: healthScore(snap),
      }));

      services.sort((a, b) => a.serviceName.localeCompare(b.serviceName));

      res.json({ services });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ type: 'about:blank', title: 'Failed to list services', status: 500, detail: message });
    }
  });

  // ── GET /services/:serviceName ────────────────────────────────────────────────
  router.get('/services/:serviceName', async (req: Request, res: Response) => {
    const serviceName = String(req.params['serviceName'] ?? '');
    if (!serviceName) {
      res.status(400).json({ type: 'about:blank', title: 'Bad request', status: 400, detail: 'serviceName is required' });
      return;
    }

    try {
      const result = await dynamoClient.send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': serviceKey(serviceName) },
        ScanIndexForward: false, // newest first
        Limit: 1,
      }));

      const item = (result.Items ?? [])[0] as DepSnapshotRecord | undefined;
      if (!item) {
        res.status(404).json({ type: 'about:blank', title: 'Not found', status: 404, detail: `No snapshot found for service: ${serviceName}` });
        return;
      }

      res.json({
        serviceName: item.serviceName,
        repoUrl: item.repoUrl,
        scannedAt: item.scannedAt,
        nodeVersion: item.nodeVersion,
        dependencies: item.dependencies,
        devDependencies: item.devDependencies,
        summary: {
          depCount: allDeps(item).length,
          outdatedCount: outdatedCount(item),
          cveCount: cveCount(item),
          healthScore: healthScore(item),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ type: 'about:blank', title: 'Failed to load service snapshot', status: 500, detail: message });
    }
  });

  // ── POST /services/:serviceName/snapshot ─────────────────────────────────────
  router.post('/services/:serviceName/snapshot', async (req: Request, res: Response) => {
    const serviceName = String(req.params['serviceName'] ?? '');
    if (!serviceName) {
      res.status(400).json({ type: 'about:blank', title: 'Bad request', status: 400, detail: 'serviceName is required' });
      return;
    }

    const body = req.body as Partial<DepSnapshot>;
    if (!body.repoUrl || !Array.isArray(body.dependencies) || !Array.isArray(body.devDependencies)) {
      res.status(400).json({
        type: 'about:blank', title: 'Bad request', status: 400,
        detail: 'repoUrl, dependencies, and devDependencies are required',
      });
      return;
    }

    const scannedAt = body.scannedAt ?? new Date().toISOString();

    const record: DepSnapshotRecord = {
      PK: serviceKey(serviceName),
      SK: snapshotKey(scannedAt),
      GSI1PK: 'SNAPSHOT',
      GSI1SK: scannedAt,
      serviceName,
      repoUrl: body.repoUrl,
      scannedAt,
      nodeVersion: body.nodeVersion,
      dependencies: body.dependencies,
      devDependencies: body.devDependencies,
    };

    try {
      await dynamoClient.send(new PutCommand({ TableName: tableName, Item: record }));
      res.status(201).json({ ok: true, serviceName, scannedAt });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ type: 'about:blank', title: 'Failed to save snapshot', status: 500, detail: message });
    }
  });

  // ── GET /deps/:depName ────────────────────────────────────────────────────────
  router.get('/deps/:depName', async (req: Request, res: Response) => {
    const depName = String(req.params['depName'] ?? '');
    if (!depName) {
      res.status(400).json({ type: 'about:blank', title: 'Bad request', status: 400, detail: 'depName is required' });
      return;
    }

    try {
      const result = await dynamoClient.send(new ScanCommand({ TableName: tableName }));
      const items = (result.Items ?? []) as DepSnapshotRecord[];

      // Latest snapshot per service
      const latestByService = new Map<string, DepSnapshotRecord>();
      for (const item of items) {
        const existing = latestByService.get(item.serviceName);
        if (!existing || item.scannedAt > existing.scannedAt) {
          latestByService.set(item.serviceName, item);
        }
      }

      const usages: Array<{
        serviceName: string;
        repoUrl: string;
        scannedAt: string;
        dep: DepEntry;
        isDev: boolean;
      }> = [];

      for (const snap of latestByService.values()) {
        for (const dep of snap.dependencies) {
          if (dep.name === depName) usages.push({ serviceName: snap.serviceName, repoUrl: snap.repoUrl, scannedAt: snap.scannedAt, dep, isDev: false });
        }
        for (const dep of snap.devDependencies) {
          if (dep.name === depName) usages.push({ serviceName: snap.serviceName, repoUrl: snap.repoUrl, scannedAt: snap.scannedAt, dep, isDev: true });
        }
      }

      usages.sort((a, b) => a.serviceName.localeCompare(b.serviceName));

      res.json({ depName, serviceCount: usages.length, usages });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ type: 'about:blank', title: 'Failed to search dependency', status: 500, detail: message });
    }
  });

  return router;
}
