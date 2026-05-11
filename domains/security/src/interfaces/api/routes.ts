import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { problemDetails } from '@wep/domain-types';
import { STSClient, GetCallerIdentityCommand } from '@wep/aws-clients';
import type { SecurityRepository } from '../../domain/ports/security-repository.js';
import type { SecurityTeam } from '../../domain/entities/team.js';
import type { GitLeaksFinding, GitLeaksReport } from '../../domain/entities/gitleaks-report.js';
import type { CveEntry } from '../../domain/entities/vuln-package.js';
import { ScanPackagesHandler } from '../../application/commands/scan-packages.js';

// ── Identity helpers (mirrors self-service pattern) ───────────────────────────

interface CallerIdentity {
  username: string;
  email: string;
  roleName: string;
  isDevOps: boolean;
  isDomainOwner: boolean;
}

const identityCache = new Map<string, { identity: CallerIdentity; expiresAt: number }>();
const DEVOPS_ROLE_PATTERN = process.env['DEVOPS_ROLE_PATTERN'] ?? 'DevOps';
const DOMAIN_OWNER_PATTERN = process.env['DOMAIN_OWNER_PATTERN'] ?? 'DomainOwner';
const EMAIL_DOMAIN = process.env['WEP_EMAIL_DOMAIN'] ?? 'washmen.com';

async function resolveCallerIdentity(req: Request): Promise<CallerIdentity | null> {
  const accessKeyId = req.headers['x-aws-access-key-id'] as string | undefined;
  const secretKey = req.headers['x-aws-secret-access-key'] as string | undefined;
  const sessionToken = req.headers['x-aws-session-token'] as string | undefined;

  if (!accessKeyId || !secretKey) return null;

  const cached = identityCache.get(accessKeyId);
  if (cached && cached.expiresAt > Date.now()) return cached.identity;

  const stsClient = new STSClient({
    region: process.env['AWS_REGION'] ?? 'eu-west-1',
    credentials: { accessKeyId, secretAccessKey: secretKey, sessionToken },
  });

  const result = await stsClient.send(new GetCallerIdentityCommand({}));
  const arn = result.Arn ?? '';
  const match = arn.match(/assumed-role\/([^/]+)\/(.+)$/);
  if (!match) return null;

  const roleName = match[1]!;
  const username = match[2]!;
  const identity: CallerIdentity = {
    username,
    email: `${username}@${EMAIL_DOMAIN}`,
    roleName,
    isDevOps: roleName.includes(DEVOPS_ROLE_PATTERN),
    isDomainOwner: roleName.includes(DOMAIN_OWNER_PATTERN),
  };

  identityCache.set(accessKeyId, { identity, expiresAt: Date.now() + 5 * 60_000 });
  return identity;
}

function devopsOnly(repo: SecurityRepository) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const identity = await resolveCallerIdentity(req).catch(() => null);
    if (!identity) { res.status(401).json(problemDetails(401, 'Unauthorized', 'AWS credentials required')); return; }
    if (!identity.isDevOps) { res.status(403).json(problemDetails(403, 'Forbidden', 'DevOps role required')); return; }
    // Auto-upsert user on access
    void upsertUserSilently(repo, identity);
    next();
  };
}

function domainOwnerOrDevops(repo: SecurityRepository) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const identity = await resolveCallerIdentity(req).catch(() => null);
    if (!identity) { res.status(401).json(problemDetails(401, 'Unauthorized', 'AWS credentials required')); return; }
    if (!identity.isDevOps && !identity.isDomainOwner) {
      res.status(403).json(problemDetails(403, 'Forbidden', 'DomainOwner or DevOps role required'));
      return;
    }
    void upsertUserSilently(repo, identity);
    next();
  };
}

