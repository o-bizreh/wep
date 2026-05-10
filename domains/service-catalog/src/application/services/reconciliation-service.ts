import { randomUUID } from 'node:crypto';
import {
  type Result,
  success,
  failure,
  domainError,
  CatalogErrorCode,
  EventSource,
  type DomainError,
  Domain,
} from '@wep/domain-types';
import { createService, generateServiceId, type Service, type AWSResource } from '../../domain/entities/service.js';
import { createTeam, generateTeamId } from '../../domain/entities/team.js';
import type { ServiceRepository } from '../../domain/ports/service-repository.js';
import type { TeamRepository } from '../../domain/ports/team-repository.js';
import type { GitHubCrawler } from '../../domain/ports/github-crawler.js';
import type { AWSScanner, DiscoveredAWSResource } from '../../domain/ports/aws-scanner.js';
import type { EventPublisher } from '@wep/event-bus';
import { GitHubClient } from '@wep/github-client';

// ── Types ────────────────────────────────────────────────────────────────────

type RuntimeType = 'ecs' | 'lambda' | 'npm-package' | 'cli-tool' | 'unknown';

// Hard-coded internal classification rules. Keep these explicit and short —
// they exist because the repos in question don't fit the .github/*-config
// detection but engineers need them to display correctly in the catalog.
const NPM_PACKAGE_NAME_PREFIXES = ['sails-hook'];
const CLI_TOOL_NAMES = new Set(['washmen-code-guard']);

export type SyncPhase =
  | 'idle'
  | 'fetching-repos'
  | 'aws-enrichment'
  | 'done'
  | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  /** Repos written to DynamoDB so far */
  reposSaved: number;
  /** Repos skipped (archived, sails-*, etc.) */
  reposSkipped: number;
  /** Services enriched with AWS health */
  awsEnriched: number;
  /** Total active services to enrich (set when AWS phase starts) */
  awsTotal: number;
  /** Human-readable message for the UI */
  message: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

// ── Module-level owner-topic parsing ─────────────────────────────────────────

// Maps a segment anywhere in the topic slug to a domain.
// We check every dash-separated part, not just the last one.
const DOMAIN_SEGMENT_MAP: Record<string, Domain> = {
  domain:   Domain.DEVOPS,
  customer: Domain.CUSTOMER,
  payment:  Domain.PAYMENT,
  payments: Domain.PAYMENT,
  data:     Domain.DATA,
  devops:   Domain.DEVOPS,
  platform: Domain.DEVOPS,
  facility: Domain.DEVOPS,
  driver:   Domain.DEVOPS,
  billing:  Domain.DEVOPS,
  ops:      Domain.DEVOPS,
  leads:    Domain.DEVOPS,
};

function parseOwnerTopic(topics: string[]): { teamName: string; domain: Domain } | null {
  for (const topic of topics) {
    if (!topic.includes('-')) continue;
    // The full topic slug IS the GitHub team slug (e.g. "facility-domain", "billing-customer").
    // teamName = the full slug so generateTeamId produces team_<slug> which matches reconcileTeams.
    const parts = topic.toLowerCase().split('-');
    const domain = parts.reduce<Domain | null>((found, part) => {
      return found ?? (DOMAIN_SEGMENT_MAP[part] ?? null);
    }, null) ?? Domain.DEVOPS;
    return { teamName: topic, domain };
  }
  return null;
}

// ── Runtime detection ─────────────────────────────────────────────────────────

function detectRuntimeFromName(repoName: string): RuntimeType | null {
  const lower = repoName.toLowerCase();
  if (CLI_TOOL_NAMES.has(lower)) return 'cli-tool';
  if (NPM_PACKAGE_NAME_PREFIXES.some((prefix) => lower.startsWith(prefix))) return 'npm-package';
  if (lower.includes('aws-lambda') || lower.startsWith('lambda-')) return 'lambda';
  return null;
}

async function detectRuntimeFromFiles(
  client: GitHubClient,
  org: string,
  repoName: string,
): Promise<RuntimeType> {
  const [ecsResult, lambdaResult] = await Promise.all([
    client.getFileContent(org, repoName, '.github/ecs-config.yml'),
    client.getFileContent(org, repoName, '.github/lambda-config.yml'),
  ]);
  if (ecsResult.ok && ecsResult.value) return 'ecs';
  if (lambdaResult.ok && lambdaResult.value) return 'lambda';
  return 'unknown';
}

