import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import {
  type DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  DeleteCommand,
  GetCommand,
} from '@wep/aws-clients';
import { GitHubClient } from '@wep/github-client';

// ─── Domain Types ────────────────────────────────────────────────────────────

type Ecosystem = 'npm' | 'pip' | 'maven' | 'go';
type PackageStatus = 'adopt' | 'trial' | 'assess' | 'hold' | 'unassessed' | 'rejected';

interface RepoReference {
  repoName: string;
  version: string;
}

interface HistoryEntry {
  userId: string;
  userName: string;
  oldStatus: string;
  newStatus: string;
  note?: string;
  timestamp: string;
}

interface Comment {
  commentId: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: string;
}

interface VulnResult {
  id: string;
  severity: string;
  summary: string;
  fixedIn?: string;
}

interface PackageItem {
  PK: 'PACKAGES';
  SK: string; // PKG#<ecosystem>#<name>
  name: string;
  ecosystem: Ecosystem;
  status: PackageStatus;
  description: string;
  repositories: RepoReference[];
  history: HistoryEntry[];
  comments: Comment[];
  vulns: VulnResult[];
  vulnScannedAt?: string;
  addedBy: string;
  ownerId: string;
  addedAt: string;
  updatedAt: string;
}

interface ScanStateItem {
  PK: 'SCAN_STATE';
  SK: 'LATEST';
  scanId: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'done' | 'failed';
  repoCount: number;
  packageCount: number;
  error?: string;
}

// ─── Body shapes ─────────────────────────────────────────────────────────────

interface AddPackageBody {
  name: string;
  ecosystem: Ecosystem;
  status?: PackageStatus;
  description?: string;
  addedBy: string;
  addedByName: string;
}

interface UpdatePackageBody {
  status?: PackageStatus;
  description?: string;
  updatedBy: string;
  updatedByName: string;
}

interface DeletePackageBody {
  requesterId: string;
}

interface StartScanBody {
  triggeredBy: string;
  triggeredByName: string;
  org: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function problemDetails(status: number, title: string, detail: string) {
  return { type: 'about:blank', title, status, detail };
}

function makeSK(ecosystem: string, name: string): string {
  return `PKG#${ecosystem}#${name}`;
}

function isEcosystem(value: unknown): value is Ecosystem {
  return value === 'npm' || value === 'pip' || value === 'maven' || value === 'go';
}

function isPackageStatus(value: unknown): value is PackageStatus {
  return (
    value === 'adopt' ||
    value === 'trial' ||
    value === 'assess' ||
    value === 'hold' ||
    value === 'unassessed' ||
    value === 'rejected'
  );
}

// Run `tasks` in chunks of `concurrency` at a time
async function pMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const chunkResults = await Promise.all(chunk.map(fn));
    results.push(...chunkResults);
  }
  return results;
}

// ─── Package parsing helpers ──────────────────────────────────────────────────

function parseNpmDeps(content: string): Array<{ name: string; version: string }> {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') return [];
    const obj = parsed as Record<string, unknown>;
    const deps: Record<string, unknown> = {};
    if (obj['dependencies'] && typeof obj['dependencies'] === 'object') {
      Object.assign(deps, obj['dependencies']);
    }
    if (obj['devDependencies'] && typeof obj['devDependencies'] === 'object') {
      Object.assign(deps, obj['devDependencies']);
    }
    return Object.entries(deps).map(([name, version]) => ({
      name,
      version: typeof version === 'string' ? version : 'unknown',
    }));
  } catch {
    return [];
  }
}

function parsePipDeps(content: string): Array<{ name: string; version: string }> {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const name = line.split('==')[0]?.split('>=')[0]?.toLowerCase() ?? line;
      const versionMatch = line.match(/[=><!]=?\s*([\d.*]+)/);
      return { name: name.trim(), version: versionMatch?.[1] ?? 'unknown' };
    });
}

