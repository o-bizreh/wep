/**
 * GET /api/v1/aws-resources/*
 *
 * Lightweight read-only endpoints that list AWS resources so the Runbook Studio
 * and Self-Service Portal can populate dynamic dropdowns.
 *
 * All listing endpoints accept ?environment=Development|Production
 * which filters results to resources tagged  Environment=<value>.
 * When the param is omitted, all resources are returned.
 *
 * Pagination is handled server-side — each endpoint exhausts all pages
 * and returns the complete list.
 */
import { Router, type Request, type Response } from 'express';
import { Octokit } from '@octokit/rest';
import {
  ECSClient,
  ListClustersCommand,
  ListServicesCommand,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  ApplicationAutoScalingClient,
  DescribeScalableTargetsCommand,
  DescribeScalingPoliciesCommand,
  LambdaClient,
  ListFunctionsCommand,
  CloudWatchClient,
  GetMetricDataCommand,
  DescribeAlarmsCommand,
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  DescribeLogStreamsCommand,
  SQSClient,
  ListQueuesCommand,
  SFNClient,
  ListStateMachinesCommand,
  EC2Client,
  DescribeVpcsCommand,
  DescribeSubnetsCommand,
  DescribeSecurityGroupsCommand,
  SNSClient,
  ListTopicsCommand,
  STSClient,
  GetCallerIdentityCommand,
  DynamoDBClient,
  ListTablesCommand,
  RDSClient,
  DescribeDBInstancesCommand,
  ListTagsForResourceCommand,
  ResourceGroupsTaggingAPIClient,
  GetResourcesCommand,
  regionStore,
  credentialStore,
} from '@wep/aws-clients';
import { problemDetails } from '@wep/domain-types';

// ---------------------------------------------------------------------------
// Clients — region + credentials resolved lazily via providers so runtime
// changes (Settings UI credential paste, region override) take effect on the
// next AWS call without restarting the process.
// ---------------------------------------------------------------------------

const regionProvider      = regionStore.getProvider();
const credentialsProvider = credentialStore.getProvider();

const ecsClient       = new ECSClient({ region: regionProvider, credentials: credentialsProvider });
const lambdaClient    = new LambdaClient({ region: regionProvider, credentials: credentialsProvider });
const cwClient        = new CloudWatchClient({ region: regionProvider, credentials: credentialsProvider });
const cwLogsClient    = new CloudWatchLogsClient({ region: regionProvider, credentials: credentialsProvider });
const sqsClient       = new SQSClient({ region: regionProvider, credentials: credentialsProvider });
const sfnClient       = new SFNClient({ region: regionProvider, credentials: credentialsProvider });
const snsClient       = new SNSClient({ region: regionProvider, credentials: credentialsProvider });
const stsClient       = new STSClient({ region: regionProvider, credentials: credentialsProvider });
const dynamoRawClient = new DynamoDBClient({ region: regionProvider, credentials: credentialsProvider });
const rdsClient       = new RDSClient({ region: regionProvider, credentials: credentialsProvider });
const taggingClient   = new ResourceGroupsTaggingAPIClient({ region: regionProvider, credentials: credentialsProvider });
const ec2Client       = new EC2Client({ region: regionProvider, credentials: credentialsProvider });
const aasClient       = new ApplicationAutoScalingClient({ region: regionProvider, credentials: credentialsProvider });

// ---------------------------------------------------------------------------
// Account ID cache (for DynamoDB ARN construction)
// ---------------------------------------------------------------------------

let cachedAccountId: string | undefined;
async function getAccountId(): Promise<string> {
  if (cachedAccountId) return cachedAccountId;
  const resp = await stsClient.send(new GetCallerIdentityCommand({}));
  cachedAccountId = resp.Account ?? 'unknown';
  return cachedAccountId;
}

// ---------------------------------------------------------------------------
// Environment filter helper
// ---------------------------------------------------------------------------

type Environment = 'Development' | 'Production';

function parseEnvironment(raw: unknown): Environment | null {
  if (raw === 'Development' || raw === 'Production') return raw;
  return null;
}

/**
 * Returns a Set of resource ARNs that carry the tag  Environment=<env>.
 * Uses the Resource Groups Tagging API — one paginated call, no per-resource
 * tag look-ups required.
 *
 * resourceTypeFilter — e.g. 'lambda:function', 'rds:db', 'sqs:queue',
 *                           'sns:topic', 'ecs:service', 'dynamodb:table'
 */
