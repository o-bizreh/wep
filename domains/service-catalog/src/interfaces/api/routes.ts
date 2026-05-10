import { Router, type Request, type Response } from 'express';
import { problemDetails, type Domain, type Environment } from '@wep/domain-types';
import {
  ListServicesQuerySchema,
  CreateServiceBodySchema,
  UpdateServiceBodySchema,
  GetDependencyGraphQuerySchema,
  ListTeamsQuerySchema,
} from './schemas.js';
import type { RegisterServiceHandler } from '../../application/commands/register-service.js';
import type { UpdateServiceOwnershipHandler } from '../../application/commands/update-service-ownership.js';
import type { DeregisterServiceHandler } from '../../application/commands/deregister-service.js';
import type { GetServiceHandler } from '../../application/queries/get-service.js';
import type { SearchServicesHandler } from '../../application/queries/search-services.js';
import type { GetDependencyGraphHandler, GetDependentsHandler } from '../../application/queries/get-dependency-graph.js';
import type { GetTeamHandler, ListTeamsHandler } from '../../application/queries/get-team.js';
import type { ResolveAwsMappingHandler } from '../../application/commands/resolve-aws-mapping.js';
import type { ReconciliationService } from '../../application/services/reconciliation-service.js';
import { GitHubClient } from '@wep/github-client';
import {
  ECSClient,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  CloudWatchClient,
  GetMetricDataCommand,
  ElasticLoadBalancingV2Client,
  DescribeTargetGroupsCommand,
  DescribeLoadBalancersCommand,
  LambdaClient,
  GetFunctionCommand,
} from '@wep/aws-clients';
import { credentialStore, STSClient, GetCallerIdentityCommand, createDynamoDBClient, getTableName, PutCommand, GetCommand, CostExplorerClient, GetCostAndUsageCommand } from '@wep/aws-clients';

// ── Branch → environment heuristic ───────────────────────────────────────────

function branchToEnvironment(branch: string | null): string {
  if (!branch) return 'development';
  const b = branch.toLowerCase();
  if (b === 'main' || b === 'master') return 'production';
  return 'development'; // all other branches (feature/, fix/, develop, etc.) deploy to dev
}

export interface CatalogRouteHandlers {
  registerService: RegisterServiceHandler;
  updateOwnership: UpdateServiceOwnershipHandler;
  deregisterService: DeregisterServiceHandler;
  getService: GetServiceHandler;
  searchServices: SearchServicesHandler;
  getDependencyGraph: GetDependencyGraphHandler;
  getDependents: GetDependentsHandler;
  getTeam: GetTeamHandler;
  listTeams: ListTeamsHandler;
  resolveAwsMapping: ResolveAwsMappingHandler;
  reconciliation: ReconciliationService;
}

/**
 * Exhausts all DynamoDB pages for a full-table service scan.
 * searchServices.execute caps results at `pagination.limit` and returns a
 * nextCursor when more rows exist. Callers that need the entire table (stale,
 * promotion, dashboard health) must follow cursors until exhausted.
 */
async function drainAllServices(searchServices: SearchServicesHandler): Promise<import('../../domain/entities/service.js').Service[]> {
  const all: import('../../domain/entities/service.js').Service[] = [];
  let cursor: string | undefined;
  do {
    const result = await searchServices.execute({ pagination: { limit: 500, cursor } });
    if (!result.ok) break;
    all.push(...result.value.items);
    cursor = result.value.nextCursor;
  } while (cursor);
  return all;
}

