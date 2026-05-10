import type { Result, DomainError } from '@wep/domain-types';
import { success, failure, domainError } from '@wep/domain-types';
import type { SecurityRepository } from '../../domain/ports/security-repository.js';
import type { VulnPackage } from '../../domain/entities/vuln-package.js';
import { queryOsvVulnerabilities } from '../../infrastructure/clients/osv-client.js';
import { getExploitedCveIds } from '../../infrastructure/clients/kev-client.js';

interface PackageRef {
  name: string;
  version: string;
  source: string;         // repo fullName or 'radar'
  depth: 'direct' | 'transitive';
  /** Chain from immediate parent up to project root. Empty for direct deps. */
  dependencyPath: string[];
}

/** Fetch raw file content from a GitHub repo */
async function fetchGitHubFile(
  owner: string,
  repo: string,
  path: string,
  githubToken: string,
): Promise<unknown | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github.v3.raw' },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path}: ${await response.text()}`);
  return response.json();
}

/**
 * Parse package-lock.json (v2/v3 lockfileVersion) and return all packages with
 * depth classification (direct vs transitive) and the dependency path.
 *
 * Lock file v2/v3 structure:
 *   packages: {
 *     "": { dependencies, devDependencies }   <- root
 *     "node_modules/express": { version, dependencies? }
 *     "node_modules/express/node_modules/qs": { version }  <- nested
 *   }
 */
function parseLockFile(
  lockFile: {
    lockfileVersion?: number;
    packages?: Record<string, { version?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; dev?: boolean }>;
    dependencies?: Record<string, { version: string; dependencies?: Record<string, unknown> }>;
  },
  source: string,
): PackageRef[] {
  const results: PackageRef[] = [];

  // ── v2 / v3 format (packages map) ──────────────────────────────────────────
  if (lockFile.packages) {
    const root = lockFile.packages[''] ?? {};
    const directNames = new Set([
      ...Object.keys(root.dependencies ?? {}),
      ...Object.keys(root.devDependencies ?? {}),
    ]);

    // Build parent map: pkgKey -> immediate parent pkgKey
    // Key format: "node_modules/a/node_modules/b" — parent is "node_modules/a"
    for (const [key, entry] of Object.entries(lockFile.packages)) {
      if (!key) continue; // skip root
      if (!entry.version) continue; // workspace symlinks have no version

      // Extract package name from key: "node_modules/@scope/name" -> "@scope/name"
      const nmPrefix = 'node_modules/';
      const lastNm = key.lastIndexOf(nmPrefix);
      const pkgName = lastNm === -1 ? key : key.slice(lastNm + nmPrefix.length);

      const isDirect = directNames.has(pkgName);

      // Build dependency path: split the key on "/node_modules/" to get ancestor chain
      let dependencyPath: string[] = [];
      if (!isDirect) {
        const segments = key.split('/node_modules/').slice(1, -1); // ancestors, not self
        // Reverse so path reads: immediate parent first
        dependencyPath = segments.reverse();
      }

      results.push({
        name: pkgName,
        version: entry.version,
        source,
        depth: isDirect ? 'direct' : 'transitive',
        dependencyPath,
      });
    }
    return results;
  }

  // ── v1 format (dependencies map, recursive) ────────────────────────────────
  if (lockFile.dependencies) {
    function walkV1(
      deps: Record<string, { version: string; dependencies?: Record<string, unknown> }>,
      path: string[],
      isDirectLevel: boolean,
    ) {
      for (const [name, entry] of Object.entries(deps)) {
        results.push({
          name,
          version: entry.version,
          source,
          depth: isDirectLevel ? 'direct' : 'transitive',
          dependencyPath: isDirectLevel ? [] : [...path].reverse(),
        });
        if (entry.dependencies) {
          walkV1(
            entry.dependencies as Record<string, { version: string; dependencies?: Record<string, unknown> }>,
            [name, ...path],
            false,
          );
        }
      }
    }
    walkV1(lockFile.dependencies, [], true);
    return results;
  }

  return results;
}