async function detectRuntime(
  client: GitHubClient,
  org: string,
  repoName: string,
): Promise<RuntimeType> {
  const fromName = detectRuntimeFromName(repoName);
  if (fromName) return fromName;
  return detectRuntimeFromFiles(client, org, repoName);
}

// ── Health helpers ────────────────────────────────────────────────────────────

function ecsHealth(svc: DiscoveredAWSResource): 'healthy' | 'degraded' | 'unknown' {
  if (svc.status !== 'ACTIVE') return 'degraded';
  if ((svc.desiredCount ?? 0) === 0) return 'degraded';
  if ((svc.runningCount ?? 0) >= (svc.desiredCount ?? 1)) return 'healthy';
  return 'degraded';
}

function lambdaHealth(state: string): 'healthy' | 'degraded' | 'unknown' {
  if (state === 'Active') return 'healthy';
  if (state === 'Inactive' || state === 'Failed') return 'degraded';
  return 'unknown';
}

// ── Concurrency helper ────────────────────────────────────────────────────────

/**
 * Runs `fn` over `items` with at most `concurrency` in-flight at once.
 * Unlike Promise.all, this doesn't launch every promise immediately —
 * it maintains a rolling window of `concurrency` concurrent calls.
 */
async function batchedMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]!, i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ── Stale detection state (module-level — survives re-runs) ──────────────────

const staleCounters = new Map<string, number>();
const STALE_THRESHOLD = 3;

// ── Service ───────────────────────────────────────────────────────────────────

export class ReconciliationService {
  private status: SyncStatus = {
    phase: 'idle',
    reposSaved: 0,
    reposSkipped: 0,
    awsEnriched: 0,
    awsTotal: 0,
    message: 'No sync has run yet',
    startedAt: null,
    finishedAt: null,
    error: null,
  };

  constructor(
    private readonly serviceRepo: ServiceRepository,
    private readonly teamRepo: TeamRepository,
    private readonly githubCrawler: GitHubCrawler,
    private readonly awsScanner: AWSScanner,
    private readonly eventPublisher: EventPublisher,
  ) {}

  getStatus(): SyncStatus {
    return { ...this.status };
  }

  // ── Public entry point ──────────────────────────────────────────────────────

  /**
   * Full sync:
   *  Phase 1 — stream repos from GitHub in pages of 50, detect runtimes
   *            50-in-parallel per page, write to DynamoDB immediately.
   *  Phase 2 — batch AWS health enrichment (50 concurrent Lambda probes).
   *
   * Returns after Phase 1. Phase 2 runs in the background.
   */
  async reconcile(org: string): Promise<Result<void, DomainError<CatalogErrorCode>>> {
    if (this.status.phase !== 'idle' && this.status.phase !== 'done' && this.status.phase !== 'error') {
      return failure(domainError(CatalogErrorCode.SYNC_FAILED, 'A sync is already in progress'));
    }

    this.status = {
      phase: 'fetching-repos',
      reposSaved: 0,
      reposSkipped: 0,
      awsEnriched: 0,
      awsTotal: 0,
      message: 'Connecting to GitHub…',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
    };

    console.log(`[reconcile] Starting sync for org "${org}"`);

    // Phase 1 — repos
    const phase1 = await this.reconcileReposStreaming(org);
    if (!phase1.ok) {
      this.status.phase = 'error';
      this.status.error = phase1.error.message;
      this.status.finishedAt = new Date().toISOString();
      console.error(`[reconcile] Phase 1 failed: ${phase1.error.message}`);
      return phase1;
    }

    console.log(
      `[reconcile] Phase 1 done — saved: ${this.status.reposSaved}, skipped: ${this.status.reposSkipped}. Starting AWS enrichment…`,
    );

    // Phase 2 — AWS (non-blocking)
    this.status.phase = 'aws-enrichment';
    this.status.message = 'Enriching services with AWS health…';

    this.enrichWithAWS(org).catch((err) => {
      console.error(`[reconcile] AWS enrichment error: ${err instanceof Error ? err.message : String(err)}`);
      this.status.phase = 'error';
      this.status.error = err instanceof Error ? err.message : String(err);
      this.status.finishedAt = new Date().toISOString();
    });

    return success(undefined);
  }

  // ── Phase 1: stream repos ──────────────────────────────────────────────────