function parseGoDeps(content: string): Array<{ name: string; version: string }> {
  const results: Array<{ name: string; version: string }> = [];
  let inRequire = false;
  for (const line of content.split('\n')) {
    if (line.startsWith('require (')) {
      inRequire = true;
      continue;
    }
    if (inRequire && line.startsWith(')')) {
      inRequire = false;
      continue;
    }
    if (inRequire && line.startsWith('\t')) {
      const parts = line.trim().split(/\s+/);
      if (parts[0]) {
        results.push({ name: parts[0], version: parts[1] ?? 'unknown' });
      }
    }
    // single-line: require github.com/foo/bar v1.2.3
    const singleMatch = line.match(/^require\s+(\S+)\s+(\S+)/);
    if (singleMatch && singleMatch[1] && singleMatch[2]) {
      results.push({ name: singleMatch[1], version: singleMatch[2] });
    }
  }
  return results;
}

// ─── Background scan ─────────────────────────────────────────────────────────

async function runScan(
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
  scanId: string,
  org: string,
): Promise<void> {
  const github = new GitHubClient();

  const reposResult = await github.listOrgRepos(org);
  if (!reposResult.ok) {
    await dynamoClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: 'SCAN_STATE',
          SK: 'LATEST',
          scanId,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          status: 'failed',
          repoCount: 0,
          packageCount: 0,
          error: reposResult.error.message,
        } satisfies ScanStateItem,
      }),
    );
    return;
  }

  const activeRepos = reposResult.value.filter((r) => !r.archived);

  // Track discovered packages: key = ecosystem#name -> RepoReference[]
  const discovered = new Map<string, { name: string; ecosystem: Ecosystem; repos: RepoReference[] }>();

  function addDiscovered(name: string, ecosystem: Ecosystem, repoName: string, version: string) {
    const key = `${ecosystem}#${name}`;
    const existing = discovered.get(key);
    if (existing) {
      if (!existing.repos.some((r) => r.repoName === repoName)) {
        existing.repos.push({ repoName, version });
      }
    } else {
      discovered.set(key, { name, ecosystem, repos: [{ repoName, version }] });
    }
  }

  await pMap(
    activeRepos,
    async (repo) => {
      const [npmResult, pipResult, goResult] = await Promise.all([
        github.getFileContent(org, repo.name, 'package.json'),
        github.getFileContent(org, repo.name, 'requirements.txt'),
        github.getFileContent(org, repo.name, 'go.mod'),
      ]);

      if (npmResult.ok && npmResult.value) {
        for (const dep of parseNpmDeps(npmResult.value)) {
          addDiscovered(dep.name, 'npm', repo.name, dep.version);
        }
      }
      if (pipResult.ok && pipResult.value) {
        for (const dep of parsePipDeps(pipResult.value)) {
          addDiscovered(dep.name, 'pip', repo.name, dep.version);
        }
      }
      if (goResult.ok && goResult.value) {
        for (const dep of parseGoDeps(goResult.value)) {
          addDiscovered(dep.name, 'go', repo.name, dep.version);
        }
      }
    },
    5,
  );

  const now = new Date().toISOString();

  // Upsert each discovered package
  for (const [key, info] of discovered.entries()) {
    const sk = `PKG#${key}`;
    const existing = await dynamoClient.send(
      new GetCommand({ TableName: tableName, Key: { PK: 'PACKAGES', SK: sk } }),
    );

    if (existing.Item) {
      // Merge repositories
      const currentRepos: RepoReference[] = (existing.Item['repositories'] as RepoReference[]) ?? [];
      for (const newRepo of info.repos) {
        if (!currentRepos.some((r) => r.repoName === newRepo.repoName)) {
          currentRepos.push(newRepo);
        }
      }
      await dynamoClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            ...existing.Item,
            repositories: currentRepos,
            updatedAt: now,
          },
        }),
      );
    } else {
      const newItem: PackageItem = {
        PK: 'PACKAGES',
        SK: sk,
        name: info.name,
        ecosystem: info.ecosystem,
        status: 'adopt',
        description: '',
        repositories: info.repos,
        history: [],
        comments: [],
        vulns: [],
        addedBy: 'scanner',
        ownerId: 'scanner',
        addedAt: now,
        updatedAt: now,
      };
      await dynamoClient.send(new PutCommand({ TableName: tableName, Item: newItem }));
    }
  }

  await dynamoClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: 'SCAN_STATE',
        SK: 'LATEST',
        scanId,
        startedAt: now,
        completedAt: new Date().toISOString(),
        status: 'done',
        repoCount: activeRepos.length,
        packageCount: discovered.size,
      } satisfies ScanStateItem,
    }),
  );
}