/** Fetch and parse packages from a repo's package-lock.json (falls back to package.json) */
async function fetchRepoPackages(
  owner: string,
  name: string,
  githubToken: string,
): Promise<PackageRef[]> {
  const fullName = `${owner}/${name}`;

  // Try package-lock.json first (gives full dependency tree with depth info)
  const lockFile = await fetchGitHubFile(owner, name, 'package-lock.json', githubToken) as {
    lockfileVersion?: number;
    packages?: Record<string, { version?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>;
    dependencies?: Record<string, { version: string; dependencies?: Record<string, unknown> }>;
  } | null;

  if (lockFile) {
    const packages = parseLockFile(lockFile, fullName);
    console.log(`[scan-packages] ${fullName}: parsed lock file — ${packages.filter(p => p.depth === 'direct').length} direct, ${packages.filter(p => p.depth === 'transitive').length} transitive`);
    return packages;
  }

  // Fallback: package.json only (all treated as direct, no transitive visibility)
  console.warn(`[scan-packages] ${fullName}: no package-lock.json found, falling back to package.json`);
  const packageJson = await fetchGitHubFile(owner, name, 'package.json', githubToken) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } | null;

  if (!packageJson) return [];

  const all: PackageRef[] = [];
  for (const [pkgName, version] of Object.entries(packageJson.dependencies ?? {})) {
    all.push({ name: pkgName, version: version.replace(/^[\^~>=<*]/, ''), source: fullName, depth: 'direct', dependencyPath: [] });
  }
  for (const [pkgName, version] of Object.entries(packageJson.devDependencies ?? {})) {
    all.push({ name: pkgName, version: version.replace(/^[\^~>=<*]/, ''), source: fullName, depth: 'direct', dependencyPath: [] });
  }
  return all;
}

export class ScanPackagesHandler {
  constructor(private readonly repo: SecurityRepository) {}

  async execute(repoFullName: string | 'radar'): Promise<Result<{ packageCount: number; cveCount: number }, DomainError>> {
    const githubToken = process.env['GITHUB_TOKEN'];
    if (!githubToken && repoFullName !== 'radar') {
      return failure(domainError('CONFIG_ERROR', 'GITHUB_TOKEN environment variable is not set'));
    }

    let packages: PackageRef[] = [];

    if (repoFullName === 'radar') {
      // Pull packages from the tech-radar DynamoDB table
      // We don't have a direct dependency on the tech-radar router here — instead
      // the routes layer passes radar packages in as input.
      return failure(domainError('NOT_SUPPORTED', 'Use scanRadarPackages() for radar source'));
    }

    // Update repo status to scanning
    const repoResult = await this.repo.getMonitoredRepo(repoFullName);
    if (!repoResult.ok) return failure(repoResult.error);
    if (!repoResult.value) return failure(domainError('NOT_FOUND', `Repo ${repoFullName} is not monitored`));

    const repoRecord = repoResult.value;
    await this.repo.saveMonitoredRepo({ ...repoRecord, lastScanStatus: 'scanning' });

    try {
      const [owner, name] = repoFullName.split('/') as [string, string];
      packages = await fetchRepoPackages(owner, name, githubToken!);
    } catch (e) {
      await this.repo.saveMonitoredRepo({
        ...repoRecord,
        lastScanStatus: 'failed',
        lastScanError: (e as Error).message,
        lastScannedAt: new Date().toISOString(),
      });
      return failure(domainError('SCAN_FAILED', (e as Error).message));
    }

    const result = await this._processPackages(packages, repoFullName);

    await this.repo.saveMonitoredRepo({
      ...repoRecord,
      lastScanStatus: 'done',
      lastScanError: null,
      lastScannedAt: new Date().toISOString(),
      packageCount: packages.length,
    });

    return result;
  }

  async executeForPackages(
    packages: PackageRef[],
    source: string,
  ): Promise<Result<{ packageCount: number; cveCount: number }, DomainError>> {
    return this._processPackages(packages, source);
  }

