import { Router, Request, Response } from 'express';
import {
  type DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  ScanCommand,
} from '@wep/aws-clients';
import { getTableName } from '@wep/aws-clients';

// ─── Domain Types ─────────────────────────────────────────────────────────────

export type RiskLevel = 'safe' | 'notice' | 'warning' | 'critical';

export interface LicenseEntry {
  package: string;
  name: string;
  version: string;
  license: string;
  riskLevel: RiskLevel;
  repository?: string;
  publisher?: string;
}

export interface LicenseScan {
  serviceName: string;
  scannedAt: string;
  packageCount: number;
  criticalCount: number;
  warningCount: number;
  noticeCount: number;
  safeCount: number;
  licenses: LicenseEntry[];
}

interface DynamoLicenseScan extends LicenseScan {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
}

// ─── Risk Classification ──────────────────────────────────────────────────────

const SAFE_LICENSES = new Set([
  'MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC',
  'Unlicense', 'CC0-1.0', '0BSD',
]);

const NOTICE_LICENSES = new Set([
  'MPL-2.0', 'CDDL-1.0', 'EPL-1.0', 'EPL-2.0', 'CC-BY-4.0',
]);

const WARNING_LICENSES = new Set([
  'LGPL-2.0', 'LGPL-2.1', 'LGPL-3.0', 'CC-BY-SA-4.0',
  'LGPL-2.0-only', 'LGPL-2.1-only', 'LGPL-3.0-only',
]);

const CRITICAL_LICENSES = new Set([
  'GPL-2.0', 'GPL-3.0', 'GPL-2.0-only', 'GPL-3.0-only',
  'AGPL-1.0', 'AGPL-3.0', 'AGPL-3.0-only',
]);