async function upsertUserSilently(repo: SecurityRepository, identity: CallerIdentity): Promise<void> {
  const existing = await repo.getUser(identity.username).catch(() => ({ ok: false }));
  const now = new Date().toISOString();
  const firstSeenAt = (existing as { ok: true; value: { firstSeenAt?: string } | null }).ok
    && (existing as { ok: true; value: { firstSeenAt?: string } | null }).value?.firstSeenAt
    ? (existing as { ok: true; value: { firstSeenAt: string } }).value.firstSeenAt
    : now;

  await repo.upsertUser({
    username: identity.username,
    email: identity.email,
    roleName: identity.roleName,
    firstSeenAt,
    lastSeenAt: now,
  }).catch(() => { /* best-effort */ });
}

// ── Router factory ────────────────────────────────────────────────────────────

export function createSecurityRouter(repo: SecurityRepository): Router {
  const router = Router();
  const scanner = new ScanPackagesHandler(repo);

  // Auto-register any authenticated user on every request
  router.use(async (req, _res, next) => {
    const identity = await resolveCallerIdentity(req).catch(() => null);
    if (identity) void upsertUserSilently(repo, identity);
    next();
  });

  // ── Users ──────────────────────────────────────────────────────────────────

  // GET /security/users — DomainOwner or DevOps only
  router.get('/users', domainOwnerOrDevops(repo), async (_req, res) => {
    const result = await repo.listUsers();
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Internal error', result.error.message)); return; }
    res.json(result.value.sort((a, b) => a.username.localeCompare(b.username)));
  });

  // ── Teams ──────────────────────────────────────────────────────────────────

  // GET /security/teams
  router.get('/teams', async (req, res) => {
    const identity = await resolveCallerIdentity(req).catch(() => null);
    const result = await repo.listTeams();
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Internal error', result.error.message)); return; }

    if (!identity) { res.json([]); return; }

    // DevOps sees all; DomainOwner sees only their own team
    if (identity.isDevOps) {
      res.json(result.value);
    } else if (identity.isDomainOwner) {
      res.json(result.value.filter((t) => t.ownerUsername === identity.username));
    } else {
      // Regular engineers see teams they belong to
      res.json(result.value.filter((t) => t.memberUsernames.includes(identity.username)));
    }
  });

  // POST /security/teams — DomainOwner or DevOps
  router.post('/teams', domainOwnerOrDevops(repo), async (req, res) => {
    const identity = await resolveCallerIdentity(req).catch(() => null);
    if (!identity) { res.status(401).json(problemDetails(401, 'Unauthorized', '')); return; }

    const { name } = req.body as { name?: string };
    if (!name?.trim()) { res.status(400).json(problemDetails(400, 'Bad Request', 'name is required')); return; }

    // DomainOwners can only own one team
    if (identity.isDomainOwner && !identity.isDevOps) {
      const existing = await repo.getTeamByOwner(identity.username);
      if (existing.ok && existing.value) {
        res.status(409).json(problemDetails(409, 'Conflict', 'You already own a team. Edit it instead.'));
        return;
      }
    }

    const now = new Date().toISOString();
    const team: SecurityTeam = {
      teamId: randomUUID(),
      name: name.trim(),
      ownerUsername: identity.username,
      memberUsernames: [identity.username],
      createdAt: now,
      updatedAt: now,
    };

    const result = await repo.saveTeam(team);
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Internal error', result.error.message)); return; }
    res.status(201).json(team);
  });

  // PUT /security/teams/:teamId — DomainOwner (own team) or DevOps
  router.put('/teams/:teamId', async (req, res) => {
    const identity = await resolveCallerIdentity(req).catch(() => null);
    if (!identity) { res.status(401).json(problemDetails(401, 'Unauthorized', '')); return; }

    const teamResult = await repo.getTeam(req.params['teamId'] as string);
    if (!teamResult.ok) { res.status(500).json(problemDetails(500, 'Internal error', teamResult.error.message)); return; }
    if (!teamResult.value) { res.status(404).json(problemDetails(404, 'Not Found', 'Team not found')); return; }

    const team = teamResult.value;
    if (!identity.isDevOps && team.ownerUsername !== identity.username) {
      res.status(403).json(problemDetails(403, 'Forbidden', 'You can only edit your own team'));
      return;
    }

    const { name, memberUsernames } = req.body as { name?: string; memberUsernames?: string[] };
    const updated: SecurityTeam = {
      ...team,
      name: name?.trim() ?? team.name,
      memberUsernames: memberUsernames ?? team.memberUsernames,
      updatedAt: new Date().toISOString(),
    };

    const result = await repo.saveTeam(updated);
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Internal error', result.error.message)); return; }
    res.json(updated);
  });

  // DELETE /security/teams/:teamId — DevOps only, blocked if team has members
  router.delete('/teams/:teamId', devopsOnly(repo), async (req, res) => {
    const teamResult = await repo.getTeam(req.params['teamId'] as string);
    if (!teamResult.ok) { res.status(500).json(problemDetails(500, 'Internal error', teamResult.error.message)); return; }
    if (!teamResult.value) { res.status(404).json(problemDetails(404, 'Not Found', 'Team not found')); return; }

    const team = teamResult.value;
    const nonOwnerMembers = (team.memberUsernames ?? []).filter(u => u !== team.ownerUsername);
    if (nonOwnerMembers.length > 0) {
      res.status(409).json(problemDetails(409, 'Conflict', `Remove all ${nonOwnerMembers.length} member${nonOwnerMembers.length > 1 ? 's' : ''} before deleting this team.`));
      return;
    }

    const result = await repo.deleteTeam(req.params['teamId'] as string);
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Internal error', result.error.message)); return; }
    res.status(204).send();
  });

  // ── Monitored Repos ────────────────────────────────────────────────────────

  // GET /security/repos
  router.get('/repos', async (_req, res) => {
    const result = await repo.listMonitoredRepos();
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Internal error', result.error.message)); return; }
    res.json(result.value);
  });

  // POST /security/repos — any authenticated user can add a repo to monitor
  router.post('/repos', async (req, res) => {
    const identity = await resolveCallerIdentity(req).catch(() => null);
    if (!identity) { res.status(401).json(problemDetails(401, 'Unauthorized', 'AWS credentials required')); return; }

    const { fullName } = req.body as { fullName?: string };
    if (!fullName?.trim() || !fullName.includes('/')) {
      res.status(400).json(problemDetails(400, 'Bad Request', 'fullName (owner/repo) is required'));
      return;
    }

    const [owner, name] = fullName.trim().split('/') as [string, string];
    const existing = await repo.getMonitoredRepo(fullName.trim());
    if (existing.ok && existing.value) {
      res.status(409).json(problemDetails(409, 'Conflict', 'Repository is already being monitored'));
      return;
    }

    const repoRecord = {
      owner,
      name,
      fullName: fullName.trim(),
      addedBy: identity.username,
      addedAt: new Date().toISOString(),
      lastScannedAt: null,
      lastScanStatus: 'pending' as const,
      lastScanError: null,
      packageCount: 0,
    };

    const result = await repo.saveMonitoredRepo(repoRecord);
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Internal error', result.error.message)); return; }
    res.status(201).json(repoRecord);
  });

  // DELETE /security/repos/:owner/:name — DevOps or repo adder
  router.delete('/repos/:owner/:repoName', async (req, res) => {
    const identity = await resolveCallerIdentity(req).catch(() => null);
    if (!identity) { res.status(401).json(problemDetails(401, 'Unauthorized', '')); return; }

    const fullName = `${req.params['owner']}/${req.params['repoName']}`;
    const existing = await repo.getMonitoredRepo(fullName);
    if (!existing.ok) { res.status(500).json(problemDetails(500, 'Internal error', existing.error.message)); return; }
    if (!existing.value) { res.status(404).json(problemDetails(404, 'Not Found', 'Repo not found')); return; }

    if (!identity.isDevOps && existing.value.addedBy !== identity.username) {
      res.status(403).json(problemDetails(403, 'Forbidden', 'Only DevOps or the person who added this repo can remove it'));
      return;
    }

    const result = await repo.deleteMonitoredRepo(fullName);
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Internal error', result.error.message)); return; }
    res.status(204).send();
  });

  // POST /security/repos/:owner/:repoName/scan — trigger on-demand scan
  router.post('/repos/:owner/:repoName/scan', async (req, res) => {
    const identity = await resolveCallerIdentity(req).catch(() => null);
    if (!identity) { res.status(401).json(problemDetails(401, 'Unauthorized', '')); return; }

    const fullName = `${req.params['owner']}/${req.params['repoName']}`;
    // Fire scan in background and return immediately
    res.status(202).json({ message: 'Scan started', fullName });
    scanner.execute(fullName).then((r) => {
      if (!r.ok) console.error(`[security-scan] Scan failed for ${fullName}:`, r.error.message);
      else console.log(`[security-scan] Scan done for ${fullName}: ${r.value.packageCount} packages, ${r.value.cveCount} CVEs`);
    }).catch((e) => console.error(`[security-scan] Unhandled error:`, e));
  });

  // POST /security/scan/all — scan all monitored repos + radar
  router.post('/scan/all', async (req, res) => {
    const identity = await resolveCallerIdentity(req).catch(() => null);
    if (!identity) { res.status(401).json(problemDetails(401, 'Unauthorized', '')); return; }

    const reposResult = await repo.listMonitoredRepos();
    if (!reposResult.ok) { res.status(500).json(problemDetails(500, 'Internal error', reposResult.error.message)); return; }

    const repos = reposResult.value;
    res.status(202).json({ message: 'Scan started for all repos', repoCount: repos.length });

    for (const r of repos) {
      await scanner.execute(r.fullName).catch((e) => console.error(`[security-scan] Error scanning ${r.fullName}:`, e));
    }

    // Radar packages are injected via POST body from the frontend
    const { radarPackages } = req.body as { radarPackages?: Array<{ name: string; ecosystem: string }> };
    if (radarPackages?.length) {
      const refs = radarPackages.map((p) => ({ name: p.name, version: 'unknown', source: 'radar', depth: 'direct' as const, dependencyPath: [] }));
      await scanner.executeForPackages(refs, 'radar').catch((e) => console.error('[security-scan] Radar scan error:', e));
    }
  });

  // GET /security/repos/:owner/:repoName/vulns — packages + CVEs scoped to one repo
  router.get('/repos/:owner/:repoName/vulns', async (req, res) => {
    const fullName = `${req.params['owner']}/${req.params['repoName']}`;
    const allPkgs = await repo.listVulnPackages();
    if (!allPkgs.ok) { res.status(500).json(problemDetails(500, 'Internal error', allPkgs.error.message)); return; }

    const repoPkgs = allPkgs.value.filter((p) => p.sources.includes(fullName));
    const cveMap: Record<string, CveEntry[]> = {};
    await Promise.all(
      repoPkgs.map(async (p) => {
        const r = await repo.listCveEntries(p.ecosystem, p.name);
        if (r.ok) cveMap[p.name] = r.value;
      }),
    );
    res.json({ packages: repoPkgs, cves: cveMap });
  });

  // ── Vulnerabilities feed ───────────────────────────────────────────────────

  // GET /security/vulnerabilities
  router.get('/vulnerabilities', async (_req, res) => {
    const result = await repo.listVulnPackages();
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Internal error', result.error.message)); return; }
    // Only return packages with at least one CVE or that are actively monitored
    res.json(result.value.sort((a, b) => (b.criticalCount * 4 + b.highCount * 3) - (a.criticalCount * 4 + a.highCount * 3)));
  });

  // GET /security/vulnerabilities/:ecosystem/:name — CVE detail list
  router.get('/vulnerabilities/:ecosystem/:name', async (req, res) => {
    const { ecosystem, name } = req.params as { ecosystem: string; name: string };
    const [pkgResult, cveResult] = await Promise.all([
      repo.getVulnPackage(ecosystem, name),
      repo.listCveEntries(ecosystem, name),
    ]);
    if (!pkgResult.ok) { res.status(500).json(problemDetails(500, 'Internal error', pkgResult.error.message)); return; }
    if (!pkgResult.value) { res.status(404).json(problemDetails(404, 'Not Found', 'Package not found')); return; }
    res.json({ package: pkgResult.value, cves: cveResult.ok ? cveResult.value : [] });
  });

  // ── GitLeaks ───────────────────────────────────────────────────────────────

  // GET /security/gitleaks
  router.get('/gitleaks', async (_req, res) => {
    const result = await repo.listGitLeaksReports();
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Internal error', result.error.message)); return; }
    res.json(result.value.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)));
  });

  // GET /security/gitleaks/:reportId/findings
  router.get('/gitleaks/:reportId/findings', async (req, res) => {
    const [reportResult, findingsResult] = await Promise.all([
      repo.getGitLeaksReport(req.params['reportId'] as string),
      repo.listGitLeaksFindings(req.params['reportId'] as string),
    ]);
    if (!reportResult.ok) { res.status(500).json(problemDetails(500, 'Internal error', reportResult.error.message)); return; }
    if (!reportResult.value) { res.status(404).json(problemDetails(404, 'Not Found', 'Report not found')); return; }
    res.json({ report: reportResult.value, findings: findingsResult.ok ? findingsResult.value : [] });
  });

  // POST /security/gitleaks — DevOps only — upload & parse a GitLeaks JSON report
  router.post('/gitleaks', devopsOnly(repo), async (req, res) => {
    const identity = await resolveCallerIdentity(req).catch(() => null);
    if (!identity) { res.status(401).json(problemDetails(401, 'Unauthorized', '')); return; }

    const { repoFullName, findings: rawFindings } = req.body as {
      repoFullName?: string;
      findings?: Array<Record<string, unknown>>;
    };

    if (!repoFullName?.trim()) {
      res.status(400).json(problemDetails(400, 'Bad Request', 'repoFullName is required'));
      return;
    }
    if (!Array.isArray(rawFindings) || rawFindings.length === 0) {
      res.status(400).json(problemDetails(400, 'Bad Request', 'findings array is required and must not be empty'));
      return;
    }

    const reportId = randomUUID();
    const now = new Date().toISOString();
    const ruleBreakdown: Record<string, number> = {};
    const parsedFindings: GitLeaksFinding[] = [];

    for (const raw of rawFindings) {
      const ruleId = String(raw['RuleID'] ?? raw['ruleId'] ?? 'unknown');
      ruleBreakdown[ruleId] = (ruleBreakdown[ruleId] ?? 0) + 1;

      const secret = String(raw['Secret'] ?? raw['secret'] ?? '');
      const finding: GitLeaksFinding = {
        fingerprint: String(raw['Fingerprint'] ?? raw['fingerprint'] ?? randomUUID()),
        ruleId,
        description: String(raw['Description'] ?? raw['description'] ?? ruleId),
        file: String(raw['File'] ?? raw['file'] ?? ''),
        startLine: Number(raw['StartLine'] ?? raw['startLine'] ?? 0),
        endLine: Number(raw['EndLine'] ?? raw['endLine'] ?? 0),
        secretPreview: secret.substring(0, 4),
        match: String(raw['Match'] ?? raw['match'] ?? ''),
        commit: String(raw['Commit'] ?? raw['commit'] ?? ''),
        author: String(raw['Author'] ?? raw['author'] ?? ''),
        email: String(raw['Email'] ?? raw['email'] ?? ''),
        date: String(raw['Date'] ?? raw['date'] ?? ''),
        tags: Array.isArray(raw['Tags']) ? raw['Tags'] as string[] : [],
      };
      parsedFindings.push(finding);
    }

    const report: GitLeaksReport = {
      reportId,
      repoFullName: repoFullName.trim(),
      uploadedBy: identity.username,
      uploadedAt: now,
      findingCount: parsedFindings.length,
      ruleBreakdown,
    };

    await repo.saveGitLeaksReport(report);
    for (const finding of parsedFindings) {
      await repo.saveGitLeaksFinding(reportId, finding);
    }

    res.status(201).json(report);
  });

  // DELETE /security/gitleaks/:reportId — DevOps only
  router.delete('/gitleaks/:reportId', devopsOnly(repo), async (req, res) => {
    const result = await repo.deleteGitLeaksReport(req.params['reportId'] as string);
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Internal error', result.error.message)); return; }
    res.status(204).send();
  });

  return router;
}