// ─── Router ───────────────────────────────────────────────────────────────────

export function createTechRadarRouter(
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
): Router {
  const router = Router();

  // GET /packages
  router.get('/packages', async (req: Request, res: Response) => {
    const { ecosystem, status } = req.query;

    const allItems: PackageItem[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': 'PACKAGES' },
          ExclusiveStartKey: lastKey,
        }),
      );
      for (const item of (result.Items ?? []) as PackageItem[]) {
        allItems.push(item);
      }
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    let items = allItems;

    if (typeof ecosystem === 'string' && ecosystem) {
      items = items.filter((i) => i.ecosystem === ecosystem);
    }
    if (typeof status === 'string' && status) {
      items = items.filter((i) => i.status === status);
    }

    res.json(items);
  });

  // POST /packages
  router.post('/packages', async (req: Request, res: Response) => {
    const body = req.body as Partial<AddPackageBody>;

    if (!body.name || typeof body.name !== 'string') {
      res.status(400).json(problemDetails(400, 'Bad Request', 'name is required'));
      return;
    }
    if (!isEcosystem(body.ecosystem)) {
      res.status(400).json(problemDetails(400, 'Bad Request', 'ecosystem must be npm, pip, maven, or go'));
      return;
    }
    if (!body.addedBy || typeof body.addedBy !== 'string') {
      res.status(400).json(problemDetails(400, 'Bad Request', 'addedBy is required'));
      return;
    }

    const status: PackageStatus = isPackageStatus(body.status) ? body.status : 'assess';
    const now = new Date().toISOString();

    const item: PackageItem = {
      PK: 'PACKAGES',
      SK: makeSK(body.ecosystem, body.name),
      name: body.name,
      ecosystem: body.ecosystem,
      status,
      description: body.description ?? '',
      repositories: [],
      history: [],
      comments: [],
      vulns: [],
      addedBy: body.addedBy,
      ownerId: body.addedBy,
      addedAt: now,
      updatedAt: now,
    };

    await dynamoClient.send(new PutCommand({ TableName: tableName, Item: item }));
    res.status(201).json(item);
  });

  // PUT /packages/:packageId
  router.put('/packages/:packageId', async (req: Request<{ packageId: string }>, res: Response) => {
    const packageId = decodeURIComponent(req.params.packageId ?? '');
    const body = req.body as Partial<UpdatePackageBody>;

    if (!body.updatedBy || typeof body.updatedBy !== 'string') {
      res.status(400).json(problemDetails(400, 'Bad Request', 'updatedBy is required'));
      return;
    }

    const [ecosystem, ...nameParts] = packageId.split('#');
    const name = nameParts.join('#');
    if (!ecosystem || !name) {
      res.status(400).json(problemDetails(400, 'Bad Request', 'Invalid packageId format'));
      return;
    }

    const sk = makeSK(ecosystem, name);
    const existing = await dynamoClient.send(
      new GetCommand({ TableName: tableName, Key: { PK: 'PACKAGES', SK: sk } }),
    );

    if (!existing.Item) {
      res.status(404).json(problemDetails(404, 'Not Found', `Package ${packageId} not found`));
      return;
    }

    const current = existing.Item as PackageItem;
    const now = new Date().toISOString();
    const history: HistoryEntry[] = [...current.history];

    let newStatus = current.status;
    if (body.status !== undefined) {
      if (!isPackageStatus(body.status)) {
        res.status(400).json(problemDetails(400, 'Bad Request', 'Invalid status value'));
        return;
      }
      if (body.status !== current.status) {
        history.unshift({
          userId: body.updatedBy,
          userName: body.updatedByName ?? body.updatedBy,
          oldStatus: current.status,
          newStatus: body.status,
          timestamp: now,
        });
        newStatus = body.status;
      }
    }

    const updated: PackageItem = {
      ...current,
      status: newStatus,
      description: body.description !== undefined ? body.description : current.description,
      history,
      updatedAt: now,
    };

    await dynamoClient.send(new PutCommand({ TableName: tableName, Item: updated }));
    res.json(updated);
  });

  // DELETE /packages/:packageId
  router.delete('/packages/:packageId', async (req: Request<{ packageId: string }>, res: Response) => {
    const packageId = decodeURIComponent(req.params.packageId ?? '');
    const body = req.body as Partial<DeletePackageBody>;

    if (!body.requesterId || typeof body.requesterId !== 'string') {
      res.status(400).json(problemDetails(400, 'Bad Request', 'requesterId is required'));
      return;
    }

    const [ecosystem, ...nameParts] = packageId.split('#');
    const name = nameParts.join('#');
    if (!ecosystem || !name) {
      res.status(400).json(problemDetails(400, 'Bad Request', 'Invalid packageId format'));
      return;
    }

    const sk = makeSK(ecosystem, name);
    const existing = await dynamoClient.send(
      new GetCommand({ TableName: tableName, Key: { PK: 'PACKAGES', SK: sk } }),
    );

    if (!existing.Item) {
      res.status(404).json(problemDetails(404, 'Not Found', `Package ${packageId} not found`));
      return;
    }

    const current = existing.Item as PackageItem;

    if (body.requesterId !== 'devops' && body.requesterId !== current.ownerId) {
      res.status(403).json(problemDetails(403, 'Forbidden', 'Only the owner or devops may delete this package'));
      return;
    }

    await dynamoClient.send(
      new DeleteCommand({ TableName: tableName, Key: { PK: 'PACKAGES', SK: sk } }),
    );
    res.status(204).send();
  });

  // POST /packages/:packageId/comments
  router.post('/packages/:packageId/comments', async (req: Request<{ packageId: string }>, res: Response) => {
    const packageId = decodeURIComponent(req.params.packageId ?? '');
    const { userId, userName, text } = req.body as { userId?: string; userName?: string; text?: string };

    if (!text?.trim()) {
      res.status(400).json(problemDetails(400, 'Bad Request', 'text is required'));
      return;
    }

    const [ecosystem, ...nameParts] = packageId.split('#');
    const name = nameParts.join('#');
    if (!ecosystem || !name) {
      res.status(400).json(problemDetails(400, 'Bad Request', 'Invalid packageId format'));
      return;
    }

    const sk = makeSK(ecosystem, name);
    const existing = await dynamoClient.send(new GetCommand({ TableName: tableName, Key: { PK: 'PACKAGES', SK: sk } }));
    if (!existing.Item) {
      res.status(404).json(problemDetails(404, 'Not Found', `Package ${packageId} not found`));
      return;
    }

    const current = existing.Item as PackageItem;
    const comment: Comment = {
      commentId: randomUUID(),
      userId: userId ?? 'anonymous',
      userName: userName ?? 'Anonymous',
      text: text.trim(),
      timestamp: new Date().toISOString(),
    };
    const updated: PackageItem = {
      ...current,
      comments: [...(current.comments ?? []), comment],
      updatedAt: new Date().toISOString(),
    };

    await dynamoClient.send(new PutCommand({ TableName: tableName, Item: updated }));
    res.status(201).json(updated);
  });

  // POST /packages/:packageId/vuln-scan — queries OSV.dev for known CVEs
  router.post('/packages/:packageId/vuln-scan', async (req: Request<{ packageId: string }>, res: Response) => {
    const packageId = decodeURIComponent(req.params.packageId ?? '');
    const [ecosystem, ...nameParts] = packageId.split('#');
    const name = nameParts.join('#');
    if (!ecosystem || !name) {
      res.status(400).json(problemDetails(400, 'Bad Request', 'Invalid packageId format'));
      return;
    }

    const sk = makeSK(ecosystem, name);
    const existing = await dynamoClient.send(new GetCommand({ TableName: tableName, Key: { PK: 'PACKAGES', SK: sk } }));
    if (!existing.Item) {
      res.status(404).json(problemDetails(404, 'Not Found', `Package ${packageId} not found`));
      return;
    }

    const current = existing.Item as PackageItem;

    // Map ecosystem to OSV ecosystem name
    const osvEcosystem: Record<string, string> = {
      npm: 'npm',
      pip: 'PyPI',
      maven: 'Maven',
      go: 'Go',
    };
    const osvEco = osvEcosystem[current.ecosystem] ?? current.ecosystem;

    let vulns: VulnResult[] = [];
    try {
      const osvResp = await fetch('https://api.osv.dev/v1/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package: { name: current.name, ecosystem: osvEco } }),
      });
      if (osvResp.ok) {
        const osvData = await osvResp.json() as { vulns?: Array<{ id: string; severity?: Array<{ type: string; score: string }>; summary?: string; affected?: Array<{ ranges?: Array<{ events?: Array<{ fixed?: string }> }> }> }> };
        vulns = (osvData.vulns ?? []).slice(0, 20).map((v) => ({
          id: v.id,
          severity: v.severity?.[0]?.score ?? 'unknown',
          summary: v.summary ?? '',
          fixedIn: v.affected?.[0]?.ranges?.[0]?.events?.find((e) => e.fixed)?.fixed,
        }));
      }
    } catch {
      // OSV unreachable — return empty
    }

    const updated: PackageItem = {
      ...current,
      vulns,
      vulnScannedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await dynamoClient.send(new PutCommand({ TableName: tableName, Item: updated }));
    res.json(updated);
  });

  // GET /scan/status
  router.get('/scan/status', async (_req: Request, res: Response) => {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: 'SCAN_STATE', SK: 'LATEST' },
      }),
    );

    if (!result.Item) {
      res.status(404).json(problemDetails(404, 'Not Found', 'No scan has been run yet'));
      return;
    }

    res.json(result.Item);
  });

  // POST /scan
  router.post('/scan', async (req: Request, res: Response) => {
    const body = req.body as Partial<StartScanBody>;

    if (!body.org || typeof body.org !== 'string') {
      res.status(400).json(problemDetails(400, 'Bad Request', 'org is required'));
      return;
    }
    if (!body.triggeredBy || typeof body.triggeredBy !== 'string') {
      res.status(400).json(problemDetails(400, 'Bad Request', 'triggeredBy is required'));
      return;
    }

    const scanId = randomUUID();
    const now = new Date().toISOString();

    const scanState: ScanStateItem = {
      PK: 'SCAN_STATE',
      SK: 'LATEST',
      scanId,
      startedAt: now,
      status: 'running',
      repoCount: 0,
      packageCount: 0,
    };

    await dynamoClient.send(new PutCommand({ TableName: tableName, Item: scanState }));

    // Fire-and-forget
    runScan(dynamoClient, tableName, scanId, body.org).catch((err: unknown) => {
      console.error('[tech-radar scan]', err);
    });

    res.status(202).json({ scanId, message: 'Scan started' });
  });

  return router;
}