  private async reconcileReposStreaming(
    org: string,
  ): Promise<Result<void, DomainError<CatalogErrorCode>>> {
    const client = new GitHubClient();
    const discoveredIds = new Set<string>();

    // Fetch teams first (typically < 20, fine to do all at once)
    await this.reconcileTeams(client, org);

    // Build a repo-name → team-slug map as a fallback for repos that lack GitHub topics.
    // We fetch repos for every team and invert the mapping.
    const repoTeamMap = await this.buildRepoTeamMap(client, org);
    console.log(`[phase1] Built repo→team map: ${repoTeamMap.size} entries`);

    let pageNumber = 0;

    try {
      for await (const page of client.listOrgReposPages(org, 50)) {
        pageNumber++;
        this.status.message = `Fetching repos from GitHub… (page ${pageNumber}, ${this.status.reposSaved} saved so far)`;

        const active = page.filter((r) => !r.archived && !r.name.startsWith('sails-'));
        this.status.reposSkipped += page.length - active.length;

        if (active.length === 0) continue;

        // Detect runtimes for the whole page in parallel (50 concurrent GitHub calls)
        const runtimes = await batchedMap(active, 50, (repo) =>
          detectRuntime(client, org, repo.name),
        );

        // Write to DynamoDB in parallel (50 concurrent reads + writes)
        await batchedMap(active, 50, async (repo, i) => {
          const runtime = runtimes[i]!;
          // ID generation collapses to legacy 'lambda'|'ecs' so existing
          // service records keep their IDs even after we start detecting
          // 'npm-package' / 'cli-tool'. The stored runtimeType (below) uses
          // the actual detected value.
          const serviceId = generateServiceId(repo.htmlUrl, runtime === 'lambda' ? 'lambda' : 'ecs');
          // Stored runtime: actual detection. 'unknown' falls back to 'ecs'
          // (the legacy default) so existing rows aren't disrupted.
          const storedRuntime: 'ecs' | 'lambda' | 'npm-package' | 'cli-tool' =
            runtime === 'unknown' ? 'ecs' : runtime;
          discoveredIds.add(serviceId);
          staleCounters.delete(serviceId);

          const owner = parseOwnerTopic(repo.topics);
          const teamSlugFromMap = repoTeamMap.get(repo.name);
          const ownerTeamId = owner
            ? generateTeamId(owner.teamName)
            : teamSlugFromMap
              ? generateTeamId(teamSlugFromMap)
              : 'team_unassigned';
          const ownerTeamName = owner?.teamName ?? teamSlugFromMap ?? 'Unassigned';

          const existingResult = await this.serviceRepo.findById(serviceId);
          if (!existingResult.ok) return;

          if (!existingResult.value) {
            // New service
            const serviceResult = createService({
              serviceName: repo.name,
              repositoryUrl: repo.htmlUrl,
              runtimeType: storedRuntime,
              ownerTeam: {
                teamId: ownerTeamId,
                teamName: ownerTeamName,
                domain: owner?.domain ?? Domain.DEVOPS,
                memberCount: 0,
                slackChannelId: '',
              },
              discoveryMethod: 'automated',
              metadata: {
                language: repo.language ?? 'unknown',
                topics: repo.topics.join(','),
              },
            });
            if (!serviceResult.ok) return;

            const saveResult = await this.serviceRepo.save(serviceResult.value);
            if (!saveResult.ok) {
              console.error(`[phase1] Failed to save ${repo.name}: ${saveResult.error.message}`);
              return;
            }

            this.status.reposSaved++;
            this.status.message = `Fetching repos… (${this.status.reposSaved} saved)`;
            console.log(`[phase1] Saved: ${repo.name} (${runtime}, owner: ${ownerTeamName})`);

            await this.eventPublisher.publish(EventSource.SERVICE_CATALOG, 'service.registered', {
              eventId: randomUUID(),
              entityId: serviceResult.value.serviceId,
              entityType: 'service',
              timestamp: new Date().toISOString(),
              version: 1,
              data: {
                service: {
                  serviceId: serviceResult.value.serviceId,
                  serviceName: serviceResult.value.serviceName,
                  repositoryUrl: serviceResult.value.repositoryUrl,
                  ownerTeamId,
                  ownerTeamName,
                  runtimeType: serviceResult.value.runtimeType,
                },
                discoveryMethod: 'automated',
                initialHealthStatus: 'unknown',
              },
            });
          } else {
            // Existing service — refresh owner/domain/runtimeType if changed
            const existing = existingResult.value;
            const ownerChanged =
              existing.ownerTeam.teamId !== ownerTeamId ||
              existing.ownerTeam.teamName !== ownerTeamName ||
              (owner?.domain && existing.ownerTeam.domain !== owner.domain);
            const runtimeChanged = existing.runtimeType !== storedRuntime;
            if (ownerChanged || runtimeChanged) {
              await this.serviceRepo.save({
                ...existing,
                runtimeType: storedRuntime,
                ownerTeam: {
                  ...existing.ownerTeam,
                  teamId: ownerTeamId,
                  teamName: ownerTeamName,
                  domain: owner?.domain ?? existing.ownerTeam.domain,
                },
              });
            }
            // Count existing as "saved" so the UI count is accurate
            this.status.reposSaved++;
          }
        });
      }
    } catch (err) {
      return failure(domainError(
        CatalogErrorCode.SYNC_FAILED,
        `Repo streaming failed: ${err instanceof Error ? err.message : String(err)}`,
      ));
    }

    // Stale detection
    const allResult = await this.serviceRepo.findAll({ limit: 1000 });
    if (allResult.ok) {
      for (const svc of allResult.value.items) {
        if (!discoveredIds.has(svc.serviceId) && svc.isActive) {
          const count = (staleCounters.get(svc.serviceId) ?? 0) + 1;
          staleCounters.set(svc.serviceId, count);
          if (count >= STALE_THRESHOLD) {
            await this.serviceRepo.save({ ...svc, isActive: false });
            staleCounters.delete(svc.serviceId);
          }
        }
      }
    }

    return success(undefined);
  }

