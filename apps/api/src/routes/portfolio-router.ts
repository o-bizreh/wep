/**
 * GET / POST /api/v1/portfolio/*
 *
 * Endpoints powering six AWS-utilization features:
 *   - dependency map  (Lambda/ECS → AWS resources, by env-var/ARN scanning)
 *   - coupling detector  (services in a cluster sharing infra)
 *   - rightsizing recommendations (ECS / Lambda / RDS / DynamoDB)
 *   - period-over-period cost comparison
 *   - executive summary aggregator
 *   - custom budgets (CRUD, persisted in cost-intelligence DynamoDB table)
 */
import { Router, type Request, type Response } from 'express';
import {
  ECSClient,
  ListClustersCommand,
  ListServicesCommand,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  LambdaClient,
  ListFunctionsCommand,
  GetFunctionCommand,
  CloudWatchClient,
  GetMetricDataCommand,
  type MetricDataQuery,
  RDSClient,
  DescribeDBInstancesCommand,
  DynamoDBClient,
  ListTablesCommand,
  CostExplorerClient,
  GetCostAndUsageCommand,
  ResourceGroupsTaggingAPIClient,
  GetResourcesCommand,
  STSClient,
  GetCallerIdentityCommand,
  BudgetsClient,
  DescribeBudgetsCommand,
  type DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  DeleteCommand,
  regionStore,
  credentialStore,
} from '@wep/aws-clients';
import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { problemDetails } from '@wep/domain-types';
import { responseCache } from '../services/response-cache.js';
import { cloudwatchSemaphore, costExplorerSemaphore, ecsSemaphore } from '../services/aws-throttle.js';

const CE_REGION = 'us-east-1';

function err500(res: Response, message: string): void {
  res.status(500).json(problemDetails(500, 'AWS Error', message));
}

function lastName(arn: string): string {
  return arn.split(/[/:]/g).pop() ?? arn;
}

// ---------------------------------------------------------------------------
// Dependency-map env-var scanning (ported from aws-utilization-portal)
// ---------------------------------------------------------------------------

export interface ResourceDependency {
  sourceId: string;
  sourceName: string;
  sourceService: 'Lambda' | 'ECS';
  targetId: string;
  targetName: string;
  targetService: string;
  connectionType: 'env-var' | 'trigger' | 'resource-policy';
  detail: string;
}

function arnToServiceLabel(awsService: string): string {
  const map: Record<string, string> = {
    dynamodb: 'DynamoDB', sqs: 'SQS', kinesis: 'Kinesis',
    sns: 'SNS', s3: 'S3', kafka: 'MSK', mq: 'MQ',
    rds: 'RDS', elasticache: 'ElastiCache', redshift: 'Redshift',
    lambda: 'Lambda', ecs: 'ECS', ec2: 'EC2',
    events: 'EventBridge', apigateway: 'API Gateway',
    secretsmanager: 'Secrets Manager', ssm: 'SSM',
  };
  return map[awsService] ?? awsService;
}

