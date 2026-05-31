import { randomUUID } from 'crypto';
import { GitHubClient } from '@wep/github-client';
import type { NpmAuditRepository } from '../../infrastructure/dynamodb/npm-audit-repository.js';
import type {
  ScanRun,
  RepoScanResult,
  VulnerableDep,
  Advisory,
  Severity,
} from '../../domain/entities/audit-types.js';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface GitHubAdvisory {
  ghsa_id: string;
  cve_id: string | null;
  summary: string;
  severity: string;
  published_at: string;
  updated_at: string;
  references: string[];
  cvss: { score: number } | null;
  vulnerabilities: Array<{
    package: { ecosystem: string; name: string };
    vulnerable_version_range: string | null;
    first_patched_version: string | null;
  }>;
}

// In-memory status for the current run — survives only in this process lifecycle
let currentRun: ScanRun | null = null;

export function getScanStatus(): ScanRun | null {
  return currentRun;
}

async function fetchAdvisories(packageNames: string[]): Promise<Map<string, GitHubAdvisory[]>> {
  const map = new Map<string, GitHubAdvisory[]>();
  if (packageNames.length === 0) return map;

  // GitHub Advisory DB API — public, no auth needed beyond basic token
  // Batch by 20 packages per request to stay within URL length limits
  const batchSize = 20;
  for (let i = 0; i < packageNames.length; i += batchSize) {
    const batch = packageNames.slice(i, i + batchSize);
    const params = new URLSearchParams();
    params.set('ecosystem', 'npm');
    params.set('per_page', '100');
    for (const pkg of batch) params.append('affects', pkg);

    try {
      const res = await fetch(`https://api.github.com/advisories?${params}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(process.env['GITHUB_TOKEN'] ? { Authorization: `Bearer ${process.env['GITHUB_TOKEN']}` } : {}),
        },
      });
      if (!res.ok) continue;
      const advisories = await res.json() as GitHubAdvisory[];
      for (const adv of advisories) {
        for (const vuln of adv.vulnerabilities) {
          if (vuln.package.ecosystem !== 'npm') continue;
          const name = vuln.package.name;
          if (!map.has(name)) map.set(name, []);
          map.get(name)!.push(adv);
        }
      }
    } catch { /* network error — skip batch */ }
  }
  return map;
}

function semverSatisfies(version: string, range: string | null): boolean {
  if (!range) return true; // no range = all versions affected
  // Simple check: if version matches "< x.y.z" style ranges
  // We do basic comparison — good enough for advisory lookup
  const ltMatch = /^< ?(\d+\.\d+\.\d+)/.exec(range);
  const gteMatch = />= ?(\d+\.\d+\.\d+)/.exec(range);

  const parse = (v: string) => v.split('.').map(Number);
  const compare = (a: number[], b: number[]): number => {
    for (let i = 0; i < 3; i++) {
      const diff = (a[i] ?? 0) - (b[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  };

  try {
    const ver = parse(version.replace(/^[^0-9]/, ''));
    if (ltMatch) {
      const upper = parse(ltMatch[1]!);
      if (compare(ver, upper) >= 0) return false;
    }
    if (gteMatch) {
      const lower = parse(gteMatch[1]!);
      if (compare(ver, lower) < 0) return false;
    }
    return true;
  } catch { return true; }
}

function normalizeSeverity(s: string): Severity {
  const map: Record<string, Severity> = {
    critical: 'critical', high: 'high', moderate: 'moderate',
    medium: 'moderate', low: 'low', info: 'info',
  };
  return map[s.toLowerCase()] ?? 'info';
}

function stripVersion(v: string): string {
  return v.replace(/^[\^~>=<]/, '').trim();
}

async function scanRepo(
  github: GitHubClient,
  owner: string,
  repoName: string,
  pushedAt: string,
  advisoryMap: Map<string, GitHubAdvisory[]>,
): Promise<RepoScanResult> {
  const base: RepoScanResult = {
    repoFullName: `${owner}/${repoName}`,
    scannedAt: new Date().toISOString(),
    pushedAt,
    deps: [],
    totalVulns: 0,
    critical: 0,
    high: 0,
    moderate: 0,
    low: 0,
    error: null,
  };

  // Fetch package.json
  const fileResult = await github.getFileContent(owner, repoName, 'package.json');
  if (!fileResult.ok || !fileResult.value) {
    return { ...base, error: fileResult.ok ? 'No package.json found' : fileResult.error.message };
  }

  let pkg: PackageJson;
  try {
    pkg = JSON.parse(fileResult.value) as PackageJson;
  } catch {
    return { ...base, error: 'Invalid package.json' };
  }

  const allDeps: Array<{ name: string; version: string; isDirect: boolean }> = [
    ...Object.entries(pkg.dependencies ?? {}).map(([name, version]) => ({ name, version, isDirect: true })),
    ...Object.entries(pkg.devDependencies ?? {}).map(([name, version]) => ({ name, version, isDirect: false })),
  ];

  const vulnDeps: VulnerableDep[] = [];

  for (const { name, version, isDirect } of allDeps) {
    const advisories = advisoryMap.get(name);
    if (!advisories?.length) continue;

    const installed = stripVersion(version);
    const matchingAdvs: Advisory[] = [];

    for (const adv of advisories) {
      for (const vuln of adv.vulnerabilities) {
        if (vuln.package.name !== name) continue;
        if (!semverSatisfies(installed, vuln.vulnerable_version_range)) continue;
        matchingAdvs.push({
          ghsaId: adv.ghsa_id,
          cveId: adv.cve_id,
          summary: adv.summary,
          severity: normalizeSeverity(adv.severity),
          publishedAt: adv.published_at,
          updatedAt: adv.updated_at,
          references: adv.references,
          cvssScore: adv.cvss?.score ?? null,
          fixedIn: vuln.first_patched_version ?? null,
        } as Advisory & { fixedIn: string | null });
      }
    }

    if (matchingAdvs.length > 0) {
      vulnDeps.push({ packageName: name, installedVersion: installed, isDirect, advisories: matchingAdvs, fixedIn: (matchingAdvs[0] as any).fixedIn ?? null });
    }
  }

  const counts = { critical: 0, high: 0, moderate: 0, low: 0 };
  for (const dep of vulnDeps) {
    for (const adv of dep.advisories) {
      if (adv.severity === 'critical') counts.critical++;
      else if (adv.severity === 'high') counts.high++;
      else if (adv.severity === 'moderate') counts.moderate++;
      else counts.low++;
    }
  }

  return {
    ...base,
    deps: vulnDeps,
    totalVulns: vulnDeps.reduce((s, d) => s + d.advisories.length, 0),
    ...counts,
  };
}

async function batchedMap<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export async function runAuditScan(
  org: string,
  repo: NpmAuditRepository,
): Promise<void> {
  if (currentRun?.status === 'scanning') return; // prevent concurrent runs

  const runId = randomUUID();
  const run: ScanRun = {
    runId,
    org,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'scanning',
    reposScanned: 0,
    reposTotal: 0,
    error: null,
  };
  currentRun = run;
  await repo.saveRun(run);

  try {
    const github = new GitHubClient();

    // Step 1 — collect all repos
    const repos: Array<{ owner: string; name: string; pushedAt: string }> = [];
    for await (const page of github.listOrgReposPages(org, 50)) {
      for (const r of page) {
        const [owner] = r.fullName.split('/');
        if (!r.archived && owner) repos.push({ owner, name: r.name, pushedAt: r.pushedAt ?? '' });
      }
    }

    run.reposTotal = repos.length;
    currentRun = { ...run };
    await repo.saveRun({ ...run });

    // Step 2 — fetch all package.json files (20 concurrent)
    const packageContents = await batchedMap(repos, 20, async (r) => {
      const res = await github.getFileContent(r.owner, r.name, 'package.json');
      return { repo: r, content: res.ok ? res.value : null };
    });

    // Step 3 — collect all unique package names across all repos
    const allPackageNames = new Set<string>();
    const parsedPkgs = new Map<string, PackageJson>();
    for (const { repo: r, content } of packageContents) {
      if (!content) continue;
      try {
        const pkg = JSON.parse(content) as PackageJson;
        parsedPkgs.set(`${r.owner}/${r.name}`, pkg);
        Object.keys(pkg.dependencies ?? {}).forEach((n) => allPackageNames.add(n));
        Object.keys(pkg.devDependencies ?? {}).forEach((n) => allPackageNames.add(n));
      } catch { /* invalid json */ }
    }

    // Step 4 — fetch advisories for all unique packages in bulk
    const advisoryMap = await fetchAdvisories([...allPackageNames]);

    // Step 5 — compute vulnerabilities per repo and persist (20 concurrent)
    let scanned = 0;
    await batchedMap(repos, 20, async (r) => {
      const pkg = parsedPkgs.get(`${r.owner}/${r.name}`);
      if (!pkg) {
        // No package.json — store empty result
        await repo.saveRepoResult({
          repoFullName: `${r.owner}/${r.name}`,
          scannedAt: new Date().toISOString(),
          pushedAt: r.pushedAt,
          deps: [],
          totalVulns: 0,
          critical: 0,
          high: 0,
          moderate: 0,
          low: 0,
          error: 'No package.json',
        });
      } else {
        const result = await scanRepo(
          github,
          r.owner,
          r.name,
          r.pushedAt,
          advisoryMap,
        );
        await repo.saveRepoResult(result);
      }
      scanned++;
      run.reposScanned = scanned;
      currentRun = { ...run };
    });

    const finished: ScanRun = { ...run, status: 'done', finishedAt: new Date().toISOString(), reposScanned: scanned };
    currentRun = finished;
    await repo.saveRun(finished);
  } catch (e) {
    const failed: ScanRun = {
      ...run,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: e instanceof Error ? e.message : String(e),
    };
    currentRun = failed;
    await repo.saveRun(failed);
    console.error('[npm-audit] scan failed:', e);
  }
}