async function arnsByEnvironment(
  resourceTypeFilter: string,
  env: Environment,
): Promise<Set<string>> {
  const arns = new Set<string>();
  let paginationToken: string | undefined;

  do {
    const resp = await taggingClient.send(
      new GetResourcesCommand({
        TagFilters: [{ Key: 'Environment', Values: [env] }],
        ResourceTypeFilters: [resourceTypeFilter],
        PaginationToken: paginationToken,
      }),
    );
    for (const r of resp.ResourceTagMappingList ?? []) {
      if (r.ResourceARN) arns.add(r.ResourceARN);
    }
    paginationToken = resp.PaginationToken;
  } while (paginationToken);

  return arns;
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

function err500(res: Response, message: string): void {
  res.status(500).json(problemDetails(500, 'AWS Error', message));
}

function lastName(arn: string): string {
  return arn.split(/[/:]/g).pop() ?? arn;
}

function getOctokit(): Octokit {
  return new Octokit({ auth: process.env['GITHUB_TOKEN'] });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function createAwsResourcesRouter(): Router {
  const router = Router();

  // ── Lambda ─────────────────────────────────────────────────────────────────

  router.get('/lambdas', async (req: Request, res: Response) => {
    const env = parseEnvironment(req.query['environment']);
    try {
      // Fetch all functions with full pagination
      const all: Array<{ name: string; arn: string; runtime: string }> = [];
      let marker: string | undefined;
      do {
        const resp = await lambdaClient.send(
          new ListFunctionsCommand({ Marker: marker, MaxItems: 50 }),
        );
        for (const fn of resp.Functions ?? []) {
          if (fn.FunctionName && fn.FunctionArn) {
            all.push({ name: fn.FunctionName, arn: fn.FunctionArn, runtime: fn.Runtime ?? '' });
          }
        }
        marker = resp.NextMarker;
      } while (marker);

      if (!env) { res.json(all); return; }
      const allowed = await arnsByEnvironment('lambda:function', env);
      // Fall back to all functions when none carry the Environment tag
      res.json(allowed.size > 0 ? all.filter((f) => allowed.has(f.arn)) : all);
    } catch (e) {
      err500(res, e instanceof Error ? e.message : String(e));
    }
  });

  // ── ECS ────────────────────────────────────────────────────────────────────

  router.get('/ecs/clusters', async (_req: Request, res: Response) => {
    try {
      const clusters: Array<{ name: string; arn: string }> = [];
      let nextToken: string | undefined;
      do {
        const resp = await ecsClient.send(new ListClustersCommand({ nextToken, maxResults: 100 }));
        for (const arn of resp.clusterArns ?? []) clusters.push({ name: lastName(arn), arn });
        nextToken = resp.nextToken;
      } while (nextToken);
      res.json(clusters);
    } catch (e) {
      err500(res, e instanceof Error ? e.message : String(e));
    }
  });

  // Per-cluster services (used by Runbook Studio cascading selects)
  router.get('/ecs/services', async (req: Request, res: Response) => {
    const cluster = req.query['cluster'] as string | undefined;
    if (!cluster) { res.status(400).json(problemDetails(400, 'Bad Request', 'cluster query param required')); return; }
    const env = parseEnvironment(req.query['environment']);
    try {
      const all: Array<{ name: string; arn: string }> = [];
      let nextToken: string | undefined;
      do {
        const resp = await ecsClient.send(new ListServicesCommand({ cluster, nextToken, maxResults: 100 }));
        for (const arn of resp.serviceArns ?? []) all.push({ name: lastName(arn), arn });
        nextToken = resp.nextToken;
      } while (nextToken);

      if (!env) { res.json(all); return; }
      const allowed = await arnsByEnvironment('ecs:service', env);
      res.json(all.filter((s) => allowed.has(s.arn)));
    } catch (e) {
      err500(res, e instanceof Error ? e.message : String(e));
    }
  });

  // Cross-cluster ECS services — used by portal dropdowns (no cluster pre-selection required)
  router.get('/ecs/services/all', async (req: Request, res: Response) => {
    const env = parseEnvironment(req.query['environment']);
    try {
      // When filtering by environment, go straight to Tagging API — one call instead of
      // listing every cluster then every service.
      if (env) {
        const arns = await arnsByEnvironment('ecs:service', env);
        const services = Array.from(arns).map((arn) => ({
          name:    lastName(arn),
          arn,
          cluster: arn.split('/')[1] ?? '',
        }));
        res.json(services);
        return;
      }

      // No filter — enumerate all clusters then all services
      const clusterArns: string[] = [];
      let clusterToken: string | undefined;
      do {
        const resp = await ecsClient.send(new ListClustersCommand({ nextToken: clusterToken, maxResults: 100 }));
        clusterArns.push(...(resp.clusterArns ?? []));
        clusterToken = resp.nextToken;
      } while (clusterToken);

      const services: Array<{ name: string; arn: string; cluster: string }> = [];
      await Promise.all(
        clusterArns.map(async (clusterArn) => {
          let serviceToken: string | undefined;
          do {
            const resp = await ecsClient.send(
              new ListServicesCommand({ cluster: clusterArn, nextToken: serviceToken, maxResults: 100 }),
            );
            for (const arn of resp.serviceArns ?? []) {
              services.push({ name: lastName(arn), arn, cluster: lastName(clusterArn) });
            }
            serviceToken = resp.nextToken;
          } while (serviceToken);
        }),
      );

      res.json(services);
    } catch (e) {
      err500(res, e instanceof Error ? e.message : String(e));
    }
  });

  // ── CloudWatch Alarms ──────────────────────────────────────────────────────

  router.get('/cloudwatch/alarms', async (_req: Request, res: Response) => {
    try {
      const alarms: Array<{ name: string; state: string }> = [];
      let nextToken: string | undefined;
      do {
        const resp = await cwClient.send(new DescribeAlarmsCommand({ NextToken: nextToken, MaxRecords: 100 }));
        for (const alarm of resp.MetricAlarms ?? []) {
          if (alarm.AlarmName) alarms.push({ name: alarm.AlarmName, state: alarm.StateValue ?? 'UNKNOWN' });
        }
        nextToken = resp.NextToken;
      } while (nextToken);
      res.json(alarms);
    } catch (e) {
      err500(res, e instanceof Error ? e.message : String(e));
    }
  });

  // ── CloudWatch Logs ────────────────────────────────────────────────────────

  router.get('/cloudwatch/log-groups', async (req: Request, res: Response) => {
    const prefix = (req.query['prefix'] as string | undefined) ?? '';
    try {
      const groups: Array<{ name: string; storedBytes: number }> = [];
      let nextToken: string | undefined;
      do {
        const resp = await cwLogsClient.send(
          new DescribeLogGroupsCommand({ logGroupNamePrefix: prefix || undefined, nextToken, limit: 50 }),
        );
        for (const g of resp.logGroups ?? []) {
          if (g.logGroupName) groups.push({ name: g.logGroupName, storedBytes: g.storedBytes ?? 0 });
        }
        nextToken = resp.nextToken;
      } while (nextToken && groups.length < 200);
      res.json(groups);
    } catch (e) {
      err500(res, e instanceof Error ? e.message : String(e));
    }
  });

  router.get('/cloudwatch/log-streams', async (req: Request, res: Response) => {
    const logGroupName = req.query['logGroup'] as string | undefined;
    if (!logGroupName) { res.status(400).json(problemDetails(400, 'Bad Request', 'logGroup query param required')); return; }
    try {
      const streams: Array<{ name: string; lastEventTime?: number }> = [];
      let nextToken: string | undefined;
      do {
        const resp = await cwLogsClient.send(
          new DescribeLogStreamsCommand({ logGroupName, orderBy: 'LastEventTime', descending: true, nextToken, limit: 50 }),
        );
        for (const s of resp.logStreams ?? []) {
          if (s.logStreamName) streams.push({ name: s.logStreamName, lastEventTime: s.lastEventTimestamp });
        }
        nextToken = resp.nextToken;
      } while (nextToken && streams.length < 100);
      res.json(streams);
    } catch (e) {
      err500(res, e instanceof Error ? e.message : String(e));
    }
  });

  // ── SQS ────────────────────────────────────────────────────────────────────

  router.get('/sqs/queues', async (req: Request, res: Response) => {
    const env = parseEnvironment(req.query['environment']);
    try {
      const all: Array<{ name: string; url: string; arn: string }> = [];
      let nextToken: string | undefined;
      do {
        const resp = await sqsClient.send(new ListQueuesCommand({ NextToken: nextToken, MaxResults: 100 }));
        for (const url of resp.QueueUrls ?? []) {
          const name = url.split('/').pop() ?? url;
          let arn = url;
          try {
            const u = new URL(url);
            const parts = u.pathname.split('/').filter(Boolean);
            const rgn = u.hostname.split('.')[1] ?? regionStore.get();
            arn = `arn:aws:sqs:${rgn}:${parts[0]}:${parts[1]}`;
          } catch { /* leave arn as url */ }
          all.push({ name, url, arn });
        }
        nextToken = resp.NextToken;
      } while (nextToken);

      if (!env) { res.json(all); return; }
      const allowed = await arnsByEnvironment('sqs:queue', env);
      res.json(allowed.size > 0 ? all.filter((q) => allowed.has(q.arn)) : all);
    } catch (e) {
      err500(res, e instanceof Error ? e.message : String(e));
    }
  });

  // ── SNS ────────────────────────────────────────────────────────────────────

  router.get('/sns/topics', async (req: Request, res: Response) => {
    const env = parseEnvironment(req.query['environment']);
    try {
      const all: Array<{ name: string; arn: string }> = [];
      let nextToken: string | undefined;
      do {
        const resp = await snsClient.send(new ListTopicsCommand({ NextToken: nextToken }));
        for (const t of resp.Topics ?? []) {
          if (t.TopicArn) all.push({ name: lastName(t.TopicArn), arn: t.TopicArn });
        }
        nextToken = resp.NextToken;
      } while (nextToken);

      if (!env) { res.json(all); return; }
      const allowed = await arnsByEnvironment('sns:topic', env);
      res.json(allowed.size > 0 ? all.filter((t) => allowed.has(t.arn)) : all);
    } catch (e) {
      err500(res, e instanceof Error ? e.message : String(e));
    }
  });

  // ── DynamoDB Tables ────────────────────────────────────────────────────────

  router.get('/dynamodb/tables', async (req: Request, res: Response) => {
    const env = parseEnvironment(req.query['environment']);
    try {
      const accountId = await getAccountId();
      const all: Array<{ name: string; arn: string }> = [];
      let lastKey: string | undefined;
      do {
        const resp = await dynamoRawClient.send(new ListTablesCommand({ ExclusiveStartTableName: lastKey, Limit: 100 }));
        for (const name of resp.TableNames ?? []) {
          all.push({ name, arn: `arn:aws:dynamodb:${regionStore.get()}:${accountId}:table/${name}` });
        }
        lastKey = resp.LastEvaluatedTableName;
      } while (lastKey);

      if (!env) { res.json(all); return; }
      const allowed = await arnsByEnvironment('dynamodb:table', env);
      res.json(allowed.size > 0 ? all.filter((t) => allowed.has(t.arn)) : all);
    } catch (e) {
      err500(res, e instanceof Error ? e.message : String(e));
    }
  });

  // ── Step Functions ─────────────────────────────────────────────────────────

  router.get('/step-functions', async (_req: Request, res: Response) => {
    try {
      const machines: Array<{ name: string; arn: string; type: string }> = [];
      let nextToken: string | undefined;
      do {
        const resp = await sfnClient.send(new ListStateMachinesCommand({ nextToken, maxResults: 100 }));
        for (const m of resp.stateMachines ?? []) {
          if (m.name && m.stateMachineArn) machines.push({ name: m.name, arn: m.stateMachineArn, type: m.type ?? '' });
        }
        nextToken = resp.nextToken;
      } while (nextToken);
      res.json(machines);
    } catch (e) {
      err500(res, e instanceof Error ? e.message : String(e));
    }
  });

  // ── RDS Instances ─────────────────────────────────────────────────────────
  // All instances are returned — no WEP tag required.
  // The WEP:MasterSecretId tag is read at grant time (not a filter here).
  // When ?environment= is supplied, results are narrowed to instances tagged
  // Environment=<value> via DescribeDBInstances tag filter (native RDS support).

  router.get('/rds/instances', async (req: Request, res: Response) => {
    const env = parseEnvironment(req.query['environment']);
    try {
      const instances: Array<{
        identifier: string;
        arn: string;
        engine: string;
        endpoint: string;
        port: number;
        dbName: string;
        masterSecretId: string | null;
        status: string;
      }> = [];

      const filters = env
        ? [{ Name: 'tag:Environment', Values: [env] }]
        : undefined;

      let marker: string | undefined;
      do {
        const resp = await rdsClient.send(
          new DescribeDBInstancesCommand({ Marker: marker, MaxRecords: 100, Filters: filters }),
        );

        // Batch tag fetches to avoid per-instance serial round-trips
        const tagFetches = (resp.DBInstances ?? [])
          .filter((db) => db.DBInstanceArn && db.DBInstanceIdentifier)
          .map(async (db) => {
            const tagsResp = await rdsClient.send(
              new ListTagsForResourceCommand({ ResourceName: db.DBInstanceArn }),
            );
            const tags: Record<string, string> = {};
            for (const tag of tagsResp.TagList ?? []) {
              if (tag.Key) tags[tag.Key] = tag.Value ?? '';
            }
            instances.push({
              identifier:     db.DBInstanceIdentifier!,
              arn:            db.DBInstanceArn!,
              engine:         db.Engine ?? '',
              endpoint:       db.Endpoint?.Address ?? '',
              port:           db.Endpoint?.Port ?? 5432,
              dbName:         db.DBName ?? 'postgres',
              masterSecretId: tags['WEP:MasterSecretId'] ?? null,
              status:         db.DBInstanceStatus ?? '',
            });
          });
        await Promise.all(tagFetches);

        marker = resp.Marker;
      } while (marker);

      res.json(instances);
    } catch (e) {
      err500(res, e instanceof Error ? e.message : String(e));
    }
  });

  // ── GitHub ─────────────────────────────────────────────────────────────────

  router.get('/github/repos', async (req: Request, res: Response) => {
    const org = (req.query['org'] as string | undefined) ?? process.env['GITHUB_ORG'] ?? '';
    if (!org) { res.status(400).json(problemDetails(400, 'Bad Request', 'org query param required')); return; }
    try {
      const octokit = getOctokit();
      const repos: Array<{ name: string; fullName: string; defaultBranch: string }> = [];
      for await (const response of octokit.paginate.iterator(
        octokit.repos.listForOrg,
        { org, per_page: 100, type: 'all' },
      )) {
        for (const repo of response.data) {
          if (!repo.archived) repos.push({ name: repo.name, fullName: repo.full_name, defaultBranch: repo.default_branch ?? 'main' });
        }
      }
      res.json(repos);
    } catch (e) {
      err500(res, e instanceof Error ? e.message : String(e));
    }
  });

  // Search repos within the org — uses GitHub search API for fast prefix matching
  router.get('/github/repos/search', async (req: Request, res: Response) => {
    const q     = (req.query['q']   as string | undefined)?.trim() ?? '';
    const org   = (req.query['org'] as string | undefined) ?? process.env['GITHUB_ORG'] ?? '';
    if (!org) { res.status(400).json(problemDetails(400, 'Bad Request', 'org query param or GITHUB_ORG env required')); return; }
    if (!q)   { res.json([]); return; }
    try {
      const octokit = getOctokit();
      const { data } = await octokit.search.repos({
        q: `${q} org:${org} fork:true`,
        per_page: 10,
        sort: 'updated',
      });
      const results = data.items
        .filter((r) => !r.archived)
        .map((r) => ({ name: r.name, fullName: r.full_name, description: r.description ?? '', defaultBranch: r.default_branch ?? 'main' }));
      res.json(results);
    } catch (e) {
      err500(res, e instanceof Error ? e.message : String(e));
    }
  });

  router.get('/github/workflows', async (req: Request, res: Response) => {
    const owner = req.query['owner'] as string | undefined;
    const repo  = req.query['repo']  as string | undefined;
    if (!owner || !repo) { res.status(400).json(problemDetails(400, 'Bad Request', 'owner and repo query params required')); return; }
    try {
      const octokit = getOctokit();
      const workflows: Array<{ id: string; name: string; path: string }> = [];
      for await (const response of octokit.paginate.iterator(
        octokit.actions.listRepoWorkflows,
        { owner, repo, per_page: 100 },
      )) {
        for (const w of response.data) workflows.push({ id: String(w.id), name: w.name, path: w.path });
      }
      res.json(workflows);
    } catch (e) {
      err500(res, e instanceof Error ? e.message : String(e));
    }
  });

  // GET /aws-resources/github/pr-files?owner=X&repo=Y&pr=123
  // Paginates through all files in the PR. GitHub caps a single PR at 3,000 files
  // and returns max 100 per page, so this is bounded to ~30 requests at worst.
  router.get('/github/pr-files', async (req: Request, res: Response) => {
    const owner  = req.query['owner'] as string | undefined;
    const repo   = req.query['repo']  as string | undefined;
    const prNum  = Number(req.query['pr']);
    if (!owner || !repo || !prNum) {
      res.status(400).json(problemDetails(400, 'Bad Request', 'owner, repo, and pr query params required'));
      return;
    }
    try {
      const octokit = getOctokit();
      const files: Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }> = [];
      for await (const response of octokit.paginate.iterator(
        octokit.pulls.listFiles,
        { owner, repo, pull_number: prNum, per_page: 100 },
      )) {
        for (const f of response.data) {
          files.push({
            filename: f.filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch?.slice(0, 500),
          });
        }
      }
      res.json(files);
    } catch (e) {
      err500(res, e instanceof Error ? e.message : String(e));
    }
  });

  // POST /aws-resources/github/pr-comment
  router.post('/github/pr-comment', async (req: Request, res: Response) => {
    const { owner, repo, prNumber, body: commentBody } = req.body as {
      owner?: string;
      repo?: string;
      prNumber?: number;
      body?: string;
    };
    if (!owner || !repo || !prNumber || !commentBody) {
      res.status(400).json(problemDetails(400, 'Bad Request', 'owner, repo, prNumber, and body are required'));
      return;
    }
    try {
      const octokit = getOctokit();
      const { data } = await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: commentBody,
      });
      res.json({ commentUrl: data.html_url });
    } catch (e) {
      err500(res, e instanceof Error ? e.message : String(e));
    }
  });

  // ── Infra: Resource Inventory ──────────────────────────────────────────────
  // GET /aws-resources/infra/resources?environment=Production
  router.get('/infra/resources', async (req: Request, res: Response) => {
    try {
      const env = parseEnvironment(req.query['environment']);

      // ECS services
      const ecsResources: unknown[] = [];
      const clusterArns: string[] = [];
      let clusterToken: string | undefined;
      do {
        const r = await ecsClient.send(new ListClustersCommand({ nextToken: clusterToken }));
        clusterArns.push(...(r.clusterArns ?? []));
        clusterToken = r.nextToken;
      } while (clusterToken);

      for (const clusterArn of clusterArns) {
        const clusterName = clusterArn.split('/').pop() ?? clusterArn;
        let svcToken: string | undefined;
        do {
          const r = await ecsClient.send(new ListServicesCommand({ cluster: clusterArn, nextToken: svcToken }));
          const arns = r.serviceArns ?? [];
          if (arns.length > 0) {
            const desc = await ecsClient.send(new DescribeServicesCommand({ cluster: clusterArn, services: arns }));
            for (const svc of desc.services ?? []) {
              const envTag = svc.tags?.find((t) => t.key === 'Environment')?.value ?? null;
              if (env && envTag !== env) continue;
              ecsResources.push({
                type: 'ecs-service',
                id: svc.serviceArn ?? '',
                name: svc.serviceName ?? '',
                cluster: clusterName,
                status: svc.status ?? 'UNKNOWN',
                desiredCount: svc.desiredCount ?? 0,
                runningCount: svc.runningCount ?? 0,
                environment: envTag,
                tags: Object.fromEntries((svc.tags ?? []).map((t) => [t.key, t.value])),
              });
            }
          }
          svcToken = r.nextToken;
        } while (svcToken);
      }

      // Lambda functions
      const lambdaResources: unknown[] = [];
      let lambdaToken: string | undefined;
      do {
        const r = await lambdaClient.send(new ListFunctionsCommand({ Marker: lambdaToken }));
        for (const fn of r.Functions ?? []) {
          // ListFunctions does not return tags; skip env-filter for Lambda (tags available via GetFunction)
          lambdaResources.push({
            type: 'lambda',
            id: fn.FunctionArn ?? '',
            name: fn.FunctionName ?? '',
            runtime: fn.Runtime ?? 'unknown',
            memoryMb: fn.MemorySize ?? 0,
            timeoutSec: fn.Timeout ?? 0,
            lastModified: fn.LastModified ?? null,
            environment: null,
            tags: {},
          });
        }
        lambdaToken = r.NextMarker;
      } while (lambdaToken);

      // RDS instances
      const rdsResources: unknown[] = [];
      const rdsResp = await rdsClient.send(new DescribeDBInstancesCommand({}));
      for (const db of rdsResp.DBInstances ?? []) {
        const envTag = db.TagList?.find((t) => t.Key === 'Environment')?.Value ?? null;
        if (env && envTag !== env) continue;
        rdsResources.push({
          type: 'rds',
          id: db.DBInstanceArn ?? '',
          name: db.DBInstanceIdentifier ?? '',
          engine: `${db.Engine ?? ''} ${db.EngineVersion ?? ''}`.trim(),
          instanceClass: db.DBInstanceClass ?? '',
          status: db.DBInstanceStatus ?? 'unknown',
          multiAz: db.MultiAZ ?? false,
          environment: envTag,
          tags: Object.fromEntries((db.TagList ?? []).map((t) => [t.Key, t.Value])),
        });
      }

      res.json({ ecsServices: ecsResources, lambdaFunctions: lambdaResources, rdsInstances: rdsResources });
    } catch (e) { err500(res, e instanceof Error ? e.message : String(e)); }
  });

  // ── Infra: VPC Topology ────────────────────────────────────────────────────
  // GET /aws-resources/infra/topology
  router.get('/infra/topology', async (_req: Request, res: Response) => {
    try {
      const [vpcsResp, subnetsResp, sgResp] = await Promise.all([
        ec2Client.send(new DescribeVpcsCommand({})),
        ec2Client.send(new DescribeSubnetsCommand({})),
        ec2Client.send(new DescribeSecurityGroupsCommand({})),
      ]);

      const nameTag = (tags: Array<{ Key?: string; Value?: string }> | undefined) =>
        tags?.find((t) => t.Key === 'Name')?.Value ?? null;

      const vpcs = (vpcsResp.Vpcs ?? []).map((v) => ({
        vpcId: v.VpcId ?? '',
        name: nameTag(v.Tags as Array<{ Key?: string; Value?: string }> | undefined),
        cidr: v.CidrBlock ?? '',
        isDefault: v.IsDefault ?? false,
        state: v.State ?? 'unknown',
        tags: Object.fromEntries((v.Tags ?? []).map((t) => [t.Key, t.Value])),
      }));

      const subnets = (subnetsResp.Subnets ?? []).map((s) => ({
        subnetId: s.SubnetId ?? '',
        vpcId: s.VpcId ?? '',
        name: nameTag(s.Tags as Array<{ Key?: string; Value?: string }> | undefined),
        cidr: s.CidrBlock ?? '',
        az: s.AvailabilityZone ?? '',
        availableIps: s.AvailableIpAddressCount ?? 0,
        isPublic: s.MapPublicIpOnLaunch ?? false,
        tags: Object.fromEntries((s.Tags ?? []).map((t) => [t.Key, t.Value])),
      }));

      const securityGroups = (sgResp.SecurityGroups ?? []).map((sg) => ({
        groupId: sg.GroupId ?? '',
        vpcId: sg.VpcId ?? '',
        name: sg.GroupName ?? '',
        description: sg.Description ?? '',
        ingressRules: (sg.IpPermissions ?? []).map((r) => ({
          protocol: r.IpProtocol ?? '-1',
          fromPort: r.FromPort ?? null,
          toPort: r.ToPort ?? null,
          cidrs: (r.IpRanges ?? []).map((x) => x.CidrIp ?? ''),
          sourceSgs: (r.UserIdGroupPairs ?? []).map((x) => x.GroupId ?? ''),
        })),
        egressRules: (sg.IpPermissionsEgress ?? []).map((r) => ({
          protocol: r.IpProtocol ?? '-1',
          fromPort: r.FromPort ?? null,
          toPort: r.ToPort ?? null,
          cidrs: (r.IpRanges ?? []).map((x) => x.CidrIp ?? ''),
        })),
      }));

      res.json({ vpcs, subnets, securityGroups });
    } catch (e) { err500(res, e instanceof Error ? e.message : String(e)); }
  });

  // ── Infra: CloudWatch Metrics ──────────────────────────────────────────────
  // GET /aws-resources/infra/metrics?type=ecs-service|lambda|rds&name=<name>&cluster=<cluster>
  router.get('/infra/metrics', async (req: Request, res: Response) => {
    try {
      const type    = req.query['type'] as string;
      const name    = req.query['name'] as string;
      const cluster = req.query['cluster'] as string | undefined;

      if (!type || !name) { res.status(400).json(problemDetails(400, 'Bad Request', 'type and name are required')); return; }

      const end   = new Date();
      const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
      const period = 300; // 5 minutes

      type MetricQuery = { Id: string; namespace: string; metric: string; dimensions: Record<string, string>; stat: string; label: string };
      const queries: MetricQuery[] = [];

      if (type === 'ecs-service') {
        if (!cluster) { res.status(400).json(problemDetails(400, 'Bad Request', 'cluster is required for ecs-service')); return; }
        const dims = { ClusterName: cluster, ServiceName: name };
        queries.push(
          { Id: 'cpu',    namespace: 'AWS/ECS', metric: 'CPUUtilization',    dimensions: dims, stat: 'Average', label: 'CPU %' },
          { Id: 'memory', namespace: 'AWS/ECS', metric: 'MemoryUtilization', dimensions: dims, stat: 'Average', label: 'Memory %' },
        );
      } else if (type === 'lambda') {
        const dims = { FunctionName: name };
        queries.push(
          { Id: 'invocations',   namespace: 'AWS/Lambda', metric: 'Invocations',            dimensions: dims, stat: 'Sum',     label: 'Invocations' },
          { Id: 'errors',        namespace: 'AWS/Lambda', metric: 'Errors',                 dimensions: dims, stat: 'Sum',     label: 'Errors' },
          { Id: 'throttles',     namespace: 'AWS/Lambda', metric: 'Throttles',              dimensions: dims, stat: 'Sum',     label: 'Throttles' },
          { Id: 'concurrency',   namespace: 'AWS/Lambda', metric: 'ConcurrentExecutions',   dimensions: dims, stat: 'Maximum', label: 'Concurrency (max)' },
        );
      } else if (type === 'rds') {
        const dims = { DBInstanceIdentifier: name };
        queries.push(
          { Id: 'cpu',         namespace: 'AWS/RDS', metric: 'CPUUtilization',    dimensions: dims, stat: 'Average', label: 'CPU %' },
          { Id: 'connections', namespace: 'AWS/RDS', metric: 'DatabaseConnections', dimensions: dims, stat: 'Average', label: 'Connections' },
          { Id: 'memory',      namespace: 'AWS/RDS', metric: 'FreeableMemory',    dimensions: dims, stat: 'Average', label: 'Freeable Memory (bytes)' },
        );
      } else {
        res.status(400).json(problemDetails(400, 'Bad Request', `Unknown resource type: ${type}`)); return;
      }

      const cwResp = await cwClient.send(new GetMetricDataCommand({
        StartTime: start,
        EndTime: end,
        MetricDataQueries: queries.map((q) => ({
          Id: q.Id,
          Label: q.label,
          MetricStat: {
            Metric: {
              Namespace: q.namespace,
              MetricName: q.metric,
              Dimensions: Object.entries(q.dimensions).map(([Name, Value]) => ({ Name, Value })),
            },
            Period: period,
            Stat: q.stat,
          },
        })),
      }));

      const metrics: Record<string, { timestamps: string[]; values: number[]; label: string }> = {};
      for (const result of cwResp.MetricDataResults ?? []) {
        if (!result.Id) continue;
        const ts = result.Timestamps ?? [];
        const vals = result.Values ?? [];
        // Sort by time ascending
        const pairs = ts.map((t, i) => [t.toISOString(), vals[i] ?? 0] as [string, number]).sort((a, b) => a[0].localeCompare(b[0]));
        metrics[result.Id] = { timestamps: pairs.map((p) => p[0]), values: pairs.map((p) => p[1]), label: result.Label ?? result.Id };
      }

      res.json({ type, name, metrics });
    } catch (e) { err500(res, e instanceof Error ? e.message : String(e)); }
  });

  // ── ECS Service Detail — used by Runbook Auto-Generator ───────────────────
  // GET /aws-resources/ecs-service-detail?cluster=X&service=Y
  router.get('/ecs-service-detail', async (req: Request, res: Response) => {
    const cluster = req.query['cluster'] as string | undefined;
    const service = req.query['service'] as string | undefined;

    if (!cluster || !service) {
      res.status(400).json(problemDetails(400, 'Bad Request', 'cluster and service query params are required'));
      return;
    }

    const sensitivePattern = /PASSWORD|SECRET|KEY|TOKEN|PASS/i;

    try {
      // 1. DescribeServices to get running count and task definition ARN
      const svcResp = await ecsClient.send(
        new DescribeServicesCommand({ cluster, services: [service] }),
      );
      const svc = svcResp.services?.[0];
      let runningCount: number | null = svc?.runningCount ?? null;
      let taskDefinitionArn: string | null = svc?.taskDefinition ?? null;

      // 2. DescribeTaskDefinition to get CPU, memory, env vars
      let taskCpu = 'unknown';
      let taskMemory = 'unknown';
      let envVars: Array<{ name: string; value: string }> = [];

      if (taskDefinitionArn) {
        const tdResp = await ecsClient.send(
          new DescribeTaskDefinitionCommand({ taskDefinition: taskDefinitionArn }),
        );
        const td = tdResp.taskDefinition;
        if (td) {
          const cpuRaw = parseInt(td.cpu ?? '0', 10);
          taskCpu = cpuRaw >= 1024 ? `${cpuRaw / 1024} vCPU` : cpuRaw > 0 ? `${(cpuRaw / 1024).toFixed(2).replace(/\.?0+$/, '')} vCPU` : 'unknown';

          const memRaw = parseInt(td.memory ?? '0', 10);
          taskMemory = memRaw >= 1024 ? `${(memRaw / 1024).toFixed(1).replace(/\.0$/, '')} GB` : memRaw > 0 ? `${memRaw} MB` : 'unknown';

          const rawEnvVars = td.containerDefinitions?.[0]?.environment ?? [];
          envVars = rawEnvVars
            .filter((e): e is { name: string; value: string } => typeof e.name === 'string' && typeof e.value === 'string')
            .filter((e) => !sensitivePattern.test(e.name));
        }
      }

      // 3. Auto-scaling via Application Auto Scaling
      const resourceId = `service/${cluster}/${service}`;
      let autoScalingMin: number | null = null;
      let autoScalingMax: number | null = null;
      let scalesAt = 'CPU >= 70%';

      try {
        const [targetsResp, policiesResp] = await Promise.all([
          aasClient.send(
            new DescribeScalableTargetsCommand({
              ServiceNamespace: 'ecs' as const,
              ResourceIds: [resourceId],
            }),
          ),
          aasClient.send(
            new DescribeScalingPoliciesCommand({
              ServiceNamespace: 'ecs' as const,
              ResourceId: resourceId,
            }),
          ),
        ]);

        const target = targetsResp.ScalableTargets?.[0];
        if (target) {
          autoScalingMin = target.MinCapacity ?? null;
          autoScalingMax = target.MaxCapacity ?? null;
        }

        for (const policy of policiesResp.ScalingPolicies ?? []) {
          const ttc = policy.TargetTrackingScalingPolicyConfiguration;
          if (ttc?.TargetValue != null) {
            scalesAt = `CPU >= ${ttc.TargetValue}%`;
            break;
          }
        }
      } catch { /* non-fatal — auto-scaling may not be configured */ }

      res.json({
        cluster,
        taskCpu,
        taskMemory,
        runningCount,
        envVars,
        autoScaling: {
          min: autoScalingMin,
          max: autoScalingMax,
          scalesAt,
        },
      });
    } catch (e) { err500(res, e instanceof Error ? e.message : String(e)); }
  });

  return router;
}