function scanEnvVars(
  envVars: Record<string, string>,
  sourceId: string,
  sourceName: string,
  sourceService: 'Lambda' | 'ECS',
): ResourceDependency[] {
  const deps: ResourceDependency[] = [];
  const seen = new Set<string>();

  function addDep(targetId: string, targetName: string, targetService: string, detail: string) {
    const key = `${sourceId}->${targetService}:${targetName}`;
    if (seen.has(key)) return;
    seen.add(key);
    deps.push({ sourceId, sourceName, sourceService, targetId, targetName, targetService, connectionType: 'env-var', detail });
  }

  for (const [key, value] of Object.entries(envVars)) {
    if (!value) continue;

    const arnMatch = value.match(/arn:aws:([a-z0-9-]+):[a-z0-9-]*:\d*:(.+)/);
    if (arnMatch) {
      const awsService = arnMatch[1] ?? '';
      const resourcePath = arnMatch[2] ?? '';
      const targetService = arnToServiceLabel(awsService);
      const resourceName = resourcePath.split('/').pop()?.split(':').pop() ?? resourcePath;
      addDep(value, resourceName, targetService, key);
      continue;
    }

    const rdsMatch = value.match(/([\w-]+)\.([\w-]+)\.rds\.amazonaws\.com/);
    if (rdsMatch) { addDep(value, rdsMatch[1] ?? value, 'RDS', key); continue; }

    if (value.match(/[\w.-]+\.cache\.amazonaws\.com/)) {
      addDep(value, value.split('.')[0] ?? value, 'ElastiCache', key);
      continue;
    }

    const redshiftMatch = value.match(/([\w-]+)\.[\w-]+\.redshift\.amazonaws\.com/);
    if (redshiftMatch) { addDep(value, redshiftMatch[1] ?? value, 'Redshift', key); continue; }

    if (['TABLE', 'DYNAMO', 'DDB'].some((dk) => key.toUpperCase().includes(dk)) && !value.includes(' ') && !value.startsWith('http')) {
      addDep(value, value, 'DynamoDB', key);
      continue;
    }

    if (key.toUpperCase().includes('BUCKET') && !value.includes(' ') && !value.startsWith('http')) {
      addDep(value, value, 'S3', key);
      continue;
    }

    if (value.match(/https:\/\/sqs\.[a-z0-9-]+\.amazonaws\.com\/\d+\/[\w.-]+/)) {
      const queueName = value.split('/').pop() ?? value;
      addDep(value, queueName, 'SQS', key);
      continue;
    }

    if (value.includes('.elb.') && value.includes('amazonaws.com')) {
      const stripped = value.replace(/^[a-z]+:\/\//, '');
      const hostPort = stripped.split('/')[0] ?? '';
      const hostname = hostPort.split(':')[0] ?? '';
      const port = hostPort.includes(':') ? hostPort.split(':')[1] ?? '' : '';
      const serviceName = key
        .replace(/^SRV_/i, '')
        .replace(/_BACKEND_URL$/i, '')
        .replace(/_URL$/i, '')
        .replace(/_HOST$/i, '')
        .replace(/_ENDPOINT$/i, '')
        .replace(/_/g, '-')
        .toLowerCase();
      const targetName = serviceName || (hostname.split('.')[0] ?? hostname);
      const portSuffix = port ? `:${port}` : '';
      const dedupKey = `${sourceId}->ELB:${targetName}:${port}`;
      if (!seen.has(dedupKey)) {
        seen.add(dedupKey);
        deps.push({
          sourceId, sourceName, sourceService,
          targetId: `${hostname}${portSuffix}`,
          targetName,
          targetService: 'ELB (Service)',
          connectionType: 'env-var',
          detail: `${key} → ${hostname}${portSuffix}`,
        });
      }
    }
  }

  return deps;
}

// ---------------------------------------------------------------------------
// Recommendations (rightsizing heuristics)
// ---------------------------------------------------------------------------

export interface Recommendation {
  id: string;
  type: 'rightsize' | 'memory' | 'billing-mode' | 'unused';
  severity: 'high' | 'medium' | 'low';
  service: 'Lambda' | 'ECS' | 'RDS' | 'DynamoDB';
  resourceId: string;
  resourceName: string;
  title: string;
  description: string;
  currentConfig: string;
  recommendedConfig: string;
  estimatedMonthlySavings: number;
  estimatedAnnualSavings: number;
  monthlyCost?: number;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}
function p99(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(Math.ceil(sorted.length * 0.99) - 1, sorted.length - 1);
  return sorted[idx] ?? 0;
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export interface PortfolioRouterDeps {
  dynamoDocClient: DynamoDBDocumentClient;
  costTableName: string;
}

export function createPortfolioRouter(deps: PortfolioRouterDeps): Router {
  const router = Router();
  const regionProvider      = regionStore.getProvider();
  const credentialsProvider = credentialStore.getProvider();
  const ecsClient     = new ECSClient({ region: regionProvider, credentials: credentialsProvider });
  const lambdaClient  = new LambdaClient({ region: regionProvider, credentials: credentialsProvider });
  const cwClient      = new CloudWatchClient({ region: regionProvider, credentials: credentialsProvider });
  const rdsClient     = new RDSClient({ region: regionProvider, credentials: credentialsProvider });
  const ddbClient     = new DynamoDBClient({ region: regionProvider, credentials: credentialsProvider });
  const taggingClient = new ResourceGroupsTaggingAPIClient({ region: regionProvider, credentials: credentialsProvider });

  // ── DEPENDENCIES ─────────────────────────────────────────────────────────

  // GET /portfolio/dependencies/lambda — cached 5 min
  router.get('/dependencies/lambda', async (_req: Request, res: Response) => {
    try {
      const result = await responseCache.getOrLoad(
        'portfolio:dependencies:lambda',
        { ttlMs: 5 * 60_000 },
        async () => {
          const all: Array<{ name: string; arn: string; runtime: string; envCount: number }> = [];
          const dependencies: ResourceDependency[] = [];
          let marker: string | undefined;

          const fnSnapshots: Array<{ name: string; arn: string; runtime: string; env: Record<string, string> }> = [];
          do {
            const resp = await lambdaClient.send(new ListFunctionsCommand({ Marker: marker, MaxItems: 50 }));
            for (const fn of resp.Functions ?? []) {
              if (!fn.FunctionName || !fn.FunctionArn) continue;
              const env = (fn.Environment?.Variables ?? {}) as Record<string, string>;
              fnSnapshots.push({ name: fn.FunctionName, arn: fn.FunctionArn, runtime: fn.Runtime ?? '', env });
            }
            marker = resp.NextMarker;
          } while (marker);

          for (const fn of fnSnapshots) {
            const envEntries = Object.entries(fn.env);
            all.push({ name: fn.name, arn: fn.arn, runtime: fn.runtime, envCount: envEntries.length });
            dependencies.push(...scanEnvVars(fn.env, fn.arn, fn.name, 'Lambda'));
          }

          return { functions: all, dependencies };
        },
      );
      res.json(result);
    } catch (e) {
      err500(res, e instanceof Error ? e.message : String(e));
    }
  });

  // GET /portfolio/dependencies/ecs?cluster=<arn> — cached 5 min per cluster
  router.get('/dependencies/ecs', async (req: Request, res: Response) => {
    const cluster = req.query['cluster'] as string | undefined;
    try {
      const result = await responseCache.getOrLoad(
        `portfolio:dependencies:ecs:${cluster ?? 'all'}`,
        { ttlMs: 5 * 60_000 },
        async () => {
      const services: Array<{ name: string; arn: string; cluster: string; taskDef: string }> = [];
      const dependencies: ResourceDependency[] = [];

      const clusterArns: string[] = [];
      if (cluster) {
        clusterArns.push(cluster);
      } else {
        let token: string | undefined;
        do {
          const resp = await ecsClient.send(new ListClustersCommand({ nextToken: token, maxResults: 100 }));
          clusterArns.push(...(resp.clusterArns ?? []));
          token = resp.nextToken;
        } while (token);
      }

      // Step 1: list services per cluster
      const serviceArnsByCluster = new Map<string, string[]>();
      await Promise.all(clusterArns.map(async (clusterArn) => {
        const arns: string[] = [];
        let token: string | undefined;
        do {
          const resp = await ecsSemaphore.run(() => ecsClient.send(new ListServicesCommand({ cluster: clusterArn, nextToken: token, maxResults: 100 })));
          arns.push(...(resp.serviceArns ?? []));
          token = resp.nextToken;
        } while (token);
        serviceArnsByCluster.set(clusterArn, arns);
      }));

      // Step 2: describe services to get task definitions
      for (const [clusterArn, arns] of serviceArnsByCluster.entries()) {
        // DescribeServices accepts up to 10 at a time
        for (let i = 0; i < arns.length; i += 10) {
          const batch = arns.slice(i, i + 10);
          if (batch.length === 0) continue;
          const resp = await ecsSemaphore.run(() => ecsClient.send(new DescribeServicesCommand({ cluster: clusterArn, services: batch })));
          for (const svc of resp.services ?? []) {
            if (!svc.serviceArn || !svc.serviceName) continue;
            services.push({ name: svc.serviceName, arn: svc.serviceArn, cluster: lastName(clusterArn), taskDef: svc.taskDefinition ?? '' });
          }
        }
      }

      // Step 3: describe task definitions and scan env vars
      const taskDefCache = new Map<string, Record<string, string>>();
      await Promise.all(services.map(async (svc) => {
        if (!svc.taskDef) return;
        if (taskDefCache.has(svc.taskDef)) return;
        try {
          const resp = await ecsClient.send(new DescribeTaskDefinitionCommand({ taskDefinition: svc.taskDef }));
          const env: Record<string, string> = {};
          for (const c of resp.taskDefinition?.containerDefinitions ?? []) {
            for (const e of c.environment ?? []) {
              if (e.name && e.value) env[e.name] = e.value;
            }
          }
          taskDefCache.set(svc.taskDef, env);
        } catch { taskDefCache.set(svc.taskDef, {}); }
      }));

      for (const svc of services) {
        const env = svc.taskDef ? (taskDefCache.get(svc.taskDef) ?? {}) : {};
        dependencies.push(...scanEnvVars(env, svc.arn, svc.name, 'ECS'));
      }

          return { services, dependencies };
        },
      );
      res.json(result);
    } catch (e) {
      err500(res, e instanceof Error ? e.message : String(e));
    }
  });

  // ── COUPLING ─────────────────────────────────────────────────────────────

  // GET /portfolio/coupling/clusters/:cluster — cached 5 min
  router.get('/coupling/clusters/:cluster', async (req: Request, res: Response) => {
    const cluster = String(req.params['cluster'] ?? '');
    if (!cluster) { res.status(400).json(problemDetails(400, 'Bad Request', 'cluster required')); return; }
    try {
      const result = await responseCache.getOrLoad(
        `portfolio:coupling:${cluster}`,
        { ttlMs: 5 * 60_000 },
        async () => {
      const services: Array<{ name: string; arn: string; taskDef: string }> = [];
      let token: string | undefined;
      do {
        const resp = await ecsClient.send(new ListServicesCommand({ cluster, nextToken: token, maxResults: 100 }));
        for (const arn of resp.serviceArns ?? []) services.push({ name: lastName(arn), arn, taskDef: '' });
        token = resp.nextToken;
      } while (token);

      // Describe to get task defs and port mappings
      const taskDefByName = new Map<string, string>();
      const portToService = new Map<string, string>();
      for (let i = 0; i < services.length; i += 10) {
        const batch = services.slice(i, i + 10);
        if (batch.length === 0) continue;
        const resp = await ecsClient.send(new DescribeServicesCommand({ cluster, services: batch.map((s) => s.arn) }));
        for (const svc of resp.services ?? []) {
          if (!svc.serviceName) continue;
          taskDefByName.set(svc.serviceName, svc.taskDefinition ?? '');
        }
      }

      // Pull task defs in parallel and gather env + port-map
      const envByService = new Map<string, Record<string, string>>();
      await Promise.all(services.map(async (svc) => {
        const td = taskDefByName.get(svc.name);
        if (!td) return;
        try {
          const resp = await ecsClient.send(new DescribeTaskDefinitionCommand({ taskDefinition: td }));
          const env: Record<string, string> = {};
          for (const c of resp.taskDefinition?.containerDefinitions ?? []) {
            for (const e of c.environment ?? []) {
              if (e.name === 'PORT' && e.value) portToService.set(e.value, svc.name);
              if (e.name && e.value) env[e.name] = e.value;
            }
            for (const pm of c.portMappings ?? []) {
              if (pm.containerPort) portToService.set(String(pm.containerPort), svc.name);
            }
          }
          envByService.set(svc.name, env);
        } catch { /* ignore */ }
      }));

      const couplings: Array<{ source: string; target: string; type: string; detail: string; port?: string }> = [];
      const dependsOnMap: Record<string, Set<string>> = {};
      const dependedByMap: Record<string, Set<string>> = {};
      for (const svc of services) { dependsOnMap[svc.name] = new Set(); dependedByMap[svc.name] = new Set(); }

      for (const svc of services) {
        const env = envByService.get(svc.name) ?? {};
        const deps = scanEnvVars(env, svc.arn, svc.name, 'ECS');
        for (const dep of deps) {
          if (dep.targetService === 'ELB (Service)') {
            const port = dep.targetId.includes(':') ? dep.targetId.split(':').pop() ?? '' : '';
            let resolved = port ? portToService.get(port) : undefined;
            if (!resolved) {
              const targetLower = dep.targetName.toLowerCase();
              const exact = services.find((s) => {
                const segments = s.name.toLowerCase().split('-');
                return segments.includes(targetLower) || s.name.toLowerCase() === targetLower;
              });
              resolved = exact?.name;
            }
            if (resolved === svc.name) continue;
            const display = resolved ?? `${dep.targetName} (unmatched)`;
            couplings.push({ source: svc.name, target: display, type: dep.targetService, detail: dep.detail, port: port || undefined });
            dependsOnMap[svc.name]?.add(display);
            (dependedByMap[display] ??= new Set()).add(svc.name);
          } else {
            couplings.push({ source: svc.name, target: dep.targetName, type: dep.targetService, detail: dep.detail });
            dependsOnMap[svc.name]?.add(dep.targetName);
            (dependedByMap[dep.targetName] ??= new Set()).add(svc.name);
          }
        }
      }

      const dependsOn: Record<string, string[]> = {};
      const dependedBy: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(dependsOnMap)) if (v.size) dependsOn[k] = [...v];
      for (const [k, v] of Object.entries(dependedByMap)) if (v.size) dependedBy[k] = [...v];

          return {
            clusterName: lastName(cluster),
            services: services.map((s) => s.name),
            couplings,
            dependsOn,
            dependedBy,
          };
        },
      );
      res.json(result);
    } catch (e) {
      err500(res, e instanceof Error ? e.message : String(e));
    }
  });

  // ── RECOMMENDATIONS ──────────────────────────────────────────────────────

  // GET /portfolio/recommendations[?service=lambda|ecs|rds|dynamodb]
  // Cached 15 min per service-set (CloudWatch metrics are slow-changing and the
  // endpoint fans out dozens of AWS calls). The optional `service` filter lets
  // the UI scan one service at a time so users aren't blocked on a 30 s+ cold
  // load when they only care about, say, Lambda.
  router.get('/recommendations', async (req: Request, res: Response) => {
    try {
      const allServices = ['lambda', 'ecs', 'rds', 'dynamodb'] as const;
      type SvcKey = typeof allServices[number];
      const param = (req.query['service'] as string | undefined)?.toLowerCase();
      const services = new Set<SvcKey>(
        param && allServices.includes(param as SvcKey)
          ? [param as SvcKey]
          : allServices,
      );
      const cacheKey = `portfolio:recommendations:${[...services].sort().join(',')}`;

      const result = await responseCache.getOrLoad(
        cacheKey,
        { ttlMs: 15 * 60_000 },
        async () => {
      const recs: Recommendation[] = [];
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 7 * 86400 * 1000);

      if (services.has('lambda')) {
      // Lambda
      const fns: Array<{ name: string; arn: string; memory: number; timeout: number; runtime: string }> = [];
      let marker: string | undefined;
      do {
        const resp = await lambdaClient.send(new ListFunctionsCommand({ Marker: marker, MaxItems: 50 }));
        for (const fn of resp.Functions ?? []) {
          if (fn.FunctionName && fn.FunctionArn) {
            fns.push({
              name: fn.FunctionName,
              arn: fn.FunctionArn,
              memory: fn.MemorySize ?? 128,
              timeout: fn.Timeout ?? 3,
              runtime: fn.Runtime ?? '',
            });
          }
        }
        marker = resp.NextMarker;
      } while (marker);

      // Batch fetch invocations + duration in groups of 50 metric queries (CW limit 500)
      for (let i = 0; i < fns.length; i += 50) {
        const batch = fns.slice(i, i + 50);
        const queries: MetricDataQuery[] = [];
        batch.forEach((fn, idx) => {
          queries.push({
            Id: `inv${idx}`,
            MetricStat: {
              Metric: { Namespace: 'AWS/Lambda', MetricName: 'Invocations', Dimensions: [{ Name: 'FunctionName', Value: fn.name }] },
              Period: 86400,
              Stat: 'Sum',
            },
            ReturnData: true,
          });
          queries.push({
            Id: `dur${idx}`,
            MetricStat: {
              Metric: { Namespace: 'AWS/Lambda', MetricName: 'Duration', Dimensions: [{ Name: 'FunctionName', Value: fn.name }] },
              Period: 86400,
              Stat: 'Average',
            },
            ReturnData: true,
          });
        });
        try {
          const resp = await cloudwatchSemaphore.run(() => cwClient.send(new GetMetricDataCommand({
            MetricDataQueries: queries,
            StartTime: startTime, EndTime: endTime,
          })));
          const map = new Map<string, number[]>();
          for (const r of resp.MetricDataResults ?? []) {
            if (r.Id) map.set(r.Id, r.Values ?? []);
          }
          batch.forEach((fn, idx) => {
            const inv = map.get(`inv${idx}`) ?? [];
            const dur = map.get(`dur${idx}`) ?? [];
            const totalInv = inv.reduce((s, v) => s + v, 0);
            const avgDur = avg(dur);
            const monthlyCost = (fn.memory / 1024) * 0.0000166667 * Math.max(totalInv, 0) * 4.3 / 7; // crude

            if (totalInv === 0 && fn.memory > 128) {
              recs.push({
                id: `lambda-unused-${fn.name}`,
                type: 'unused', severity: 'low', service: 'Lambda',
                resourceId: fn.arn, resourceName: fn.name,
                title: `Lambda "${fn.name}" has no recent invocations`,
                description: `Zero invocations over the last 7 days. Reduce memory or remove if unused.`,
                currentConfig: `${fn.memory} MB · ${fn.runtime}`,
                recommendedConfig: '128 MB (minimum)',
                estimatedMonthlySavings: monthlyCost,
                estimatedAnnualSavings: monthlyCost * 12,
                monthlyCost,
              });
            } else if (avgDur > 0 && avgDur < fn.timeout * 1000 * 0.1 && fn.memory > 256) {
              const suggestedMemory = Math.max(128, Math.floor(fn.memory / 2));
              recs.push({
                id: `lambda-memory-${fn.name}`,
                type: 'memory', severity: 'low', service: 'Lambda',
                resourceId: fn.arn, resourceName: fn.name,
                title: `Lambda "${fn.name}" may be over-provisioned`,
                description: `Avg duration ${avgDur.toFixed(0)}ms with ${fn.memory}MB memory. Consider reducing memory.`,
                currentConfig: `${fn.memory} MB`,
                recommendedConfig: `${suggestedMemory} MB`,
                estimatedMonthlySavings: monthlyCost * 0.3,
                estimatedAnnualSavings: monthlyCost * 0.3 * 12,
                monthlyCost,
              });
            }
          });
        } catch { /* skip batch */ }
      }
      } // end lambda

      if (services.has('ecs')) {
      // ECS
      const clusterArns: string[] = [];
      let cToken: string | undefined;
      do {
        const resp = await ecsClient.send(new ListClustersCommand({ nextToken: cToken, maxResults: 100 }));
        clusterArns.push(...(resp.clusterArns ?? []));
        cToken = resp.nextToken;
      } while (cToken);

      const ecsTargets: Array<{ name: string; arn: string; cluster: string; cpu: string; memory: string; desired: number }> = [];
      for (const cluster of clusterArns) {
        const arns: string[] = [];
        let sToken: string | undefined;
        do {
          const resp = await ecsClient.send(new ListServicesCommand({ cluster, nextToken: sToken, maxResults: 100 }));
          arns.push(...(resp.serviceArns ?? []));
          sToken = resp.nextToken;
        } while (sToken);
        for (let i = 0; i < arns.length; i += 10) {
          const batch = arns.slice(i, i + 10);
          if (batch.length === 0) continue;
          const resp = await ecsClient.send(new DescribeServicesCommand({ cluster, services: batch }));
          for (const svc of resp.services ?? []) {
            if (!svc.serviceArn || !svc.serviceName) continue;
            if ((svc.desiredCount ?? 0) === 0) continue;
            // Best-effort task def lookup for cpu/memory
            let cpu = '', memory = '';
            if (svc.taskDefinition) {
              try {
                const td = await ecsClient.send(new DescribeTaskDefinitionCommand({ taskDefinition: svc.taskDefinition }));
                cpu = td.taskDefinition?.cpu ?? '';
                memory = td.taskDefinition?.memory ?? '';
              } catch { /* ignore */ }
            }
            ecsTargets.push({
              name: svc.serviceName,
              arn: svc.serviceArn,
              cluster: lastName(cluster),
              cpu, memory,
              desired: svc.desiredCount ?? 0,
            });
          }
        }
      }

      for (let i = 0; i < ecsTargets.length; i += 50) {
        const batch = ecsTargets.slice(i, i + 50);
        const queries: MetricDataQuery[] = [];
        batch.forEach((svc, idx) => {
          queries.push({
            Id: `ecpu${idx}`,
            MetricStat: {
              Metric: { Namespace: 'AWS/ECS', MetricName: 'CPUUtilization', Dimensions: [
                { Name: 'ServiceName', Value: svc.name }, { Name: 'ClusterName', Value: svc.cluster },
              ] },
              Period: 3600, Stat: 'Average',
            },
            ReturnData: true,
          });
          queries.push({
            Id: `emem${idx}`,
            MetricStat: {
              Metric: { Namespace: 'AWS/ECS', MetricName: 'MemoryUtilization', Dimensions: [
                { Name: 'ServiceName', Value: svc.name }, { Name: 'ClusterName', Value: svc.cluster },
              ] },
              Period: 3600, Stat: 'Average',
            },
            ReturnData: true,
          });
        });
        try {
          const resp = await cloudwatchSemaphore.run(() => cwClient.send(new GetMetricDataCommand({
            MetricDataQueries: queries, StartTime: startTime, EndTime: endTime,
          })));
          const map = new Map<string, number[]>();
          for (const r of resp.MetricDataResults ?? []) if (r.Id) map.set(r.Id, r.Values ?? []);
          batch.forEach((svc, idx) => {
            const cpuVals = map.get(`ecpu${idx}`) ?? [];
            const memVals = map.get(`emem${idx}`) ?? [];
            if (cpuVals.length === 0) return;
            const avgCpu = avg(cpuVals); const avgMem = avg(memVals); const p99Cpu = p99(cpuVals);
            const currentCpu = parseFloat(svc.cpu) || 256;
            const currentMem = parseFloat(svc.memory) || 512;
            if (avgCpu < 5 && avgMem < 10) {
              recs.push({
                id: `ecs-underutilized-${svc.cluster}-${svc.name}`,
                type: 'rightsize', severity: 'high', service: 'ECS',
                resourceId: svc.arn, resourceName: svc.name,
                title: `ECS service "${svc.name}" is significantly underutilized`,
                description: `Avg CPU ${avgCpu.toFixed(1)}%, memory ${avgMem.toFixed(1)}%. Consider reducing CPU/memory.`,
                currentConfig: `${svc.cpu} CPU · ${svc.memory} MB · ${svc.desired} tasks`,
                recommendedConfig: `${Math.max(256, currentCpu / 2)} CPU · ${Math.max(512, currentMem / 2)} MB`,
                estimatedMonthlySavings: 0,
                estimatedAnnualSavings: 0,
              });
            } else if (p99Cpu < 20 && p99Cpu > 0) {
              recs.push({
                id: `ecs-rightsize-${svc.cluster}-${svc.name}`,
                type: 'rightsize', severity: 'medium', service: 'ECS',
                resourceId: svc.arn, resourceName: svc.name,
                title: `ECS service "${svc.name}" is over-provisioned`,
                description: `P99 CPU ${p99Cpu.toFixed(1)}%. Consider reducing CPU.`,
                currentConfig: `${svc.cpu} CPU · ${svc.memory} MB`,
                recommendedConfig: `${Math.max(256, currentCpu / 2)} CPU · ${svc.memory} MB`,
                estimatedMonthlySavings: 0,
                estimatedAnnualSavings: 0,
              });
            }
          });
        } catch { /* skip */ }
      }
      } // end ecs

      if (services.has('rds')) {
      // RDS
      try {
        const dbs: Array<{ id: string; name: string; arn: string; cls: string; status: string }> = [];
        let dbToken: string | undefined;
        do {
          const resp = await rdsClient.send(new DescribeDBInstancesCommand({ Marker: dbToken }));
          for (const db of resp.DBInstances ?? []) {
            if (db.DBInstanceIdentifier && db.DBInstanceArn) {
              dbs.push({
                id: db.DBInstanceIdentifier,
                name: db.DBInstanceIdentifier,
                arn: db.DBInstanceArn,
                cls: db.DBInstanceClass ?? '',
                status: db.DBInstanceStatus ?? '',
              });
            }
          }
          dbToken = resp.Marker;
        } while (dbToken);

        for (let i = 0; i < dbs.length; i += 50) {
          const batch = dbs.slice(i, i + 50);
          const queries: MetricDataQuery[] = [];
          batch.forEach((db, idx) => {
            queries.push({
              Id: `rcpu${idx}`,
              MetricStat: {
                Metric: { Namespace: 'AWS/RDS', MetricName: 'CPUUtilization', Dimensions: [{ Name: 'DBInstanceIdentifier', Value: db.id }] },
                Period: 3600, Stat: 'Average',
              },
              ReturnData: true,
            });
          });
          try {
            const resp = await cwClient.send(new GetMetricDataCommand({
              MetricDataQueries: queries, StartTime: startTime, EndTime: endTime,
            }));
            const map = new Map<string, number[]>();
            for (const r of resp.MetricDataResults ?? []) if (r.Id) map.set(r.Id, r.Values ?? []);
            batch.forEach((db, idx) => {
              if (db.status !== 'available') return;
              const vals = map.get(`rcpu${idx}`) ?? [];
              if (vals.length === 0) return;
              const avgCpu = avg(vals); const p99Cpu = p99(vals);
              if (avgCpu < 5) {
                recs.push({
                  id: `rds-underutilized-${db.name}`,
                  type: 'rightsize', severity: 'high', service: 'RDS',
                  resourceId: db.arn, resourceName: db.name,
                  title: `RDS instance "${db.name}" is significantly underutilized`,
                  description: `Avg CPU ${avgCpu.toFixed(1)}%. Consider downsizing the instance class.`,
                  currentConfig: db.cls, recommendedConfig: 'Smaller instance class',
                  estimatedMonthlySavings: 0,
                  estimatedAnnualSavings: 0,
                });
              } else if (p99Cpu < 20 && p99Cpu > 0) {
                recs.push({
                  id: `rds-rightsize-${db.name}`,
                  type: 'rightsize', severity: 'medium', service: 'RDS',
                  resourceId: db.arn, resourceName: db.name,
                  title: `RDS instance "${db.name}" is over-provisioned`,
                  description: `P99 CPU ${p99Cpu.toFixed(1)}%. Consider downsizing.`,
                  currentConfig: db.cls, recommendedConfig: 'Smaller instance class',
                  estimatedMonthlySavings: 0,
                  estimatedAnnualSavings: 0,
                });
              }
            });
          } catch { /* skip */ }
        }
      } catch { /* RDS unavailable */ }
      } // end rds

      if (services.has('dynamodb')) {
      // DynamoDB billing-mode recommendation
      try {
        const tables: string[] = [];
        let tToken: string | undefined;
        do {
          const resp = await ddbClient.send(new ListTablesCommand({ ExclusiveStartTableName: tToken, Limit: 100 }));
          tables.push(...(resp.TableNames ?? []));
          tToken = resp.LastEvaluatedTableName;
        } while (tToken);

        for (const tableName of tables) {
          try {
            const desc = await ddbClient.send(new DescribeTableCommand({ TableName: tableName }));
            const t = desc.Table;
            const billingMode = t?.BillingModeSummary?.BillingMode ?? 'PROVISIONED';
            const rcu = t?.ProvisionedThroughput?.ReadCapacityUnits ?? 0;
            const wcu = t?.ProvisionedThroughput?.WriteCapacityUnits ?? 0;
            if (billingMode !== 'PROVISIONED' || rcu === 0) continue;

            const resp = await cloudwatchSemaphore.run(() => cwClient.send(new GetMetricDataCommand({
              StartTime: startTime, EndTime: endTime,
              MetricDataQueries: [
                { Id: 'r', MetricStat: { Metric: { Namespace: 'AWS/DynamoDB', MetricName: 'ConsumedReadCapacityUnits', Dimensions: [{ Name: 'TableName', Value: tableName }] }, Period: 3600, Stat: 'Average' }, ReturnData: true },
                { Id: 'w', MetricStat: { Metric: { Namespace: 'AWS/DynamoDB', MetricName: 'ConsumedWriteCapacityUnits', Dimensions: [{ Name: 'TableName', Value: tableName }] }, Period: 3600, Stat: 'Average' }, ReturnData: true },
              ],
            })));
            const r = resp.MetricDataResults?.find((x) => x.Id === 'r')?.Values ?? [];
            const w = resp.MetricDataResults?.find((x) => x.Id === 'w')?.Values ?? [];
            const avgRead = avg(r); const avgWrite = avg(w);
            if (avgRead < rcu * 0.2 && avgWrite < wcu * 0.2) {
              recs.push({
                id: `dynamodb-billing-${tableName}`,
                type: 'billing-mode',
                severity: avgRead < 1 && avgWrite < 1 ? 'high' : 'medium',
                service: 'DynamoDB',
                resourceId: t?.TableArn ?? tableName, resourceName: tableName,
                title: `DynamoDB table "${tableName}" may benefit from on-demand billing`,
                description: `Provisioned capacity is underutilized (avg read ${avgRead.toFixed(1)}/${rcu} RCU, avg write ${avgWrite.toFixed(1)}/${wcu} WCU).`,
                currentConfig: `PROVISIONED · ${rcu} RCU / ${wcu} WCU`,
                recommendedConfig: avgRead < 1 && avgWrite < 1 ? 'PAY_PER_REQUEST (on-demand)' : `Reduce to ${Math.max(1, Math.ceil(avgRead * 1.5))} RCU / ${Math.max(1, Math.ceil(avgWrite * 1.5))} WCU`,
                estimatedMonthlySavings: 0,
                estimatedAnnualSavings: 0,
              });
            }
          } catch { /* skip table */ }
        }
      } catch { /* DynamoDB unavailable */ }
      } // end dynamodb

          recs.sort((a, b) => b.estimatedMonthlySavings - a.estimatedMonthlySavings);
          return { recommendations: recs, generatedAt: new Date().toISOString() };
        },
      );
      res.json(result);
    } catch (e) {
      err500(res, e instanceof Error ? e.message : String(e));
    }
  });

  // ── COST COMPARISON ──────────────────────────────────────────────────────

  // GET /portfolio/cost-comparison — cached 30 min (Cost Explorer is 1 req/sec hard cap;
  // billing data updates a few times daily so a long TTL is safe)
  router.get('/cost-comparison', async (_req: Request, res: Response) => {
    try {
      const result = await responseCache.getOrLoad(
        'portfolio:cost-comparison',
        { ttlMs: 30 * 60_000 },
        async () => {
      const credentials = credentialStore.getProvider();
      const ce = new CostExplorerClient({ region: CE_REGION, credentials });
      const now = new Date();
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      const fmtMonth = (d: Date) => d.toISOString().slice(0, 7);

      const currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const currentEnd = now;
      const previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const previousEnd = new Date(now.getFullYear(), now.getMonth(), 0);

      // Edge case: on the 1st of the month, currentStart === currentEnd after
      // formatting to YYYY-MM-DD; Cost Explorer rejects empty ranges with
      // "Start date (and hour) should be before end date (and hour)".
      // Push End forward one day so the range is valid; the data for "today"
      // will just be empty.
      const ensureRange = (start: Date, end: Date): { start: string; end: string } => {
        let s = fmt(start);
        let e = fmt(end);
        if (e <= s) {
          const next = new Date(start);
          next.setDate(next.getDate() + 1);
          e = fmt(next);
        }
        return { start: s, end: e };
      };
      const cur = ensureRange(currentStart, currentEnd);
      const prev = ensureRange(previousStart, previousEnd);

      // Cost Explorer is hard-capped at ~1 req/sec; serialize via the semaphore.
      const curResp = await costExplorerSemaphore.run(() => ce.send(new GetCostAndUsageCommand({
        TimePeriod: { Start: cur.start, End: cur.end },
        Granularity: 'MONTHLY', GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }], Metrics: ['UnblendedCost'],
      })));
      const prevResp = await costExplorerSemaphore.run(() => ce.send(new GetCostAndUsageCommand({
        TimePeriod: { Start: prev.start, End: prev.end },
        Granularity: 'MONTHLY', GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }], Metrics: ['UnblendedCost'],
      })));

      const currentMap = new Map<string, number>();
      for (const g of curResp.ResultsByTime?.[0]?.Groups ?? []) {
        currentMap.set(g.Keys?.[0] ?? 'Other', parseFloat(g.Metrics?.['UnblendedCost']?.Amount ?? '0'));
      }
      const previousMap = new Map<string, number>();
      for (const g of prevResp.ResultsByTime?.[0]?.Groups ?? []) {
        previousMap.set(g.Keys?.[0] ?? 'Other', parseFloat(g.Metrics?.['UnblendedCost']?.Amount ?? '0'));
      }

      const allServices = new Set<string>([...currentMap.keys(), ...previousMap.keys()]);
      const byService = [...allServices].map((service) => {
        const current = currentMap.get(service) ?? 0;
        const previous = previousMap.get(service) ?? 0;
        const change = current - previous;
        const changePercentage = previous > 0 ? (change / previous) * 100 : current > 0 ? 100 : 0;
        return { service, currentMonthCost: current, previousMonthCost: previous, change, changePercentage };
      }).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

      const totalCurrent = byService.reduce((s, x) => s + x.currentMonthCost, 0);
      const totalPrevious = byService.reduce((s, x) => s + x.previousMonthCost, 0);
      const totalChange = totalCurrent - totalPrevious;
      const totalChangePercentage = totalPrevious > 0 ? (totalChange / totalPrevious) * 100 : totalCurrent > 0 ? 100 : 0;

          return {
            currentMonth: fmtMonth(currentStart),
            previousMonth: fmtMonth(previousStart),
            totalCurrent, totalPrevious, totalChange, totalChangePercentage,
            byService,
          };
        },
      );
      res.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('credentials') || msg.includes('UnrecognizedClient') || msg.includes('InvalidClientToken')) {
        res.json({ noCredentials: true });
        return;
      }
      err500(res, msg);
    }
  });

  // ── BUDGETS (custom, persisted) ──────────────────────────────────────────

  // Storage in cost-intelligence table:  PK=BUDGET, SK=BUDGET#<id>
  interface BudgetConfig {
    id: string;
    name: string;
    monthlyBudget: number;
    scope: 'service' | 'tag' | 'all';
    scopeValue: string; // service name, "tagKey:tagValue", or ""
    alertThreshold: number;
    notificationEmails: string[];
    createdAt: string;
  }

  // GET /portfolio/budgets/aws — pulls budgets directly from AWS Budgets service.
  // The AWS Budgets API is global (us-east-1 only) and requires the account ID.
  // Cached 10 min — budgets rarely change minute-to-minute.
  router.get('/budgets/aws', async (_req: Request, res: Response) => {
    try {
      const result = await responseCache.getOrLoad(
        'portfolio:budgets:aws',
        { ttlMs: 10 * 60_000 },
        async () => {
          const credentials = credentialStore.getProvider();
          const sts = new STSClient({ region: 'us-east-1', credentials });
          const account = await sts.send(new GetCallerIdentityCommand({}));
          const accountId = account.Account;
          if (!accountId) return { budgets: [] as Array<unknown> };

          const budgets = new BudgetsClient({ region: 'us-east-1', credentials });
          const resp = await budgets.send(new DescribeBudgetsCommand({ AccountId: accountId }));

          return {
            budgets: (resp.Budgets ?? []).map((b) => {
              const limit = parseFloat(b.BudgetLimit?.Amount ?? '0');
              const actualSpend = parseFloat(b.CalculatedSpend?.ActualSpend?.Amount ?? '0');
              const forecastedSpend = parseFloat(b.CalculatedSpend?.ForecastedSpend?.Amount ?? '0');
              const percentUsed = limit > 0 ? (actualSpend / limit) * 100 : 0;
              return {
                name: b.BudgetName ?? 'Unknown',
                type: b.BudgetType ?? 'COST',
                timeUnit: b.TimeUnit ?? 'MONTHLY',
                limit,
                currency: b.BudgetLimit?.Unit ?? 'USD',
                actualSpend,
                forecastedSpend,
                percentUsed,
                onTrack: forecastedSpend <= limit,
                startDate: b.TimePeriod?.Start?.toISOString() ?? null,
                endDate: b.TimePeriod?.End?.toISOString() ?? null,
              };
            }),
          };
        },
      );
      res.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('credentials') || msg.includes('UnrecognizedClient') || msg.includes('InvalidClientToken')) {
        res.json({ budgets: [], noCredentials: true });
        return;
      }
      err500(res, msg);
    }
  });

  // GET /portfolio/budgets — list configs
  router.get('/budgets', async (_req: Request, res: Response) => {
    try {
      const r = await deps.dynamoDocClient.send(new QueryCommand({
        TableName: deps.costTableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': 'BUDGET' },
      }));
      const items = (r.Items ?? []) as Array<BudgetConfig & { PK: string; SK: string }>;
      res.json({ budgets: items.map((b) => ({
        id: b.id, name: b.name, monthlyBudget: b.monthlyBudget, scope: b.scope,
        scopeValue: b.scopeValue, alertThreshold: b.alertThreshold,
        notificationEmails: b.notificationEmails ?? [], createdAt: b.createdAt,
      })) });
    } catch (e) { err500(res, e instanceof Error ? e.message : String(e)); }
  });

  // POST /portfolio/budgets — create or replace
  router.post('/budgets', async (req: Request, res: Response) => {
    try {
      const body = req.body as Partial<BudgetConfig>;
      if (!body.name || typeof body.monthlyBudget !== 'number' || !body.scope) {
        res.status(400).json(problemDetails(400, 'Bad Request', 'name, monthlyBudget, scope required'));
        return;
      }
      const id = body.id ?? `bud_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const item: BudgetConfig & { PK: string; SK: string } = {
        PK: 'BUDGET', SK: `BUDGET#${id}`,
        id,
        name: body.name,
        monthlyBudget: body.monthlyBudget,
        scope: body.scope,
        scopeValue: body.scopeValue ?? '',
        alertThreshold: body.alertThreshold ?? 80,
        notificationEmails: body.notificationEmails ?? [],
        createdAt: new Date().toISOString(),
      };
      await deps.dynamoDocClient.send(new PutCommand({ TableName: deps.costTableName, Item: item }));
      // Writes invalidate cached status/listings so the UI sees the change immediately.
      responseCache.invalidatePrefix('portfolio:budgets');
      res.json({ budget: { id, name: item.name, monthlyBudget: item.monthlyBudget, scope: item.scope, scopeValue: item.scopeValue, alertThreshold: item.alertThreshold, notificationEmails: item.notificationEmails, createdAt: item.createdAt } });
    } catch (e) { err500(res, e instanceof Error ? e.message : String(e)); }
  });

  // DELETE /portfolio/budgets/:id
  router.delete('/budgets/:id', async (req: Request, res: Response) => {
    try {
      const id = String(req.params['id']);
      await deps.dynamoDocClient.send(new DeleteCommand({
        TableName: deps.costTableName, Key: { PK: 'BUDGET', SK: `BUDGET#${id}` },
      }));
      responseCache.invalidatePrefix('portfolio:budgets');
      res.json({ ok: true });
    } catch (e) { err500(res, e instanceof Error ? e.message : String(e)); }
  });

  // GET /portfolio/budgets/status — cached 10 min (Cost Explorer is rate-limited; budget
  // status is checked on every Budgets / Executive Summary visit)
  router.get('/budgets/status', async (_req: Request, res: Response) => {
    try {
      const result = await responseCache.getOrLoad(
        'portfolio:budgets:status',
        { ttlMs: 10 * 60_000 },
        async () => {
      const r = await deps.dynamoDocClient.send(new QueryCommand({
        TableName: deps.costTableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': 'BUDGET' },
      }));
      const budgets = ((r.Items ?? []) as BudgetConfig[]);
      if (budgets.length === 0) return { statuses: [] };

      const credentials = credentialStore.getProvider();
      const ce = new CostExplorerClient({ region: CE_REGION, credentials });
      const now = new Date();
      const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      let end = now.toISOString().slice(0, 10);
      // Edge case: on the 1st of the month, start === end and Cost Explorer
      // rejects the empty range. Push end forward one day.
      if (end <= start) {
        const next = new Date(start + 'T00:00:00Z');
        next.setUTCDate(next.getUTCDate() + 1);
        end = next.toISOString().slice(0, 10);
      }

      // Get cost-by-service for the month
      const ceResp = await costExplorerSemaphore.run(() => ce.send(new GetCostAndUsageCommand({
        TimePeriod: { Start: start, End: end },
        Granularity: 'MONTHLY',
        GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
        Metrics: ['UnblendedCost'],
      })));
      const serviceCost = new Map<string, number>();
      let totalSpend = 0;
      for (const g of ceResp.ResultsByTime?.[0]?.Groups ?? []) {
        const amt = parseFloat(g.Metrics?.['UnblendedCost']?.Amount ?? '0');
        serviceCost.set(g.Keys?.[0] ?? 'Other', amt);
        totalSpend += amt;
      }

      // For tag-scoped budgets, fetch per tag key
      const tagCost = new Map<string, number>(); // "tagKey:tagValue" -> amount
      const tagKeys = new Set(budgets.filter((b) => b.scope === 'tag').map((b) => (b.scopeValue.split(':')[0] ?? '')).filter(Boolean));
      for (const key of tagKeys) {
        try {
          const tagResp = await costExplorerSemaphore.run(() => ce.send(new GetCostAndUsageCommand({
            TimePeriod: { Start: start, End: end },
            Granularity: 'MONTHLY',
            GroupBy: [{ Type: 'TAG', Key: key }],
            Metrics: ['UnblendedCost'],
          })));
          for (const g of tagResp.ResultsByTime?.[0]?.Groups ?? []) {
            const tagVal = (g.Keys?.[0] ?? '').replace(`${key}$`, ''); // CE returns "Key$Value"
            const amt = parseFloat(g.Metrics?.['UnblendedCost']?.Amount ?? '0');
            tagCost.set(`${key}:${tagVal}`, amt);
          }
        } catch { /* skip tag */ }
      }

      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const fractionElapsed = now.getDate() / daysInMonth;

      const statuses = budgets.map((b) => {
        const currentSpend = b.scope === 'service' ? (serviceCost.get(b.scopeValue) ?? 0)
          : b.scope === 'tag' ? (tagCost.get(b.scopeValue) ?? 0)
          : totalSpend;
        const burnRate = fractionElapsed > 0 ? currentSpend / fractionElapsed : 0;
        const projectedOverage = Math.max(0, burnRate - b.monthlyBudget);
        const percentUsed = b.monthlyBudget > 0 ? (currentSpend / b.monthlyBudget) * 100 : 0;
        return {
          ...b,
          currentSpend, burnRate, projectedOverage, percentUsed,
          onTrack: burnRate <= b.monthlyBudget,
        };
      });

          return { statuses };
        },
      );
      res.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('credentials') || msg.includes('UnrecognizedClient') || msg.includes('InvalidClientToken')) {
        res.json({ statuses: [], noCredentials: true });
        return;
      }
      err500(res, msg);
    }
  });

  return router;
}