export function classifyLicense(license: string): RiskLevel {
  const normalized = (license ?? '').trim();
  if (!normalized || normalized === 'UNKNOWN' || normalized === 'unknown') {
    return 'warning';
  }
  if (CRITICAL_LICENSES.has(normalized)) return 'critical';
  if (WARNING_LICENSES.has(normalized))  return 'warning';
  if (NOTICE_LICENSES.has(normalized))   return 'notice';
  if (SAFE_LICENSES.has(normalized))     return 'safe';
  // Fallback: unknown/unlisted license is a warning
  return 'warning';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function problemDetails(status: number, title: string, detail: string) {
  return { type: 'about:blank', title, status, detail };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export function createLicenseRouter(dynamoClient: DynamoDBDocumentClient): Router {
  const router = Router();
  const tableName = getTableName('licenses');

  // GET /summary — cross-service aggregate
  router.get('/summary', async (_req: Request, res: Response) => {
    // Scan all latest scans by querying all SERVICE# PKs
    // We use a scan with a filter on SK beginning with SCAN# to get all scans,
    // then group by serviceName to find the latest per service.
    const allItems: DynamoLicenseScan[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const result = await dynamoClient.send(
        new ScanCommand({
          TableName: tableName,
          ExclusiveStartKey: lastKey,
        }),
      );
      for (const item of (result.Items ?? []) as DynamoLicenseScan[]) {
        allItems.push(item);
      }
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    // Group by serviceName, pick latest scan per service
    const latestByService = new Map<string, DynamoLicenseScan>();
    for (const item of allItems) {
      const existing = latestByService.get(item.serviceName);
      if (!existing || item.scannedAt > existing.scannedAt) {
        latestByService.set(item.serviceName, item);
      }
    }

    const scans = Array.from(latestByService.values());

    let totalPackages = 0;
    let totalCritical = 0;
    let totalWarning = 0;
    const servicesWithCritical: string[] = [];

    // Track risky packages: license -> { services: Set, packages: Set }
    const riskyPackageMap = new Map<string, { license: string; riskLevel: RiskLevel; services: Set<string>; packages: Set<string> }>();

    for (const scan of scans) {
      totalPackages += scan.packageCount;
      totalCritical += scan.criticalCount;
      totalWarning += scan.warningCount;
      if (scan.criticalCount > 0) servicesWithCritical.push(scan.serviceName);

      for (const entry of scan.licenses ?? []) {
        if (entry.riskLevel === 'critical' || entry.riskLevel === 'warning') {
          const key = entry.package;
          const existing = riskyPackageMap.get(key);
          if (existing) {
            existing.services.add(scan.serviceName);
          } else {
            riskyPackageMap.set(key, {
              license: entry.license,
              riskLevel: entry.riskLevel,
              services: new Set([scan.serviceName]),
              packages: new Set([entry.package]),
            });
          }
        }
      }
    }

    const riskOrder: Record<RiskLevel, number> = { critical: 0, warning: 1, notice: 2, safe: 3 };
    const topRiskyPackages = Array.from(riskyPackageMap.entries())
      .map(([pkg, info]) => ({
        package: pkg,
        license: info.license,
        riskLevel: info.riskLevel,
        servicesAffected: info.services.size,
        services: Array.from(info.services),
      }))
      .sort((a, b) => {
        const riskDiff = riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
        if (riskDiff !== 0) return riskDiff;
        return b.servicesAffected - a.servicesAffected;
      })
      .slice(0, 20);

    res.json({
      totalPackages,
      criticalCount: totalCritical,
      warningCount: totalWarning,
      servicesScanned: scans.length,
      servicesWithCritical,
      topRiskyPackages,
    });
  });

  // GET /services — list all services with latest scan metadata
  router.get('/services', async (_req: Request, res: Response) => {
    const allItems: DynamoLicenseScan[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const result = await dynamoClient.send(
        new ScanCommand({
          TableName: tableName,
          ExclusiveStartKey: lastKey,
        }),
      );
      for (const item of (result.Items ?? []) as DynamoLicenseScan[]) {
        allItems.push(item);
      }
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    // Latest scan per service
    const latestByService = new Map<string, DynamoLicenseScan>();
    for (const item of allItems) {
      const existing = latestByService.get(item.serviceName);
      if (!existing || item.scannedAt > existing.scannedAt) {
        latestByService.set(item.serviceName, item);
      }
    }

    const services = Array.from(latestByService.values())
      .sort((a, b) => b.criticalCount - a.criticalCount || a.serviceName.localeCompare(b.serviceName))
      .map(({ serviceName, scannedAt, packageCount, criticalCount, warningCount, noticeCount, safeCount }) => ({
        serviceName, scannedAt, packageCount, criticalCount, warningCount, noticeCount, safeCount,
      }));

    res.json(services);
  });

  // GET /services/:serviceName — full latest scan
  router.get('/services/:serviceName', async (req: Request<{ serviceName: string }>, res: Response) => {
    const serviceName = decodeURIComponent(req.params.serviceName ?? '');
    if (!serviceName) {
      res.status(400).json(problemDetails(400, 'Bad Request', 'serviceName is required'));
      return;
    }

    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `SERVICE#${serviceName}` },
        ScanIndexForward: false,
        Limit: 1,
      }),
    );

    const items = result.Items as DynamoLicenseScan[] | undefined;
    if (!items || items.length === 0) {
      res.status(404).json(problemDetails(404, 'Not Found', `No scan found for service "${serviceName}"`));
      return;
    }

    const scan = items[0] as DynamoLicenseScan;
    const { PK, SK, GSI1PK, GSI1SK, ...publicScan } = scan;
    void PK; void SK; void GSI1PK; void GSI1SK;
    res.json(publicScan);
  });

  // POST /services/:serviceName/scan
  router.post('/services/:serviceName/scan', async (req: Request<{ serviceName: string }>, res: Response) => {
    const serviceName = decodeURIComponent(req.params.serviceName ?? '');
    if (!serviceName) {
      res.status(400).json(problemDetails(400, 'Bad Request', 'serviceName is required'));
      return;
    }

    const body = req.body as { packages?: Array<{ name?: string; version?: string; license?: string; repository?: string; publisher?: string }> };
    if (!body.packages || !Array.isArray(body.packages)) {
      res.status(400).json(problemDetails(400, 'Bad Request', 'packages array is required'));
      return;
    }

    const scannedAt = new Date().toISOString();

    const licenses: LicenseEntry[] = body.packages.map((pkg) => {
      const name = pkg.name ?? 'unknown';
      const version = pkg.version ?? '0.0.0';
      const license = pkg.license ?? 'UNKNOWN';
      return {
        package: `${name}@${version}`,
        name,
        version,
        license,
        riskLevel: classifyLicense(license),
        repository: pkg.repository,
        publisher: pkg.publisher,
      };
    });

    const criticalCount = licenses.filter((l) => l.riskLevel === 'critical').length;
    const warningCount  = licenses.filter((l) => l.riskLevel === 'warning').length;
    const noticeCount   = licenses.filter((l) => l.riskLevel === 'notice').length;
    const safeCount     = licenses.filter((l) => l.riskLevel === 'safe').length;

    const item: DynamoLicenseScan = {
      PK: `SERVICE#${serviceName}`,
      SK: `SCAN#${scannedAt}`,
      GSI1PK: 'ALL_SCANS',
      GSI1SK: scannedAt,
      serviceName,
      scannedAt,
      packageCount: licenses.length,
      criticalCount,
      warningCount,
      noticeCount,
      safeCount,
      licenses,
    };

    await dynamoClient.send(new PutCommand({ TableName: tableName, Item: item }));

    const { PK, SK, GSI1PK, GSI1SK, ...publicScan } = item;
    void PK; void SK; void GSI1PK; void GSI1SK;
    res.status(201).json(publicScan);
  });

  // GET /licenses/:license — all services+packages using a specific license
  router.get('/licenses/:license', async (req: Request<{ license: string }>, res: Response) => {
    const license = decodeURIComponent(req.params.license ?? '');
    if (!license) {
      res.status(400).json(problemDetails(400, 'Bad Request', 'license is required'));
      return;
    }

    const allItems: DynamoLicenseScan[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const result = await dynamoClient.send(
        new ScanCommand({
          TableName: tableName,
          ExclusiveStartKey: lastKey,
        }),
      );
      for (const item of (result.Items ?? []) as DynamoLicenseScan[]) {
        allItems.push(item);
      }
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    // Latest scan per service
    const latestByService = new Map<string, DynamoLicenseScan>();
    for (const item of allItems) {
      const existing = latestByService.get(item.serviceName);
      if (!existing || item.scannedAt > existing.scannedAt) {
        latestByService.set(item.serviceName, item);
      }
    }

    const matches: Array<{ serviceName: string; packages: LicenseEntry[] }> = [];
    for (const scan of latestByService.values()) {
      const pkgs = (scan.licenses ?? []).filter(
        (e) => e.license.toLowerCase() === license.toLowerCase(),
      );
      if (pkgs.length > 0) {
        matches.push({ serviceName: scan.serviceName, packages: pkgs });
      }
    }

    res.json({ license, riskLevel: classifyLicense(license), matches });
  });

  return router;
}