  private async reconcileTeams(client: GitHubClient, org: string): Promise<void> {
    const teamsResult = await client.listOrgTeams(org);
    if (!teamsResult.ok) {
      console.warn(`[phase1] Could not fetch teams: ${teamsResult.error.message}`);
      return;
    }

    // Team member fetching: 10 concurrent (teams are few, no need for 50)
    await batchedMap(teamsResult.value, 10, async (team) => {
      if (client.getRateLimitRemaining() < 100) return;
      const teamId = generateTeamId(team.slug);
      const existingResult = await this.teamRepo.findById(teamId);
      if (!existingResult.ok || existingResult.value) return;

      const membersResult = await client.getTeamMembers(org, team.slug);
      const teamResult = createTeam({
        teamName: team.name,
        domain: Domain.DEVOPS,
        githubTeamSlug: team.slug,
        slackChannelId: '',
        members: membersResult.ok
          ? membersResult.value.map((m) => ({
              userId: m.login,
              role: m.role === 'maintainer' ? ('lead' as const) : ('member' as const),
            }))
          : [],
      });
      if (teamResult.ok) await this.teamRepo.save(teamResult.value);
    });
  }

  /**
   * Builds a Map<repoName, teamSlug> by fetching repos for every team.
   * Used as a fallback when repos don't have GitHub topics set.
   * If a repo belongs to multiple teams, the last write wins (typically just one).
   */
  private async buildRepoTeamMap(client: GitHubClient, org: string): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const teamsResult = await client.listOrgTeams(org);
    if (!teamsResult.ok) {
      console.warn(`[buildRepoTeamMap] Could not fetch teams: ${teamsResult.error.message}`);
      return map;
    }

    await batchedMap(teamsResult.value, 5, async (team) => {
      if (client.getRateLimitRemaining() < 50) return;
      const reposResult = await client.getTeamRepos(org, team.slug);
      if (!reposResult.ok) return;
      for (const repoName of reposResult.value) {
        map.set(repoName, team.slug);
      }
    });