export function createCatalogRouter(handlers: CatalogRouteHandlers): Router {
  const router = Router();

  router.get('/services', async (req: Request, res: Response) => {
    const parsed = ListServicesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json(problemDetails(400, 'Invalid Query', parsed.error.message));
      return;
    }

    const result = await handlers.searchServices.execute({
      query: parsed.data.query,
      teamId: parsed.data.teamId,
      environment: parsed.data.environment as Environment | undefined,
      pagination: { limit: parsed.data.limit, cursor: parsed.data.cursor },
    });

    if (!result.ok) {
      res.status(500).json(problemDetails(500, 'Search Failed', result.error.message));
      return;
    }

    res.json(result.value);
  });

  // GET /services/stale — all services enriched with staleness info, sorted by daysSinceSync desc
  router.get('/services/stale', async (req: Request, res: Response) => {
    const allItems = await drainAllServices(handlers.searchServices);

    const now = Date.now();
    const services = allItems.map((svc) => {
      const lastSyncedAt = svc.lastSyncedAt ?? new Date(0).toISOString();
      const daysSinceSync = Math.floor((now - new Date(lastSyncedAt).getTime()) / 86_400_000);
      const staleReasons: string[] = [];
      if (daysSinceSync > 30) staleReasons.push(`Not synced in ${daysSinceSync} days`);
      if (svc.environments.length <= 1) staleReasons.push('Single environment only');
      return {
        serviceId: svc.serviceId,
        serviceName: svc.serviceName,
        ownerTeam: svc.ownerTeam,
        runtimeType: svc.runtimeType,
        environments: svc.environments,
        lastSyncedAt,
        daysSinceSync,
        healthStatus: svc.healthStatus.status,
        staleReasons,
      };
    });

    services.sort((a, b) => b.daysSinceSync - a.daysSinceSync);
    res.json({ services });
  });

  // GET /services/promotion — services with ≥2 environments (something to promote)
  router.get('/services/promotion', async (req: Request, res: Response) => {
    const allItems = await drainAllServices(handlers.searchServices);

    const services = allItems
      .filter((svc) => svc.environments.length >= 2)
      .map((svc) => ({
        serviceId: svc.serviceId,
        serviceName: svc.serviceName,
        ownerTeam: svc.ownerTeam,
        runtimeType: svc.runtimeType,
        environments: svc.environments,
        lastSyncedAt: svc.lastSyncedAt ?? new Date(0).toISOString(),
      }));

    res.json({ services });
  });

  router.get('/services/:serviceId', async (req: Request, res: Response) => {
    const result = await handlers.getService.execute(String(req.params['serviceId']));

    if (!result.ok) {
      const status = result.error.code === 'SERVICE_NOT_FOUND' ? 404 : 500;
      res.status(status).json(problemDetails(status, result.error.code, result.error.message));
      return;
    }

    res.json(result.value);
  });

  router.post('/services', async (req: Request, res: Response) => {
    const parsed = CreateServiceBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(problemDetails(400, 'Invalid Body', parsed.error.message));
      return;
    }

    const teamResult = await handlers.getTeam.execute(parsed.data.ownerTeamId);
    if (!teamResult.ok) {
      res.status(404).json(problemDetails(404, 'Team Not Found', teamResult.error.message));
      return;
    }

    const team = teamResult.value;
    const result = await handlers.registerService.execute({
      serviceName: parsed.data.serviceName,
      repositoryUrl: parsed.data.repositoryUrl,
      runtimeType: parsed.data.runtimeType,
      ownerTeam: {
        teamId: team.teamId,
        teamName: team.teamName,
        domain: team.domain,
        memberCount: team.members.length,
        slackChannelId: team.slackChannelId,
      },
      environments: parsed.data.environments,
      discoveryMethod: 'manual',
      metadata: parsed.data.metadata,
    });

    if (!result.ok) {
      res.status(400).json(problemDetails(400, result.error.code, result.error.message));
      return;
    }

    res.status(201).json(result.value);
  });

  router.patch('/services/:serviceId', async (req: Request, res: Response) => {
    const parsed = UpdateServiceBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(problemDetails(400, 'Invalid Body', parsed.error.message));
      return;
    }

    if (parsed.data.ownerTeamId) {
      const result = await handlers.updateOwnership.execute(
        String(req.params['serviceId']),
        parsed.data.ownerTeamId,
      );

      if (!result.ok) {
        const status = result.error.code.includes('NOT_FOUND') ? 404 : 500;
        res.status(status).json(problemDetails(status, result.error.code, result.error.message));
        return;
      }

      res.json(result.value);
      return;
    }

    res.status(400).json(problemDetails(400, 'No Changes', 'No updatable fields provided'));
  });

  router.delete('/services/:serviceId', async (req: Request, res: Response) => {
    const result = await handlers.deregisterService.execute(String(req.params['serviceId']), 'manual');

    if (!result.ok) {
      const status = result.error.code === 'SERVICE_NOT_FOUND' ? 404 : 500;
      res.status(status).json(problemDetails(status, result.error.code, result.error.message));
      return;
    }

    res.status(204).send();
  });

  router.get('/services/:serviceId/dependencies', async (req: Request, res: Response) => {
    const parsed = GetDependencyGraphQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json(problemDetails(400, 'Invalid Query', parsed.error.message));
      return;
    }

    const result = await handlers.getDependencyGraph.execute(
      String(req.params['serviceId']),
      parsed.data.depth,
    );

    if (!result.ok) {
      res.status(500).json(problemDetails(500, result.error.code, result.error.message));
      return;
    }

    res.json(result.value);
  });

  router.get('/services/:serviceId/dependents', async (req: Request, res: Response) => {
    const parsed = GetDependencyGraphQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json(problemDetails(400, 'Invalid Query', parsed.error.message));
      return;
    }

    const result = await handlers.getDependents.execute(
      String(req.params['serviceId']),
      parsed.data.depth,
    );

    if (!result.ok) {
      res.status(500).json(problemDetails(500, result.error.code, result.error.message));
      return;
    }

    res.json(result.value);
  });


  // GET /services/:serviceId/dependency-scan
  // Reads Lambda env vars and ECS task definition env vars from AWS,
  // then infers outbound dependencies (HTTP calls, AWS service usage).
  router.get('/services/:serviceId/dependency-scan', async (req: Request, res: Response) => {
    const serviceId = String(req.params['serviceId']);
    const svcResult = await handlers.getService.execute(serviceId);
    if (!svcResult.ok || !svcResult.value) {
      res.status(404).json(problemDetails(404, 'Not Found', 'Service not found'));
      return;
    }

    const service = svcResult.value;
    const region  = process.env['AWS_REGION'] ?? 'me-south-1';
    const awsCfg  = { region, credentials: credentialStore.getProvider() };

    // Collect all environment variable maps per (environment, resourceType, resourceName)
    interface EnvVarSource { environment: string; resourceType: string; resourceName: string; vars: Record<string, string> }
    const sources: EnvVarSource[] = [];

    // Fetch all services for cross-referencing HTTP URLs → service names
    const allSvcsResult = await handlers.searchServices.execute({ pagination: { limit: 500 } });
    const allServices = allSvcsResult.ok ? allSvcsResult.value.items : [];

    await Promise.allSettled(
      Object.entries(service.awsResources).flatMap(([env, resources]) =>
        resources.map(async (r) => {
          try {
            if (r.resourceType === 'LAMBDA' && r.identifier) {
              const lambda = new LambdaClient(awsCfg);
              const fn = await lambda.send(new GetFunctionCommand({ FunctionName: r.identifier }));
              const vars = fn.Configuration?.Environment?.Variables ?? {};
              sources.push({ environment: env, resourceType: 'Lambda', resourceName: r.identifier, vars });
            }
            if (r.resourceType === 'ECS_SERVICE' && r.clusterName && r.identifier) {
              const ecs = new ECSClient(awsCfg);
              // Describe the ECS service to get the task definition ARN
              const svcDesc = await ecs.send(new DescribeServicesCommand({
                cluster: r.clusterName,
                services: [r.identifier],
              }));
              const taskDefArn = svcDesc.services?.[0]?.taskDefinition;
              if (taskDefArn) {
                const taskDef = await ecs.send(new DescribeTaskDefinitionCommand({ taskDefinition: taskDefArn }));
                const vars: Record<string, string> = {};
                for (const container of taskDef.taskDefinition?.containerDefinitions ?? []) {
                  for (const e of container.environment ?? []) {
                    if (e.name && e.value) vars[e.name] = e.value;
                  }
                }
                sources.push({ environment: env, resourceType: 'ECS', resourceName: r.identifier, vars });
              }
            }
          } catch {
            // non-fatal — skip resources we can't read
          }
        }),
      ),
    );

    // Parse env vars into dependency entries
    interface DepEntry {
      envVar: string;
      value: string;
      dependencyType: 'api-call' | 'aws-resource' | 'database' | 'queue' | 'other';
      targetLabel: string;       // resolved service name or AWS resource identifier
      targetServiceId: string | null;
      environment: string;
      source: string;            // "Lambda: fn-name" or "ECS: svc-name"
    }

    const HTTP_RE   = /^https?:\/\//i;
    const ARN_RE    = /^arn:aws:/i;
    const SQS_RE    = /^https:\/\/sqs\./i;
    const DYNAMO_RE = /dynamodb|dynamo/i;
    const RDS_RE    = /rds|mysql|postgres|aurora/i;

    // Build a map of service URL fragments → serviceId for matching
    const urlToService = new Map<string, { serviceId: string; serviceName: string }>();
    for (const svc of allServices) {
      try {
        const host = new URL(svc.repositoryUrl.replace('github.com', 'placeholder.internal')).hostname;
        urlToService.set(svc.serviceName.toLowerCase(), { serviceId: svc.serviceId, serviceName: svc.serviceName });
      } catch { /* skip */ }
      urlToService.set(svc.serviceId.toLowerCase(), { serviceId: svc.serviceId, serviceName: svc.serviceName });
    }

    const deps: DepEntry[] = [];
    const seen = new Set<string>();

    for (const src of sources) {
      for (const [key, val] of Object.entries(src.vars)) {
        if (!val || val.length < 4) continue;

        let depType: DepEntry['dependencyType'] | null = null;
        let targetLabel = val;
        let targetServiceId: string | null = null;

        if (SQS_RE.test(val)) {
          depType = 'queue';
          // Extract queue name from SQS URL
          const parts = val.split('/');
          targetLabel = parts[parts.length - 1] ?? val;
        } else if (HTTP_RE.test(val) && !val.includes('localhost') && !val.includes('127.0.0.1')) {
          depType = 'api-call';
          try {
            const u = new URL(val);
            targetLabel = u.hostname;
            // Try to match to a known service
            for (const [fragment, svc] of urlToService.entries()) {
              if (u.hostname.toLowerCase().includes(fragment)) {
                targetLabel = svc.serviceName;
                targetServiceId = svc.serviceId;
                break;
              }
            }
          } catch { /* keep raw */ }
        } else if (ARN_RE.test(val)) {
          depType = 'aws-resource';
          const parts = val.split(':');
          targetLabel = `${parts[2] ?? '?'}: ${parts.slice(5).join(':')}`;
        } else if (DYNAMO_RE.test(key) || DYNAMO_RE.test(val)) {
          depType = 'database';
          targetLabel = val;
        } else if (RDS_RE.test(key) && (val.includes('.') || val.length > 5)) {
          depType = 'database';
          targetLabel = val;
        } else {
          continue; // skip plain non-URL values
        }

        const dedupeKey = `${src.environment}:${key}:${val}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        deps.push({
          envVar: key,
          value: val,
          dependencyType: depType,
          targetLabel,
          targetServiceId,
          environment: src.environment,
          source: `${src.resourceType}: ${src.resourceName}`,
        });
      }
    }

    // Also include services that depend on this one (from existing dependency graph)
    const dependentsResult = await handlers.getDependents.execute(serviceId, 1);
    const dependents = dependentsResult.ok
      ? dependentsResult.value.nodes
          .filter((n) => n.serviceId !== serviceId)
          .map((n) => ({ serviceId: n.serviceId, serviceName: n.serviceName, healthStatus: n.healthStatus }))
      : [];

    res.json({ serviceId, outbound: deps, inbound: dependents, scannedSources: sources.map((s) => `${s.resourceType}: ${s.resourceName} (${s.environment})`) });
  });

  router.get('/teams', async (req: Request, res: Response) => {
    const parsed = ListTeamsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json(problemDetails(400, 'Invalid Query', parsed.error.message));
      return;
    }

    const result = await handlers.listTeams.execute(parsed.data.domain as Domain | undefined);

    if (!result.ok) {
      res.status(500).json(problemDetails(500, result.error.code, result.error.message));
      return;
    }

    res.json(result.value);
  });

  router.get('/teams/:teamId', async (req: Request, res: Response) => {
    const result = await handlers.getTeam.execute(String(req.params['teamId']));

    if (!result.ok) {
      const status = result.error.code === 'TEAM_NOT_FOUND' ? 404 : 500;
      res.status(status).json(problemDetails(status, result.error.code, result.error.message));
      return;
    }

    res.json(result.value);
  });

  // POST /services/:serviceId/resolve-mapping — auto-detect AWS resources from repo config
  router.post('/services/:serviceId/resolve-mapping', async (req: Request, res: Response) => {
    const org = (req.body as { org?: string }).org ?? process.env['GITHUB_ORG'] ?? '';
    if (!org) {
      res.status(400).json(problemDetails(400, 'Missing org', 'Provide org in body or set GITHUB_ORG env var'));
      return;
    }

    const result = await handlers.resolveAwsMapping.resolve(String(req.params['serviceId']), org);
    if (!result.ok) {
      const status = result.error.code === 'SERVICE_NOT_FOUND' ? 404 : 500;
      res.status(status).json(problemDetails(status, result.error.code, result.error.message));
      return;
    }

    res.json(result.value);
  });

  // PUT /services/:serviceId/aws-mapping — manually set (or confirm) AWS resource mappings
  router.put('/services/:serviceId/aws-mapping', async (req: Request, res: Response) => {
    const body = req.body as { mappings?: Record<string, unknown> };
    if (!body.mappings || typeof body.mappings !== 'object') {
      res.status(400).json(problemDetails(400, 'Invalid Body', 'mappings object is required'));
      return;
    }

    const result = await handlers.resolveAwsMapping.setMapping({
      serviceId: String(req.params['serviceId']),
      mappings: body.mappings as Parameters<typeof handlers.resolveAwsMapping.setMapping>[0]['mappings'],
    });

    if (!result.ok) {
      const status = result.error.code === 'SERVICE_NOT_FOUND' ? 404 : 500;
      res.status(status).json(problemDetails(status, result.error.code, result.error.message));
      return;
    }

    res.status(204).send();
  });

  router.get('/teams/:teamId/services', async (req: Request, res: Response) => {
    const result = await handlers.searchServices.execute({
      teamId: String(req.params['teamId']),
      pagination: { limit: 100 },
    });

    if (!result.ok) {
      res.status(500).json(problemDetails(500, result.error.code, result.error.message));
      return;
    }

    res.json(result.value);
  });

  // POST /sync — crawl GitHub org and populate the catalog.
  // Responds immediately with 202 and runs the sync in the background.
  router.post('/sync', (req: Request, res: Response) => {
    const org = (req.body as { org?: string }).org ?? process.env['GITHUB_ORG'] ?? '';
    if (!org) {
      res.status(400).json(problemDetails(400, 'Missing org', 'Provide org in body or set GITHUB_ORG env var'));
      return;
    }

    res.status(202).json({ ok: true, message: `Sync started for org "${org}".` });

    // Run async — do not await
    handlers.reconciliation.reconcile(org).then((result) => {
      if (!result.ok) {
        console.error(`[sync] Failed: ${result.error.code} — ${result.error.message}`);
      } else {
        console.log(`[sync] Completed for org "${org}"`);
      }
    });
  });

  // GET /services/:serviceId/stability?environment=production&days=30
  // Returns CloudWatch ALB/NLB metrics (5xx rate, response time) + deployment markers.
  router.get('/services/:serviceId/stability', async (req: Request, res: Response) => {
    const svcResult = await handlers.getService.execute(String(req.params['serviceId']));
    if (!svcResult.ok) {
      const status = svcResult.error.code === 'SERVICE_NOT_FOUND' ? 404 : 500;
      res.status(status).json(problemDetails(status, svcResult.error.code, svcResult.error.message));
      return;
    }

    const service = svcResult.value;
    const env       = String(req.query['environment'] ?? 'production');
    const days      = Math.min(90, Math.max(1, parseInt(String(req.query['days'] ?? '30'), 10)));
    const region    = process.env['AWS_REGION'] ?? 'me-south-1';
    const endTime   = new Date();
    const startTime = new Date(endTime.getTime() - days * 24 * 60 * 60 * 1000);

    const awsConfig = { region, credentials: credentialStore.getProvider() };

    // ── Step 1: find the ECS service ARN for the requested environment ─────────
    const envResources = (service.awsResources as Record<string, Array<{ resourceType?: string; identifier?: string; clusterName?: string; arn?: string }>>)[env];
    const ecsResource = envResources?.find((r) => r.resourceType === 'ECS_SERVICE');

    // ── Lambda path ───────────────────────────────────────────────────────────
    if (service.runtimeType === 'lambda') {
      try {
        const cwClient = new CloudWatchClient(awsConfig);
        const fnPrefix = env === 'production' ? 'prod' : 'dev';
        const fnName   = `${fnPrefix}-${service.serviceName}`;
        const period   = days <= 14 ? 3600 : 10800;

        const cwResp = await cwClient.send(new GetMetricDataCommand({
          StartTime: startTime,
          EndTime: endTime,
          ScanBy: 'TimestampAscending',
          MetricDataQueries: [
            {
              Id: 'errors',
              MetricStat: {
                Metric: { Namespace: 'AWS/Lambda', MetricName: 'Errors', Dimensions: [{ Name: 'FunctionName', Value: fnName }] },
                Period: period, Stat: 'Sum',
              },
              ReturnData: true,
            },
            {
              Id: 'invocations',
              MetricStat: {
                Metric: { Namespace: 'AWS/Lambda', MetricName: 'Invocations', Dimensions: [{ Name: 'FunctionName', Value: fnName }] },
                Period: period, Stat: 'Sum',
              },
              ReturnData: true,
            },
            {
              Id: 'duration',
              MetricStat: {
                Metric: { Namespace: 'AWS/Lambda', MetricName: 'Duration', Dimensions: [{ Name: 'FunctionName', Value: fnName }] },
                Period: period, Stat: 'p95',
              },
              ReturnData: true,
            },
          ],
        }));

        const tsMap = new Map<number, { errors: number; invocations: number; latencyP95Ms: number }>();
        for (const result of cwResp.MetricDataResults ?? []) {
          for (let i = 0; i < (result.Timestamps?.length ?? 0); i++) {
            const ts = result.Timestamps![i]!.getTime();
            const v  = result.Values![i] ?? 0;
            const existing = tsMap.get(ts) ?? { errors: 0, invocations: 0, latencyP95Ms: 0 };
            if (result.Id === 'errors')      existing.errors       = v;
            if (result.Id === 'invocations') existing.invocations  = v;
            if (result.Id === 'duration')    existing.latencyP95Ms = Math.round(v);
            tsMap.set(ts, existing);
          }
        }

        const metrics = [...tsMap.entries()]
          .sort(([a], [b]) => a - b)
          .map(([ts, v]) => ({
            timestamp: new Date(ts).toISOString(),
            errors: v.errors,
            errors5xx: 0,
            requests2xx: v.invocations,
            latencyP95Ms: v.latencyP95Ms,
            unhealthyHosts: 0,
            errorRate: v.invocations > 0 ? Math.round((v.errors / v.invocations) * 10000) / 100 : 0,
          }));

        // Deployment markers
        const repoUrl = service.repositoryUrl;
        const match   = repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
        let deployments: unknown[] = [];
        if (match) {
          const [, owner, repo] = match as [string, string, string];
          const ghClient = new GitHubClient();
          const runsResult = await ghClient.listWorkflowRuns(owner, repo, { per_page: 50 });
          if (runsResult.ok) {
            deployments = runsResult.value.items
              .filter((r) => branchToEnvironment(r.headBranch) === env && r.conclusion === 'success')
              .filter((r) => new Date(r.createdAt) >= startTime)
              .map((r) => ({ timestamp: r.createdAt, branch: r.headBranch, actor: r.actor, conclusion: r.conclusion, htmlUrl: r.htmlUrl, commitMessage: r.headCommitMessage }));
          }
        }

        res.json({ metrics, deployments, lbType: 'AWS/Lambda', lbName: fnName });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        res.json({ metrics: [], deployments: [], reason: msg });
      }
      return;
    }

    if (!ecsResource?.identifier || !ecsResource.clusterName) {
      res.json({ metrics: [], deployments: [], reason: 'No ECS resource found for this environment' });
      return;
    }

    try {
      // ── Step 2: describe ECS service → get target group ARNs ─────────────────
      const ecsClient = new ECSClient(awsConfig);
      const elbClient = new ElasticLoadBalancingV2Client(awsConfig);
      const cwClient  = new CloudWatchClient(awsConfig);

      const describeResp = await ecsClient.send(new DescribeServicesCommand({
        cluster: ecsResource.clusterName,
        services: [ecsResource.identifier],
      }));

      const ecsService = describeResp.services?.[0];
      const targetGroupArns = (ecsService?.loadBalancers ?? [])
        .map((lb) => lb.targetGroupArn)
        .filter((arn): arn is string => !!arn);

      if (targetGroupArns.length === 0) {
        res.json({ metrics: [], deployments: [], reason: 'No load balancer attached to this ECS service' });
        return;
      }

      // ── Step 3: resolve ALB name from target group ────────────────────────────
      const tgResp = await elbClient.send(new DescribeTargetGroupsCommand({ TargetGroupArns: targetGroupArns }));
      const firstTg = tgResp.TargetGroups?.[0];
      const lbArns = (tgResp.TargetGroups ?? [])
        .flatMap((tg) => tg.LoadBalancerArns ?? [])
        .filter((arn, i, arr) => arr.indexOf(arn) === i); // unique

      if (lbArns.length === 0) {
        res.json({ metrics: [], deployments: [], reason: 'Target group has no associated load balancer' });
        return;
      }

      const lbResp = await elbClient.send(new DescribeLoadBalancersCommand({ LoadBalancerArns: lbArns }));
      const lb = lbResp.LoadBalancers?.[0];
      if (!lb?.LoadBalancerArn) {
        res.json({ metrics: [], deployments: [], reason: 'Could not describe load balancer' });
        return;
      }

      // CloudWatch dimension values — extract suffixes after the resource type prefix
      // e.g. arn:aws:...:loadbalancer/app/my-alb/abc123  →  app/my-alb/abc123
      // e.g. arn:aws:...:targetgroup/my-tg/abc123         →  targetgroup/my-tg/abc123
      const lbDim = lb.LoadBalancerArn.split(':loadbalancer/')[1] ?? '';
      const tgDim = firstTg?.TargetGroupArn
        ? firstTg.TargetGroupArn.split(':')[5]?.replace('targetgroup/', 'targetgroup/') ?? ''
        : '';
      // Correct format: everything after the last colon-separated account segment
      const tgDimFull = firstTg?.TargetGroupArn?.split(':').slice(5).join(':') ?? '';

      const lbType = lb.Type === 'network' ? 'AWS/NetworkELB' : 'AWS/ApplicationELB';

      // Use per-target-group dimensions when available so that dev and prod metrics
      // are isolated even if both environments share the same ALB.
      const tgDimensions = tgDimFull
        ? [{ Name: 'LoadBalancer', Value: lbDim }, { Name: 'TargetGroup', Value: tgDimFull }]
        : [{ Name: 'LoadBalancer', Value: lbDim }];

      // ── Step 4: fetch CloudWatch metrics ─────────────────────────────────────
      // Period = 1 hour for ≤14 days, 3 hours for >14 days (keeps point count reasonable)
      const period = days <= 14 ? 3600 : 10800;

      const metricQueries = lbType === 'AWS/ApplicationELB'
        ? [
            {
              Id: 'e5xx',
              MetricStat: {
                Metric: { Namespace: lbType, MetricName: 'HTTPCode_Target_5XX_Count', Dimensions: tgDimensions },
                Period: period, Stat: 'Sum',
              },
              ReturnData: true,
            },
            {
              Id: 'e2xx',
              MetricStat: {
                Metric: { Namespace: lbType, MetricName: 'HTTPCode_Target_2XX_Count', Dimensions: tgDimensions },
                Period: period, Stat: 'Sum',
              },
              ReturnData: true,
            },
            {
              Id: 'latency',
              MetricStat: {
                Metric: { Namespace: lbType, MetricName: 'TargetResponseTime', Dimensions: tgDimensions },
                Period: period, Stat: 'p95',
              },
              ReturnData: true,
            },
          ]
        : [
            // NLB metrics — target group scoped where possible
            {
              Id: 'unhealthy',
              MetricStat: {
                Metric: { Namespace: lbType, MetricName: 'UnHealthyHostCount', Dimensions: tgDimensions },
                Period: period, Stat: 'Maximum',
              },
              ReturnData: true,
            },
            {
              Id: 'latency',
              MetricStat: {
                Metric: { Namespace: lbType, MetricName: 'TargetTLSNegotiationErrorCount', Dimensions: tgDimensions },
                Period: period, Stat: 'Sum',
              },
              ReturnData: true,
            },
          ];

      // Unused variable cleanup
      void tgDim;

      const cwResp = await cwClient.send(new GetMetricDataCommand({
        MetricDataQueries: metricQueries,
        StartTime: startTime,
        EndTime: endTime,
        ScanBy: 'TimestampAscending',
      }));

      // Build a time-indexed map of metric values
      const tsMap = new Map<number, { errors5xx: number; requests2xx: number; latencyP95Ms: number; unhealthyHosts: number }>();

      for (const result of cwResp.MetricDataResults ?? []) {
        const timestamps = result.Timestamps ?? [];
        const values     = result.Values ?? [];
        for (let i = 0; i < timestamps.length; i++) {
          const ts = timestamps[i]!.getTime();
          const v  = values[i] ?? 0;
          const existing = tsMap.get(ts) ?? { errors5xx: 0, requests2xx: 0, latencyP95Ms: 0, unhealthyHosts: 0 };
          if (result.Id === 'e5xx')     existing.errors5xx     = v;
          if (result.Id === 'e2xx')     existing.requests2xx   = v;
          if (result.Id === 'latency')  existing.latencyP95Ms  = Math.round(v * 1000); // seconds → ms
          if (result.Id === 'unhealthy') existing.unhealthyHosts = v;
          tsMap.set(ts, existing);
        }
      }

      const metrics = [...tsMap.entries()]
        .sort(([a], [b]) => a - b)
        .map(([ts, v]) => ({
          timestamp: new Date(ts).toISOString(),
          errors5xx: v.errors5xx,
          requests2xx: v.requests2xx,
          latencyP95Ms: v.latencyP95Ms,
          unhealthyHosts: v.unhealthyHosts,
          errorRate: v.requests2xx + v.errors5xx > 0
            ? Math.round((v.errors5xx / (v.requests2xx + v.errors5xx)) * 10000) / 100
            : 0,
        }));

      // ── Step 5: fetch deployment markers from GitHub ──────────────────────────
      const repoUrl = service.repositoryUrl;
      const match   = repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
      let deployments: unknown[] = [];

      if (match) {
        const [, owner, repo] = match as [string, string, string];
        const ghClient = new GitHubClient();
        const runsResult = await ghClient.listWorkflowRuns(owner, repo, { per_page: 50 });
        if (runsResult.ok) {
          deployments = runsResult.value.items
            .filter((r) => {
              const runEnv = branchToEnvironment(r.headBranch);
              return runEnv === env && r.conclusion === 'success';
            })
            .filter((r) => new Date(r.createdAt) >= startTime)
            .map((r) => ({
              timestamp: r.createdAt,
              branch: r.headBranch,
              actor: r.actor,
              conclusion: r.conclusion,
              htmlUrl: r.htmlUrl,
              commitMessage: r.headCommitMessage,
            }));
        }
      }

      res.json({ metrics, deployments, lbType, lbName: lb.LoadBalancerName });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[stability] Error for service ${service.serviceId}: ${msg}`);
      res.json({ metrics: [], deployments: [], reason: msg });
    }
  });

  // GET /services/:serviceId/last-deployments — most recent successful run per environment
  router.get('/services/:serviceId/last-deployments', async (req: Request, res: Response) => {
    const svcResult = await handlers.getService.execute(String(req.params['serviceId']));
    if (!svcResult.ok) {
      const status = svcResult.error.code === 'SERVICE_NOT_FOUND' ? 404 : 500;
      res.status(status).json(problemDetails(status, svcResult.error.code, svcResult.error.message));
      return;
    }

    const service = svcResult.value;
    const match = service.repositoryUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (!match) { res.json({ environments: {} }); return; }

    const [, owner, repo] = match as [string, string, string];
    const ghClient = new GitHubClient();
    const runsResult = await ghClient.listWorkflowRuns(owner, repo, { per_page: 50 });
    if (!runsResult.ok) { res.json({ environments: {} }); return; }

    // Find the most recent successful run per environment
    const byEnv = new Map<string, {
      runId: number; workflowName: string; branch: string | null;
      actor: string | null; commitMessage: string | null;
      completedAt: string; htmlUrl: string;
    }>();

    for (const run of runsResult.value.items) {
      if (run.conclusion !== 'success') continue;
      const env = branchToEnvironment(run.headBranch);
      if (!byEnv.has(env)) {
        byEnv.set(env, {
          runId: run.id,
          workflowName: run.name,
          branch: run.headBranch,
          actor: run.actor,
          commitMessage: run.headCommitMessage,
          completedAt: run.updatedAt,
          htmlUrl: run.htmlUrl,
        });
      }
    }

    res.json({ environments: Object.fromEntries(byEnv) });
  });

  // GET /services/:serviceId/pull-requests — open pull requests
  router.get('/services/:serviceId/pull-requests', async (req: Request, res: Response) => {
    const svcResult = await handlers.getService.execute(String(req.params['serviceId']));
    if (!svcResult.ok) {
      const status = svcResult.error.code === 'SERVICE_NOT_FOUND' ? 404 : 500;
      res.status(status).json(problemDetails(status, svcResult.error.code, svcResult.error.message));
      return;
    }

    const service = svcResult.value;
    const match = service.repositoryUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (!match) { res.json({ items: [] }); return; }

    const [, owner, repo] = match as [string, string, string];
    const ghClient = new GitHubClient();
    const result = await ghClient.listPullRequests(owner, repo);
    if (!result.ok) { res.json({ items: [] }); return; }

    res.json({ items: result.value });
  });

  // GET /services/:serviceId/contributors — top committers + top workflow run actors
  router.get('/services/:serviceId/contributors', async (req: Request, res: Response) => {
    const svcResult = await handlers.getService.execute(String(req.params['serviceId']));
    if (!svcResult.ok) {
      const status = svcResult.error.code === 'SERVICE_NOT_FOUND' ? 404 : 500;
      res.status(status).json(problemDetails(status, svcResult.error.code, svcResult.error.message));
      return;
    }

    const service = svcResult.value;
    const repoUrl = service.repositoryUrl;
    const match   = repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);

    if (!match) {
      res.json({ topContributors: [], topTriggers: [] });
      return;
    }

    const [, owner, repo] = match as [string, string, string];
    const ghClient = new GitHubClient();

    // Fetch both in parallel
    const [contributorsResult, runsResult] = await Promise.all([
      ghClient.listContributors(owner, repo, 10),
      ghClient.listWorkflowRuns(owner, repo, { per_page: 100 }),
    ]);

    const topContributors = contributorsResult.ok
      ? contributorsResult.value
      : [];

    // Aggregate actors from workflow runs
    const actorCounts = new Map<string, number>();
    if (runsResult.ok) {
      for (const run of runsResult.value.items) {
        if (run.actor) actorCounts.set(run.actor, (actorCounts.get(run.actor) ?? 0) + 1);
      }
    }
    const topTriggers = [...actorCounts.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([login, count]) => ({ login, count }));

    res.json({ topContributors, topTriggers });
  });

  // ── User identity helper ─────────────────────────────────────────────────
  async function resolveUserArn(): Promise<string | null> {
    try {
      const region = process.env['AWS_REGION'] ?? 'me-south-1';
      const stsClient = new STSClient({ region, credentials: credentialStore.getProvider() });
      const identity = await stsClient.send(new GetCallerIdentityCommand({}));
      return identity.Arn ?? null;
    } catch {
      return null;
    }
  }

  // GET /deployments/preferences — returns the calling user's watched repo list
  router.get('/deployments/preferences', async (_req: Request, res: Response) => {
    const userArn = await resolveUserArn();
    if (!userArn) { res.json({ watchedRepos: [] }); return; }

    try {
      const db    = createDynamoDBClient();
      const table = getTableName('service-catalog');
      const result = await db.send(new GetCommand({
        TableName: table,
        Key: { PK: `USER#${userArn}`, SK: 'DEPLOYMENT_PREFS' },
      }));
      res.json({ watchedRepos: (result.Item?.['watchedRepos'] as string[] | undefined) ?? [] });
    } catch {
      res.json({ watchedRepos: [] });
    }
  });

  // PUT /deployments/preferences — saves the calling user's watched repo list
  router.put('/deployments/preferences', async (req: Request, res: Response) => {
    const userArn = await resolveUserArn();
    if (!userArn) { res.status(401).json(problemDetails(401, 'Unauthorized', 'Could not resolve AWS identity')); return; }

    const watchedRepos = req.body?.watchedRepos;
    if (!Array.isArray(watchedRepos) || watchedRepos.some((r) => typeof r !== 'string')) {
      res.status(400).json(problemDetails(400, 'Bad Request', 'watchedRepos must be an array of serviceId strings'));
      return;
    }

    try {
      const db    = createDynamoDBClient();
      const table = getTableName('service-catalog');
      await db.send(new PutCommand({
        TableName: table,
        Item: {
          PK: `USER#${userArn}`,
          SK: 'DEPLOYMENT_PREFS',
          watchedRepos,
          updatedAt: new Date().toISOString(),
        },
      }));
      res.json({ ok: true, watchedRepos });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json(problemDetails(500, 'Internal Error', msg));
    }
  });

  // GET /deployments/feed — GitHub Actions runs for user's watched repos, paginated
  router.get('/deployments/feed', async (req: Request, res: Response) => {
    const env      = req.query['environment'] ? String(req.query['environment']) : null;
    const page     = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10));
    const pageSize = 10;
    // Fetch enough runs per repo to cover the requested page across all watched repos
    const perRepo  = page * pageSize * 2; // over-fetch so sorting still yields full pages

    // 1. Resolve user's watched repo list from DynamoDB
    const userArn = await resolveUserArn();
    let watchedServiceIds: string[] = [];
    if (userArn) {
      try {
        const db    = createDynamoDBClient();
        const table = getTableName('service-catalog');
        const result = await db.send(new GetCommand({
          TableName: table,
          Key: { PK: `USER#${userArn}`, SK: 'DEPLOYMENT_PREFS' },
        }));
        watchedServiceIds = (result.Item?.['watchedRepos'] as string[] | undefined) ?? [];
      } catch { /* fall through to empty list */ }
    }

    if (watchedServiceIds.length === 0) {
      res.json({ items: [], totalItems: 0, page, pageSize, hasMore: false });
      return;
    }

    // 2. Resolve service details for watched repos
    const allServicesResult = await handlers.searchServices.execute({ pagination: { limit: 500 } });
    if (!allServicesResult.ok) { res.json({ items: [], totalItems: 0, page, pageSize, hasMore: false }); return; }

    const allServices = allServicesResult.value.items as Array<{ serviceId: string; serviceName: string; repositoryUrl: string }>;
    const watchedServices = allServices.filter((s) => watchedServiceIds.includes(s.serviceId));

    // 3. Fan out GitHub calls (all in parallel — user chose these repos, count is bounded)
    type RunItem = {
      serviceId: string; serviceName: string;
      runId: number; workflowName: string; status: string; conclusion: string | null;
      environment: string; branch: string | null; sha: string;
      startedAt: string; completedAt: string; durationSeconds: number | null;
      htmlUrl: string; actor: string | null; commitMessage: string | null;
    };

    const ghClient = new GitHubClient();
    const allRuns: RunItem[] = [];

    await Promise.all(watchedServices.map(async (svc) => {
      const match = svc.repositoryUrl?.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
      if (!match) return;
      const [, owner, repo] = match as [string, string, string];
      const result = await ghClient.listWorkflowRuns(owner, repo, { per_page: Math.min(100, perRepo) });
      if (!result.ok) return;
      for (const r of result.value.items) {
        const runEnv = branchToEnvironment(r.headBranch);
        if (env && runEnv !== env) continue;
        allRuns.push({
          serviceId:      svc.serviceId,
          serviceName:    svc.serviceName,
          runId:          r.id,
          workflowName:   r.name,
          status:         r.status,
          conclusion:     r.conclusion,
          environment:    runEnv,
          branch:         r.headBranch,
          sha:            r.headSha.slice(0, 7),
          startedAt:      r.createdAt,
          completedAt:    r.updatedAt,
          durationSeconds: r.conclusion
            ? Math.round((new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime()) / 1000)
            : null,
          htmlUrl:       r.htmlUrl,
          actor:         r.actor,
          commitMessage: r.headCommitMessage,
        });
      }
    }));

    // 4. Sort newest first, paginate
    allRuns.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    const start = (page - 1) * pageSize;
    const pageItems = allRuns.slice(start, start + pageSize);

    res.json({ items: pageItems, totalItems: allRuns.length, page, pageSize, hasMore: start + pageSize < allRuns.length });
  });

  // GET /deployments/velocity — DORA metrics computed live from GitHub Actions runs
  // for the calling user's watched repos (last 30 days, production branch).
  router.get('/deployments/velocity', async (_req: Request, res: Response) => {
    try {
    const DAYS = 30;
    const startTime = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);

    // 1. Resolve watched repos
    const userArn = await resolveUserArn();
    let watchedServiceIds: string[] = [];
    if (userArn) {
      try {
        const db = createDynamoDBClient();
        const result = await db.send(new GetCommand({
          TableName: getTableName('service-catalog'),
          Key: { PK: `USER#${userArn}`, SK: 'DEPLOYMENT_PREFS' },
        }));
        watchedServiceIds = (result.Item?.['watchedRepos'] as string[] | undefined) ?? [];
      } catch { /* fall through */ }
    }

    if (watchedServiceIds.length === 0) {
      res.json({ noRepos: true });
      return;
    }

    const allServicesResult = await handlers.searchServices.execute({ pagination: { limit: 500 } });
    if (!allServicesResult.ok) { res.json({ noRepos: true }); return; }

    const watchedServices = (allServicesResult.value.items as Array<{ serviceId: string; serviceName: string; repositoryUrl: string }>)
      .filter((s) => watchedServiceIds.includes(s.serviceId));

    // 2. Fetch runs for watched repos in parallel
    type RunSummary = { serviceId: string; serviceName: string; conclusion: string | null; startedAt: string; durationSeconds: number };
    const ghClient = new GitHubClient();
    const prodRuns: RunSummary[] = [];

    await Promise.all(watchedServices.map(async (svc) => {
      const match = svc.repositoryUrl?.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
      if (!match) return;
      const [, owner, repo] = match as [string, string, string];
      const result = await ghClient.listWorkflowRuns(owner, repo, { per_page: 100 });
      if (!result.ok) return;
      for (const r of result.value.items) {
        if (branchToEnvironment(r.headBranch) !== 'production') continue;
        if (new Date(r.createdAt) < startTime) continue;
        prodRuns.push({
          serviceId:       svc.serviceId,
          serviceName:     svc.serviceName,
          conclusion:      r.conclusion,
          startedAt:       r.createdAt,
          durationSeconds: Math.round((new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime()) / 1000),
        });
      }
    }));

    // 3. Compute DORA metrics
    const successful  = prodRuns.filter((r) => r.conclusion === 'success');
    const failed      = prodRuns.filter((r) => r.conclusion === 'failure');
    const totalRuns   = successful.length + failed.length;

    // Deployment frequency: successful deploys per day
    const deployFreqPerDay = successful.length / DAYS;

    // Change failure rate: % of runs that failed
    const cfr = totalRuns > 0 ? (failed.length / totalRuns) * 100 : 0;

    // Lead time: average duration of successful runs (proxy — real lead time needs PR merge timestamps)
    const avgLeadTimeSec = successful.length > 0
      ? successful.reduce((s, r) => s + r.durationSeconds, 0) / successful.length
      : 0;
    const avgLeadTimeHours = avgLeadTimeSec / 3600;

    // MTTR: average time from a failure to the next success on the same repo
    const mttrSamples: number[] = [];
    const byService = new Map<string, RunSummary[]>();
    for (const r of prodRuns) {
      if (!byService.has(r.serviceId)) byService.set(r.serviceId, []);
      byService.get(r.serviceId)!.push(r);
    }
    for (const runs of byService.values()) {
      runs.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
      for (let i = 0; i < runs.length - 1; i++) {
        if (runs[i]!.conclusion === 'failure') {
          for (let j = i + 1; j < runs.length; j++) {
            if (runs[j]!.conclusion === 'success') {
              const diff = (new Date(runs[j]!.startedAt).getTime() - new Date(runs[i]!.startedAt).getTime()) / 3600000;
              mttrSamples.push(diff);
              break;
            }
          }
        }
      }
    }
    const mttrHours = mttrSamples.length > 0 ? mttrSamples.reduce((a, b) => a + b, 0) / mttrSamples.length : null;

    // DORA classification helpers
    const classifyFreq = (d: number) => d >= 1 ? 'elite' : d >= 1/7 ? 'high' : d >= 1/30 ? 'medium' : 'low';
    const classifyCfr  = (p: number) => p <= 5 ? 'elite' : p <= 10 ? 'high' : p <= 15 ? 'medium' : 'low';
    const classifyLead = (h: number) => h < 1 ? 'elite' : h < 24 ? 'high' : h < 168 ? 'medium' : 'low';
    const classifyMttr = (h: number) => h < 1 ? 'elite' : h < 24 ? 'high' : h < 168 ? 'medium' : 'low';

    // 4. Weekly trend (last 4 weeks)
    const weeks: Array<{ week: string; deploys: number; failures: number }> = [];
    for (let w = 3; w >= 0; w--) {
      const weekStart = new Date(Date.now() - (w + 1) * 7 * 24 * 60 * 60 * 1000);
      const weekEnd   = new Date(Date.now() - w * 7 * 24 * 60 * 60 * 1000);
      const label     = weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      weeks.push({
        week:     label,
        deploys:  successful.filter((r) => { const d = new Date(r.startedAt); return d >= weekStart && d < weekEnd; }).length,
        failures: failed.filter((r)     => { const d = new Date(r.startedAt); return d >= weekStart && d < weekEnd; }).length,
      });
    }

    // 5. Per-repo breakdown
    const repoBreakdown = watchedServices.map((svc) => {
      const runs  = prodRuns.filter((r) => r.serviceId === svc.serviceId);
      const succ  = runs.filter((r) => r.conclusion === 'success').length;
      const fail  = runs.filter((r) => r.conclusion === 'failure').length;
      return { serviceId: svc.serviceId, serviceName: svc.serviceName, deploys: succ, failures: fail, failRate: succ + fail > 0 ? Math.round((fail / (succ + fail)) * 100) : 0 };
    }).sort((a, b) => b.deploys - a.deploys);

    res.json({
      noRepos: false,
      periodDays: DAYS,
      watchedRepos: watchedServices.length,
      totalRuns,
      metrics: {
        deploymentFrequency: { value: Math.round(deployFreqPerDay * 100) / 100, classification: classifyFreq(deployFreqPerDay), unit: 'per day' },
        changeFailureRate:   { value: Math.round(cfr * 10) / 10, classification: classifyCfr(cfr) },
        leadTimeHours:       { value: Math.round(avgLeadTimeHours * 10) / 10, classification: classifyLead(avgLeadTimeHours) },
        mttrHours:           mttrHours !== null ? { value: Math.round(mttrHours * 10) / 10, classification: classifyMttr(mttrHours) } : null,
      },
      weeklyTrend: weeks,
      repoBreakdown,
    });
    } catch (err) {
      console.error('[velocity] unhandled error:', err);
      res.status(500).json(problemDetails(500, 'Internal Error', err instanceof Error ? err.message : String(err)));
    }
  });

  // GET /deployments/pipelines — CI health across user's watched repos (all branches)
  router.get('/deployments/pipelines', async (_req: Request, res: Response) => {
    try {
    const DAYS = 30;
    const startTime = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);

    // 1. Resolve watched repos
    const userArn = await resolveUserArn();
    let watchedServiceIds: string[] = [];
    if (userArn) {
      try {
        const db = createDynamoDBClient();
        const result = await db.send(new GetCommand({
          TableName: getTableName('service-catalog'),
          Key: { PK: `USER#${userArn}`, SK: 'DEPLOYMENT_PREFS' },
        }));
        watchedServiceIds = (result.Item?.['watchedRepos'] as string[] | undefined) ?? [];
      } catch { /* fall through */ }
    }

    if (watchedServiceIds.length === 0) {
      res.json({ noRepos: true });
      return;
    }

    const allServicesResult = await handlers.searchServices.execute({ pagination: { limit: 500 } });
    if (!allServicesResult.ok) { res.json({ noRepos: true }); return; }

    const watchedServices = (allServicesResult.value.items as Array<{ serviceId: string; serviceName: string; repositoryUrl: string }>)
      .filter((s) => watchedServiceIds.includes(s.serviceId));

    // 2. Fetch ALL runs (not just production) for watched repos
    type RunSummary = {
      serviceId: string; serviceName: string;
      workflowName: string; conclusion: string | null; status: string;
      durationSeconds: number; startedAt: string; htmlUrl: string;
    };

    const ghClient = new GitHubClient();
    const allRuns: RunSummary[] = [];

    await Promise.all(watchedServices.map(async (svc) => {
      const match = svc.repositoryUrl?.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
      if (!match) return;
      const [, owner, repo] = match as [string, string, string];
      const result = await ghClient.listWorkflowRuns(owner, repo, { per_page: 100 });
      if (!result.ok) return;
      for (const r of result.value.items) {
        if (new Date(r.createdAt) < startTime) continue;
        allRuns.push({
          serviceId:       svc.serviceId,
          serviceName:     svc.serviceName,
          workflowName:    r.name,
          conclusion:      r.conclusion,
          status:          r.status,
          durationSeconds: Math.round((new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime()) / 1000),
          startedAt:       r.createdAt,
          htmlUrl:         r.htmlUrl,
        });
      }
    }));

    const completed  = allRuns.filter((r) => r.conclusion !== null);
    const successful = allRuns.filter((r) => r.conclusion === 'success');
    const failed     = allRuns.filter((r) => r.conclusion === 'failure');
    const cancelled  = allRuns.filter((r) => r.conclusion === 'cancelled');
    const timedOut   = allRuns.filter((r) => r.conclusion === 'timed_out');
    const inProgress = allRuns.filter((r) => r.status === 'in_progress');

    // Avg duration of completed runs
    const avgDurationSeconds = completed.length > 0
      ? Math.round(completed.reduce((s, r) => s + r.durationSeconds, 0) / completed.length)
      : 0;

    // Success rate
    const successRate = completed.length > 0
      ? Math.round((successful.length / completed.length) * 1000) / 10
      : 0;

    // Failure breakdown by conclusion type
    const failureByType = {
      failure:   failed.length,
      cancelled: cancelled.length,
      timed_out: timedOut.length,
    };

    // Per-workflow stats (across all repos)
    const workflowMap = new Map<string, { total: number; failures: number; totalDuration: number }>();
    for (const r of completed) {
      const existing = workflowMap.get(r.workflowName) ?? { total: 0, failures: 0, totalDuration: 0 };
      existing.total++;
      if (r.conclusion === 'failure' || r.conclusion === 'timed_out') existing.failures++;
      existing.totalDuration += r.durationSeconds;
      workflowMap.set(r.workflowName, existing);
    }
    const workflowStats = [...workflowMap.entries()]
      .map(([name, s]) => ({
        name,
        total:       s.total,
        failures:    s.failures,
        failRate:    Math.round((s.failures / s.total) * 1000) / 10,
        avgDuration: Math.round(s.totalDuration / s.total),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    // Per-repo stats
    const repoStats = watchedServices.map((svc) => {
      const runs  = completed.filter((r) => r.serviceId === svc.serviceId);
      const succ  = runs.filter((r) => r.conclusion === 'success').length;
      const fail  = runs.filter((r) => r.conclusion === 'failure' || r.conclusion === 'timed_out').length;
      const avgDur = runs.length > 0 ? Math.round(runs.reduce((s, r) => s + r.durationSeconds, 0) / runs.length) : 0;
      return {
        serviceId:   svc.serviceId,
        serviceName: svc.serviceName,
        total:       runs.length,
        successes:   succ,
        failures:    fail,
        failRate:    runs.length > 0 ? Math.round((fail / runs.length) * 1000) / 10 : 0,
        avgDurationSeconds: avgDur,
      };
    }).sort((a, b) => b.total - a.total);

    // Slowest workflows
    const slowestWorkflows = [...workflowMap.entries()]
      .map(([name, s]) => ({ name, avgDuration: Math.round(s.totalDuration / s.total), total: s.total }))
      .sort((a, b) => b.avgDuration - a.avgDuration)
      .slice(0, 5);

    res.json({
      noRepos: false,
      periodDays: DAYS,
      totalRuns:  allRuns.length,
      completed:  completed.length,
      inProgress: inProgress.length,
      successRate,
      avgDurationSeconds,
      failureByType,
      workflowStats,
      repoStats,
      slowestWorkflows,
    });
    } catch (err) {
      console.error('[pipelines] unhandled error:', err);
      res.status(500).json(problemDetails(500, 'Internal Error', err instanceof Error ? err.message : String(err)));
    }
  });

  // GET /deployments/infra-cost — Cost Explorer spend for watched repos, matched by
  // actual ECS service name and Lambda function name (RESOURCE_ID grouping).
  // Convention: ECS cluster washmen-{env}, service {env}-{slug} or {slug}-{env};
  //             Lambda function {env}-{slug} or {slug}-{env}.
  // Only ECS + Lambda are queried — shared dependencies (DynamoDB, SQS etc.) that
  // a repo merely consumes but does not own are naturally excluded.
  router.get('/deployments/infra-cost', async (_req: Request, res: Response) => {
    try {
      // 1. Resolve watched repos
      const userArn = await resolveUserArn();
      let watchedServiceIds: string[] = [];
      if (userArn) {
        try {
          const db = createDynamoDBClient();
          const result = await db.send(new GetCommand({
            TableName: getTableName('service-catalog'),
            Key: { PK: `USER#${userArn}`, SK: 'DEPLOYMENT_PREFS' },
          }));
          watchedServiceIds = (result.Item?.['watchedRepos'] as string[] | undefined) ?? [];
        } catch { /* fall through */ }
      }

      if (watchedServiceIds.length === 0) { res.json({ noRepos: true }); return; }

      const allServicesResult = await handlers.searchServices.execute({ pagination: { limit: 500 } });
      if (!allServicesResult.ok) { res.json({ noRepos: true }); return; }

      const watchedServices = (allServicesResult.value.items as Array<{ serviceId: string; serviceName: string; repositoryUrl: string }>)
        .filter((s) => watchedServiceIds.includes(s.serviceId));

      if (watchedServices.length === 0) { res.json({ noRepos: true }); return; }

      // 2. Derive repo slug (GitHub repo name, last URL segment) for each service.
      type WatchedSvc = { serviceId: string; serviceName: string; repoSlug: string };
      const slugged: WatchedSvc[] = watchedServices.map((svc) => {
        const m = svc.repositoryUrl?.match(/\/([^/]+?)(?:\.git)?$/);
        return { serviceId: svc.serviceId, serviceName: svc.serviceName, repoSlug: (m?.[1] ?? svc.serviceName).toLowerCase() };
      });

      // 3. Query Cost Explorer with RESOURCE_ID grouping, filtered to ECS + Lambda.
      //    RESOURCE_ID gives us the actual ARNs — ECS service names and Lambda
      //    function names are embedded in those ARNs, no tags required.
      //
      //    RESOURCE_ID requires DAILY granularity and is limited to a 14-day rolling
      //    window (AWS "Daily granularity" setting). We cap the lookback accordingly
      //    and compare the same window from last month for an apples-to-apples diff.
      const credentials = credentialStore.getProvider();
      const ce = new CostExplorerClient({ region: 'us-east-1', credentials });

      const now   = new Date();
      const today = now.toISOString().slice(0, 10); // exclusive end

      // Max 14 days back (resource-level data limit). Cap at the start of this month
      // so we never cross a month boundary for the current period.
      const MAX_DAYS = 14;
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const fourteenAgo  = new Date(now);
      fourteenAgo.setDate(now.getDate() - MAX_DAYS);
      const windowStart = fourteenAgo > startOfMonth ? fourteenAgo : startOfMonth;

      const pad = (n: number) => String(n).padStart(2, '0');
      const fmtDate = (d: Date) =>
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

      let thisStart = fmtDate(windowStart);
      let thisEnd   = today; // exclusive

      // Mirror the exact same date range one calendar month earlier for comparison.
      const lastWindowStart = new Date(windowStart);
      lastWindowStart.setMonth(lastWindowStart.getMonth() - 1);
      const lastWindowEnd = new Date(now);
      lastWindowEnd.setMonth(lastWindowEnd.getMonth() - 1);
      // Cap last month's end at the actual number of days in that month
      const daysInLastMonth = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
      if (lastWindowEnd.getDate() > daysInLastMonth) lastWindowEnd.setDate(daysInLastMonth);

      let lastStart = fmtDate(lastWindowStart);
      let lastEnd   = fmtDate(lastWindowEnd); // exclusive

      // Edge case: on the 1st of a month, windowStart === today and Cost Explorer
      // rejects empty date ranges with "Start date should be before end date".
      // Push end forward one day in either window so the API accepts the call;
      // returned data for "today" will simply be empty.
      const addDay = (s: string): string => {
        const d = new Date(s + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + 1);
        return d.toISOString().slice(0, 10);
      };
      if (thisEnd <= thisStart) thisEnd = addDay(thisStart);
      if (lastEnd <= lastStart) lastEnd = addDay(lastStart);

      const ecsLambdaFilter = {
        Dimensions: {
          Key: 'SERVICE' as const,
          Values: ['Amazon Elastic Container Service', 'AWS Lambda'],
        },
      };

      // RESOURCE_ID works only with DAILY granularity under the "Daily granularity" setting.
      // Fall back to MONTHLY + SERVICE grouping if the setting isn't enabled.
      const resourceIdQuery = (start: string, end: string) =>
        ce.send(new GetCostAndUsageCommand({
          TimePeriod: { Start: start, End: end },
          Granularity: 'DAILY',
          Filter: { Dimensions: ecsLambdaFilter.Dimensions },
          GroupBy: [{ Type: 'DIMENSION', Key: 'RESOURCE_ID' }],
          Metrics: ['UnblendedCost'],
        }));

      const serviceQuery = (start: string, end: string) =>
        ce.send(new GetCostAndUsageCommand({
          TimePeriod: { Start: start, End: end },
          Granularity: 'MONTHLY',
          Filter: { Dimensions: ecsLambdaFilter.Dimensions },
          GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
          Metrics: ['UnblendedCost'],
        }));

      // Try resource-level first; downgrade to SERVICE aggregate if not available.
      let useResourceLevel = true;
      let [thisRes, lastRes] = await Promise.allSettled([
        resourceIdQuery(thisStart, thisEnd),
        resourceIdQuery(lastStart, lastEnd),
      ]);

      if (thisRes.status === 'rejected') {
        const msg = thisRes.reason instanceof Error ? thisRes.reason.message : String(thisRes.reason);
        const isAuthErr = /credentials|token|UnrecognizedClient|InvalidClientToken|ExpiredToken|AccessDenied/i.test(msg);
        if (isAuthErr) { res.json({ noRepos: false, noCredentials: true, services: [] }); return; }
        if (/RESOURCE_ID|Group Definition dimension is invalid/i.test(msg)) {
          useResourceLevel = false;
          [thisRes, lastRes] = await Promise.allSettled([
            serviceQuery(thisStart, thisEnd),
            serviceQuery(lastStart, lastEnd),
          ]);
        }
        if (thisRes.status === 'rejected') {
          const msg2 = thisRes.reason instanceof Error ? thisRes.reason.message : String(thisRes.reason);
          res.status(502).json(problemDetails(502, 'Cost Explorer Error', msg2));
          return;
        }
      }

      // 4. Extract the resource name from an ARN or plain name.
      //    ECS:    arn:aws:ecs:region:account:service/washmen-dev/dev-web-app-public-api  → dev-web-app-public-api
      //    Lambda: arn:aws:lambda:region:account:function:prod-web-app-public-api         → prod-web-app-public-api
      //    Fallback: use the value as-is
      function resourceName(resourceId: string): string {
        if (resourceId.startsWith('arn:')) {
          const parts = resourceId.split(/[:\/]/);
          return parts[parts.length - 1] ?? resourceId;
        }
        return resourceId;
      }

      // 5. Strip env prefix/suffix to get the repo slug.
      //    Supports: dev-{slug}, prod-{slug}, {slug}-dev, {slug}-prod
      function parseEnvSlug(name: string): { env: 'dev' | 'prod'; slug: string } | null {
        const lower = name.toLowerCase();
        if (lower.startsWith('dev-'))  return { env: 'dev',  slug: lower.slice(4) };
        if (lower.startsWith('prod-')) return { env: 'prod', slug: lower.slice(5) };
        if (lower.endsWith('-dev'))    return { env: 'dev',  slug: lower.slice(0, -4) };
        if (lower.endsWith('-prod'))   return { env: 'prod', slug: lower.slice(0, -5) };
        return null;
      }

      // 6. Build slug → { env → { this, last } } cost map from CE results
      type SlugCosts = { dev: { this: number; last: number }; prod: { this: number; last: number } };

      // When resource-level isn't available, distribute total ECS+Lambda equally across
      // watched repos so the tab shows meaningful aggregate numbers rather than zeros.
      function buildFallbackSlugMap(
        thisGroups: Array<{ Metrics?: Record<string, { Amount?: string }> }>,
        lastGroups: Array<{ Metrics?: Record<string, { Amount?: string }> }>,
        repoCount: number,
      ): Map<string, SlugCosts> {
        const sum = (groups: typeof thisGroups) =>
          groups.reduce((s, g) => s + parseFloat(g.Metrics?.['UnblendedCost']?.Amount ?? '0'), 0);
        const thisTotal = sum(thisGroups);
        const lastTotal = sum(lastGroups);
        const perRepo   = repoCount > 0 ? thisTotal / repoCount : 0;
        const perRepoLast = repoCount > 0 ? lastTotal / repoCount : 0;
        const map = new Map<string, SlugCosts>();
        // We'll populate per-slug below using the watched list — return empty map with totals captured
        // via closure so callers can build entries.
        void perRepo; void perRepoLast; // used below
        return map;
      }

      let slugMap = new Map<string, SlugCosts>();

      if (useResourceLevel) {
        function accumulateCosts(ceResult: typeof thisRes, period: 'this' | 'last', acc: Map<string, SlugCosts>) {
          if (ceResult.status !== 'fulfilled') return;
          for (const p of ceResult.value.ResultsByTime ?? []) {
            for (const group of p.Groups ?? []) {
              const rawId = group.Keys?.[0] ?? '';
              if (!rawId) continue;
              const name   = resourceName(rawId);
              const parsed = parseEnvSlug(name);
              if (!parsed) continue;
              const cost = parseFloat(group.Metrics?.['UnblendedCost']?.Amount ?? '0');
              if (!acc.has(parsed.slug)) acc.set(parsed.slug, { dev: { this: 0, last: 0 }, prod: { this: 0, last: 0 } });
              acc.get(parsed.slug)![parsed.env][period] += cost;
            }
          }
        }
        accumulateCosts(thisRes, 'this', slugMap);
        accumulateCosts(lastRes, 'last', slugMap);
      } else {
        // Fallback: distribute total ECS+Lambda cost evenly across watched repos
        const ceExtractTotal = (res: PromiseSettledResult<{ ResultsByTime?: Array<{ Groups?: Array<{ Metrics?: Record<string, { Amount?: string }> }> }> }>): number => {
          if (res.status !== 'fulfilled') return 0;
          let total = 0;
          for (const p of res.value.ResultsByTime ?? []) {
            for (const g of p.Groups ?? []) {
              total += parseFloat(g.Metrics?.['UnblendedCost']?.Amount ?? '0');
            }
          }
          return total;
        };
        const thisTotal = ceExtractTotal(thisRes as Parameters<typeof ceExtractTotal>[0]);
        const lastTotal = ceExtractTotal(lastRes as Parameters<typeof ceExtractTotal>[0]);
        const n = slugged.length || 1;
        // Evenly split across repos, no dev/prod breakdown (mark all as prod)
        for (const svc of slugged) {
          slugMap.set(svc.repoSlug, {
            dev:  { this: 0, last: 0 },
            prod: { this: Math.round((thisTotal / n) * 100) / 100, last: Math.round((lastTotal / n) * 100) / 100 },
          });
        }
      }

      // 7. Match watched services to slug map entries
      const services = slugged.map((svc) => {
        const costs   = slugMap.get(svc.repoSlug) ?? null;
        const devThis  = costs?.dev.this  ?? 0;
        const devLast  = costs?.dev.last  ?? 0;
        const prodThis = costs?.prod.this ?? 0;
        const prodLast = costs?.prod.last ?? 0;
        const thisCost = Math.round((devThis + prodThis) * 100) / 100;
        const lastCost = Math.round((devLast + prodLast) * 100) / 100;
        return {
          serviceId:    svc.serviceId,
          serviceName:  svc.serviceName,
          repoSlug:     svc.repoSlug,
          matched:      costs !== null,
          thisCost,
          lastCost,
          changePercent: lastCost > 0 ? Math.round(((thisCost - lastCost) / lastCost) * 1000) / 10 : 0,
          environments: {
            dev:  { thisCost: Math.round(devThis  * 100) / 100, lastCost: Math.round(devLast  * 100) / 100 },
            prod: { thisCost: Math.round(prodThis * 100) / 100, lastCost: Math.round(prodLast * 100) / 100 },
          },
        };
      }).sort((a, b) => b.thisCost - a.thisCost);

      const currency = thisRes.status === 'fulfilled'
        ? (thisRes.value.ResultsByTime?.[0]?.Groups?.[0]?.Metrics?.['UnblendedCost']?.Unit ?? 'USD')
        : 'USD';

      res.json({
        noRepos:          false,
        noCredentials:    false,
        resourceLevel:    useResourceLevel,   // lets the UI show a note when using fallback
        period:           thisStart,           // start of current window
        lastPeriod:       lastStart,           // start of comparison window
        currency,
        services,
        totalThisMonth: Math.round(services.reduce((s, r) => s + r.thisCost, 0) * 100) / 100,
        matchedCount:   services.filter((s) => s.matched).length,
        unmatchedCount: services.filter((s) => !s.matched).length,
      });
    } catch (err) {
      console.error('[infra-cost] unhandled error:', err);
      res.status(500).json(problemDetails(500, 'Internal Error', err instanceof Error ? err.message : String(err)));
    }
  });

  // GET /sync/status — current sync progress (polled by the UI)
  router.get('/sync/status', (_req: Request, res: Response) => {
    res.json(handlers.reconciliation.getStatus());
  });

  // GET /services/:serviceId/workflow-runs — latest GitHub Actions runs for the service's repo.
  // This does NOT require webhook setup — it reads directly from the GitHub API.
  router.get('/services/:serviceId/workflow-runs', async (req: Request, res: Response) => {
    const svcResult = await handlers.getService.execute(String(req.params['serviceId']));
    if (!svcResult.ok) {
      const status = svcResult.error.code === 'SERVICE_NOT_FOUND' ? 404 : 500;
      res.status(status).json(problemDetails(status, svcResult.error.code, svcResult.error.message));
      return;
    }

    // Parse owner/repo from repositoryUrl, e.g. https://github.com/washmen/my-repo
    const url = svcResult.value.repositoryUrl;
    const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (!match) {
      res.status(400).json(problemDetails(400, 'INVALID_REPO_URL', `Cannot parse GitHub owner/repo from: ${url}`));
      return;
    }
    const [, owner, repo] = match as [string, string, string];

    const limit = Math.min(parseInt(String(req.query['limit'] ?? '10'), 10), 50);
    const page  = Math.max(1, parseInt(String(req.query['page']  ?? '1'),  10));

    const client = new GitHubClient();
    const runsResult = await client.listWorkflowRuns(owner, repo, { per_page: limit, page });
    if (!runsResult.ok) {
      res.status(500).json(problemDetails(500, runsResult.error.code, runsResult.error.message));
      return;
    }

    const items = runsResult.value.items.map((run) => ({
      runId:           run.id,
      workflowName:    run.name,
      status:          run.status,
      conclusion:      run.conclusion,
      environment:     branchToEnvironment(run.headBranch),
      branch:          run.headBranch,
      sha:             run.headSha,
      startedAt:       run.createdAt,
      completedAt:     run.updatedAt,
      durationSeconds: run.conclusion
        ? Math.round((new Date(run.updatedAt).getTime() - new Date(run.createdAt).getTime()) / 1000)
        : null,
      htmlUrl:         run.htmlUrl,
      actor:           run.actor,
      headCommitMessage: run.headCommitMessage,
    }));

    res.json({ items, totalCount: runsResult.value.totalCount, page, limit });
  });

  // GET /services/:serviceId/capacity — real CloudWatch CPU + Memory for ECS services
  router.get('/services/:serviceId/capacity', async (req: Request, res: Response) => {
    const serviceId = String(req.params['serviceId']);

    const svcResult = await handlers.getService.execute(serviceId);
    if (!svcResult.ok) {
      res.status(500).json(problemDetails(500, 'Error', svcResult.error.message));
      return;
    }
    if (!svcResult.value) {
      res.status(404).json(problemDetails(404, 'Not Found', 'Service not found'));
      return;
    }

    const service = svcResult.value;
    const region = process.env['AWS_REGION'] ?? 'me-south-1';
    const cwClient = new CloudWatchClient({ region, credentials: credentialStore.getProvider() });

    const endTime   = new Date();
    const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
    const PERIOD    = 300; // 5-minute resolution

    // Collect ECS and Lambda resources across environments
    interface EcsTarget    { type: 'ecs';    environment: string; clusterName: string; serviceName: string }
    interface LambdaTarget { type: 'lambda'; environment: string; functionName: string }
    type ResourceTarget = EcsTarget | LambdaTarget;

    const targets: ResourceTarget[] = [];
    for (const [env, resources] of Object.entries(service.awsResources)) {
      for (const r of resources) {
        if (r.resourceType === 'ECS_SERVICE' && r.clusterName && r.identifier) {
          targets.push({ type: 'ecs', environment: env, clusterName: r.clusterName, serviceName: r.identifier });
        }
        if (r.resourceType === 'LAMBDA' && r.identifier) {
          targets.push({ type: 'lambda', environment: env, functionName: r.identifier });
        }
      }
    }

    const results = await Promise.allSettled(
      targets.map(async (target, idx) => {
        const p = `r${idx}`;

        if (target.type === 'ecs') {
          const cwResp = await cwClient.send(new GetMetricDataCommand({
            StartTime: startTime, EndTime: endTime, ScanBy: 'TimestampAscending',
            MetricDataQueries: [
              {
                Id: `${p}cpu`,
                MetricStat: {
                  Metric: { Namespace: 'AWS/ECS', MetricName: 'CPUUtilization',
                    Dimensions: [{ Name: 'ClusterName', Value: target.clusterName }, { Name: 'ServiceName', Value: target.serviceName }] },
                  Period: PERIOD, Stat: 'Average',
                },
                ReturnData: true,
              },
              {
                Id: `${p}mem`,
                MetricStat: {
                  Metric: { Namespace: 'AWS/ECS', MetricName: 'MemoryUtilization',
                    Dimensions: [{ Name: 'ClusterName', Value: target.clusterName }, { Name: 'ServiceName', Value: target.serviceName }] },
                  Period: PERIOD, Stat: 'Average',
                },
                ReturnData: true,
              },
            ],
          }));

          const tsMap = new Map<number, { cpu: number | null; memory: number | null }>();
          for (const r of cwResp.MetricDataResults ?? []) {
            for (let i = 0; i < (r.Timestamps?.length ?? 0); i++) {
              const ts = r.Timestamps![i]!.getTime();
              const v  = r.Values![i] ?? null;
              const ex = tsMap.get(ts) ?? { cpu: null, memory: null };
              if (r.Id === `${p}cpu`) ex.cpu = v !== null ? parseFloat(v.toFixed(2)) : null;
              if (r.Id === `${p}mem`) ex.memory = v !== null ? parseFloat(v.toFixed(2)) : null;
              tsMap.set(ts, ex);
            }
          }

          const series = Array.from(tsMap.entries()).sort(([a], [b]) => a - b)
            .map(([ts, vals]) => ({ time: new Date(ts).toISOString(), cpu: vals.cpu, memory: vals.memory }));

          return {
            type: 'ecs' as const,
            environment: target.environment,
            name: target.serviceName,
            clusterName: target.clusterName,
            latestCpu:    [...series].reverse().find((s) => s.cpu    !== null)?.cpu    ?? null,
            latestMemory: [...series].reverse().find((s) => s.memory !== null)?.memory ?? null,
            series,
          };
        }

        // Lambda
        const dim = [{ Name: 'FunctionName', Value: target.functionName }];
        const cwResp = await cwClient.send(new GetMetricDataCommand({
          StartTime: startTime, EndTime: endTime, ScanBy: 'TimestampAscending',
          MetricDataQueries: [
            {
              Id: `${p}inv`,
              MetricStat: { Metric: { Namespace: 'AWS/Lambda', MetricName: 'Invocations', Dimensions: dim }, Period: PERIOD, Stat: 'Sum' },
              ReturnData: true,
            },
            {
              Id: `${p}thr`,
              MetricStat: { Metric: { Namespace: 'AWS/Lambda', MetricName: 'Throttles', Dimensions: dim }, Period: PERIOD, Stat: 'Sum' },
              ReturnData: true,
            },
            {
              Id: `${p}con`,
              MetricStat: { Metric: { Namespace: 'AWS/Lambda', MetricName: 'ConcurrentExecutions', Dimensions: dim }, Period: PERIOD, Stat: 'Maximum' },
              ReturnData: true,
            },
          ],
        }));

        const tsMap = new Map<number, { invocations: number | null; throttles: number | null; concurrency: number | null }>();
        for (const r of cwResp.MetricDataResults ?? []) {
          for (let i = 0; i < (r.Timestamps?.length ?? 0); i++) {
            const ts = r.Timestamps![i]!.getTime();
            const v  = r.Values![i] ?? null;
            const ex = tsMap.get(ts) ?? { invocations: null, throttles: null, concurrency: null };
            if (r.Id === `${p}inv`) ex.invocations = v !== null ? Math.round(v) : null;
            if (r.Id === `${p}thr`) ex.throttles   = v !== null ? Math.round(v) : null;
            if (r.Id === `${p}con`) ex.concurrency = v !== null ? Math.round(v) : null;
            tsMap.set(ts, ex);
          }
        }

        const series = Array.from(tsMap.entries()).sort(([a], [b]) => a - b)
          .map(([ts, vals]) => ({ time: new Date(ts).toISOString(), invocations: vals.invocations, throttles: vals.throttles, concurrency: vals.concurrency }));

        const rev = [...series].reverse();
        return {
          type: 'lambda' as const,
          environment: target.environment,
          name: target.functionName,
          latestInvocations: rev.find((s) => s.invocations !== null)?.invocations ?? null,
          latestThrottles:   rev.find((s) => s.throttles   !== null)?.throttles   ?? null,
          latestConcurrency: rev.find((s) => s.concurrency !== null)?.concurrency ?? null,
          series,
        };
      }),
    );

    const resources = results
      .filter((r): r is PromiseFulfilledResult<typeof r extends PromiseFulfilledResult<infer V> ? V : never> => r.status === 'fulfilled')
      .map((r) => r.value);

    res.json({ serviceId, resources });
  });

  return router;
}