  private async _processPackages(
    packages: PackageRef[],
    source: string,
  ): Promise<Result<{ packageCount: number; cveCount: number }, DomainError>> {
    // Deduplicate by name — prefer direct over transitive when the same package
    // appears at multiple depths (e.g. listed directly AND pulled transitively)
    const seen = new Map<string, PackageRef>();
    for (const p of packages) {
      const existing = seen.get(p.name);
      if (!existing || (existing.depth === 'transitive' && p.depth === 'direct')) {
        seen.set(p.name, p);
      }
    }
    const unique = Array.from(seen.values());

    const kevSet = await getExploitedCveIds();
    let totalCves = 0;

    for (const pkg of unique) {
      try {
        let cves = await queryOsvVulnerabilities(pkg.name, 'npm');

        // Enrich with KEV data
        cves = cves.map((cve) => ({
          ...cve,
          isKevExploited: cve.aliases.some((a) => kevSet.has(a)) || kevSet.has(cve.cveId),
        }));

        // Clear old CVEs and re-save
        await this.repo.deleteAllCveEntries('npm', pkg.name);
        for (const cve of cves) {
          await this.repo.saveCveEntry('npm', pkg.name, cve);
        }

        // Update or create the VulnPackage summary
        const existingResult = await this.repo.getVulnPackage('npm', pkg.name);
        const existing = existingResult.ok ? existingResult.value : null;

        const sources = Array.from(new Set([...(existing?.sources ?? []), source]));
        const versions = Array.from(new Set([...(existing?.versions ?? []), pkg.version]));

        // When the same package appears in multiple repos, keep 'direct' if any
        // source marks it as direct; only flip to transitive if all sources do.
        const resolvedDepth: 'direct' | 'transitive' =
          pkg.depth === 'direct' || existing?.depth === 'direct' ? 'direct' : 'transitive';
        const resolvedPath =
          resolvedDepth === 'direct' ? [] : (existing?.dependencyPath ?? pkg.dependencyPath);

        const summary: VulnPackage = {
          ecosystem: 'npm',
          name: pkg.name,
          sources,
          versions,
          totalCves: cves.length,
          criticalCount: cves.filter((c) => c.severity === 'CRITICAL').length,
          highCount: cves.filter((c) => c.severity === 'HIGH').length,
          mediumCount: cves.filter((c) => c.severity === 'MEDIUM').length,
          lowCount: cves.filter((c) => c.severity === 'LOW').length,
          exploitedCount: cves.filter((c) => c.isKevExploited).length,
          lastCheckedAt: new Date().toISOString(),
          depth: resolvedDepth,
          dependencyPath: resolvedPath,
        };

        await this.repo.saveVulnPackage(summary);
        totalCves += cves.length;
      } catch (e) {
        // Log but don't fail the whole scan for one package
        console.warn(`[scan-packages] Failed to fetch CVEs for ${pkg.name}:`, (e as Error).message);
      }
    }

    // Remove this source from any packages no longer in the scan result
    // (handles the case where a dependency was removed)
    const allPkgsResult = await this.repo.listVulnPackages();
    if (allPkgsResult.ok) {
      const currentNames = new Set(unique.map((p) => p.name));
      for (const existing of allPkgsResult.value) {
        if (existing.sources.includes(source) && !currentNames.has(existing.name)) {
          const updatedSources = existing.sources.filter((s) => s !== source);
          if (updatedSources.length === 0) {
            // No more sources referencing this package — remove it
            await this.repo.deleteAllCveEntries('npm', existing.name);
            // We don't have a deleteVulnPackage, so just zero out counts
            await this.repo.saveVulnPackage({ ...existing, sources: [], totalCves: 0, criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0, exploitedCount: 0 });
          } else {
            await this.repo.saveVulnPackage({ ...existing, sources: updatedSources });
          }
        }
      }
    }

    return success({ packageCount: unique.length, cveCount: totalCves });
  }
}