    return map;
  }

  // ── Phase 2: AWS enrichment ────────────────────────────────────────────────

  private async enrichWithAWS(org: string): Promise<void> {
    const region = process.env['AWS_REGION'] ?? 'me-south-1';
    const accountId = process.env['AWS_ACCOUNT_ID'] ?? '';

    console.log(`[phase2] Scanning ECS clusters…`);
    const ecsScanResult = await this.awsScanner.scanECSServices();
    const ecsResources = ecsScanResult.ok ? ecsScanResult.value : [];
    if (!ecsScanResult.ok) {
      console.warn(`[phase2] ECS scan failed: ${ecsScanResult.error.message}`);
    }

    const ecsDevMap = new Map<string, DiscoveredAWSResource>();
    const ecsProdMap = new Map<string, DiscoveredAWSResource>();
    for (const r of ecsResources) {
      const env = r.tags['wep:environment'];
      if (env === 'dev') ecsDevMap.set(r.name.toLowerCase(), r);
      else if (env === 'prod') ecsProdMap.set(r.name.toLowerCase(), r);
    }
    console.log(`[phase2] ECS — dev: ${ecsDevMap.size}, prod: ${ecsProdMap.size}`);

    const allResult = await this.serviceRepo.findAll({ limit: 1000 });
    if (!allResult.ok) return;

    const activeServices = allResult.value.items.filter((s) => s.isActive);
    this.status.awsTotal = activeServices.length;
    this.status.message = `Enriching with AWS health (0 / ${activeServices.length})…`;

    // Process in batches of 50 concurrent Lambda probes / ECS lookups
    await batchedMap(activeServices, 50, async (service) => {
      const repoName = service.serviceName;
      const runtime = service.runtimeType;
      const environments: string[] = [];
      const awsResources: Record<string, AWSResource[]> = {};
      const signals: Array<{ source: string; status: 'healthy' | 'unhealthy'; checkedAt: string }> = [];
      let healthStatus: 'healthy' | 'degraded' | 'unknown' = 'unknown';
      const checkedAt = new Date().toISOString();

      if (runtime === 'lambda') {
        const probe = await this.awsScanner.probeLambda(repoName);
        if (probe.dev) {
          environments.push('development');
          const h = lambdaHealth(probe.dev.state);
          awsResources['development'] = [{
            resourceType: 'LAMBDA',
            identifier: `dev-${repoName}`,
            region,
            arn: `arn:aws:lambda:${region}:${accountId}:function:dev-${repoName}`,
            mappingStatus: 'auto-verified',
          }];
          signals.push({ source: `Lambda · dev-${repoName}`, status: h === 'healthy' ? 'healthy' : 'unhealthy', checkedAt });
          if (h === 'healthy') healthStatus = 'healthy';
          else if (healthStatus === 'unknown') healthStatus = h;
        }
        if (probe.prod) {
          environments.push('production');
          const h = lambdaHealth(probe.prod.state);
          awsResources['production'] = [{
            resourceType: 'LAMBDA',
            identifier: `prod-${repoName}`,
            region,
            arn: `arn:aws:lambda:${region}:${accountId}:function:prod-${repoName}`,
            mappingStatus: 'auto-verified',
          }];
          signals.push({ source: `Lambda · prod-${repoName}`, status: h === 'healthy' ? 'healthy' : 'unhealthy', checkedAt });
          if (h === 'healthy' || healthStatus !== 'healthy') healthStatus = h;
        }
      } else if (runtime === 'ecs') {
        const devSvc = ecsDevMap.get(`dev-${repoName}`.toLowerCase());
        const prodSvc = ecsProdMap.get(`prod-${repoName}`.toLowerCase());

        if (devSvc) {
          environments.push('development');
          awsResources['development'] = [{
            resourceType: 'ECS_SERVICE',
            identifier: devSvc.name,
            region,
            clusterName: 'washmen-dev',
            arn: devSvc.arn,
            mappingStatus: 'auto-verified',
          }];
          const h = ecsHealth(devSvc);
          signals.push({
            source: `ECS · ${devSvc.name} (washmen-dev)`,
            status: h === 'healthy' ? 'healthy' : 'unhealthy',
            checkedAt,
          });
          if (h === 'healthy') healthStatus = 'healthy';
          else if (healthStatus === 'unknown') healthStatus = h;
        }
        if (prodSvc) {
          environments.push('production');
          awsResources['production'] = [{
            resourceType: 'ECS_SERVICE',
            identifier: prodSvc.name,
            region,
            clusterName: 'washmen-prod',
            arn: prodSvc.arn,
            mappingStatus: 'auto-verified',
          }];
          const h = ecsHealth(prodSvc);
          signals.push({
            source: `ECS · ${prodSvc.name} (washmen-prod)`,
            status: h === 'healthy' ? 'healthy' : 'unhealthy',
            checkedAt,
          });
          if (h === 'healthy' || healthStatus !== 'healthy') healthStatus = h;
        }
      }

      await this.serviceRepo.save({
        ...service,
        environments: environments as Service['environments'],
        awsResources,
        healthStatus: { status: healthStatus, signals },
        awsEnriched: true,
      });

      this.status.awsEnriched++;
      this.status.message = `Enriching with AWS health (${this.status.awsEnriched} / ${this.status.awsTotal})…`;
    });

    this.status.phase = 'done';
    this.status.finishedAt = new Date().toISOString();
    this.status.message = `Sync complete — ${this.status.reposSaved} repos, ${this.status.awsEnriched} enriched`;
    console.log(`[phase2] AWS enrichment complete — ${this.status.awsEnriched} services updated`);
  }
}
