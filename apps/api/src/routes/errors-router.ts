import { Router } from 'express';
import {
  CloudWatchClient,
  GetMetricDataCommand,
  ResourceGroupsTaggingAPIClient,
  GetResourcesCommand,
  APIGatewayClient,
  GetRestApisCommand,
  credentialStore,
  type MetricDataQuery,
} from '@wep/aws-clients';

// ── Constants ────────────────────────────────────────────────────────────────

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const PRODUCTION_ENV_TAG = 'Production';
const GET_METRIC_DATA_BATCH = 500;
const DLQ_NAME_PATTERNS = [/-dlq$/i, /-deadletter$/i, /-dead-letter$/i, /-dead_letter$/i];

type ErrorsWindow = '24h' | '7d';

interface WindowConfig {
  ms: number;
  periodSec: number;
  bucketCount: number;
  bucketKey: (d: Date) => string;
}

const WINDOWS: Record<ErrorsWindow, WindowConfig> = {
  '24h': {
    ms: 24 * HOUR_MS,
    periodSec: 3600,
    bucketCount: 24,
    // Hourly bucket key: yyyy-mm-ddTHH
    bucketKey: (d) => d.toISOString().slice(0, 13),
  },
  '7d': {
    ms: 7 * DAY_MS,
    periodSec: 86_400,
    bucketCount: 7,
    // Daily bucket key
    bucketKey: (d) => d.toISOString().slice(0, 10),
  },
};

// ── Types ────────────────────────────────────────────────────────────────────

type ServiceCategory =
  | 'lambda'
  | 'alb'
  | 'firehose'
  | 'sns'
  | 'sqs'
  | 'dynamodb'
  | 'apigateway'
  | 'stepfunctions';

interface ChartPoint {
  bucket: string;   // ISO hour (24h window) or ISO date (7d window)
  value: number;
}

interface ResourceErrorEntry {
  name: string;
  errors: number;
  consoleUrl: string;
}

interface CategoryResult {
  category: ServiceCategory;
  label: string;
  metric: string;        // Human-readable description of the metric
  totalErrors: number;
  chart: ChartPoint[];
  resources: ResourceErrorEntry[];
}

interface ResourceMeta {
  /** Stable identifier used as the CloudWatch query Id (must be alphanum, start with lowercase) */
  qId: string;
  /** Display name (used in the drawer + as the lookup key from query results) */
  name: string;
  /** Built console URL for click-through */
  consoleUrl: string;
}

interface CategoryMeta {
  category: ServiceCategory;
  label: string;
  metric: string;
}

const CATEGORY_META: Record<ServiceCategory, CategoryMeta> = {
  lambda:        { category: 'lambda',        label: 'Lambda Errors',           metric: 'AWS/Lambda · Errors' },
  alb:           { category: 'alb',           label: 'ALB 5xx',                 metric: 'AWS/ApplicationELB · Target + ELB 5XX' },
  firehose:      { category: 'firehose',      label: 'Firehose Throttles',      metric: 'AWS/Firehose · ThrottledRecords' },
  sns:           { category: 'sns',           label: 'SNS Failed Notifications', metric: 'AWS/SNS · NumberOfNotificationsFailed' },
  sqs:           { category: 'sqs',           label: 'DLQ Depth',               metric: 'AWS/SQS · ApproximateNumberOfMessagesVisible (DLQs)' },
  dynamodb:      { category: 'dynamodb',      label: 'DynamoDB Throttles & Errors', metric: 'AWS/DynamoDB · UserErrors + SystemErrors + ThrottledRequests' },
  apigateway:    { category: 'apigateway',    label: 'API Gateway 5xx',         metric: 'AWS/ApiGateway · 5XXError' },
  stepfunctions: { category: 'stepfunctions', label: 'Step Functions Failed',   metric: 'AWS/States · ExecutionsFailed' },
};

const ALL_CATEGORIES: ServiceCategory[] = Object.keys(CATEGORY_META) as ServiceCategory[];

function isCategory(v: string): v is ServiceCategory {
  return v in CATEGORY_META;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function arnsByEnvironment(
  tagging: ResourceGroupsTaggingAPIClient,
  resourceTypeFilter: string,
  env: string,
): Promise<string[]> {
  const arns: string[] = [];
  let paginationToken: string | undefined;
  do {
    const resp = await tagging.send(new GetResourcesCommand({
      TagFilters: [{ Key: 'Environment', Values: [env] }],
      ResourceTypeFilters: [resourceTypeFilter],
      PaginationToken: paginationToken,
    }));
    for (const r of resp.ResourceTagMappingList ?? []) {
      if (r.ResourceARN) arns.push(r.ResourceARN);
    }
    paginationToken = resp.PaginationToken || undefined;
  } while (paginationToken);
  return arns;
}

/** Run a batch of metric queries, splitting at the 500-per-call SDK limit. */
async function fetchMetricData(
  cw: CloudWatchClient,
  queries: MetricDataQuery[],
  start: Date,
  end: Date,
): Promise<Map<string, { ts: Date; value: number }[]>> {
  const out = new Map<string, { ts: Date; value: number }[]>();
  for (let i = 0; i < queries.length; i += GET_METRIC_DATA_BATCH) {
    const batch = queries.slice(i, i + GET_METRIC_DATA_BATCH);
    const result = await cw.send(new GetMetricDataCommand({
      MetricDataQueries: batch,
      StartTime: start,
      EndTime: end,
      ScanBy: 'TimestampAscending',
    }));
    for (const r of result.MetricDataResults ?? []) {
      if (!r.Id) continue;
      const ts = r.Timestamps ?? [];
      const vals = r.Values ?? [];
      const points: { ts: Date; value: number }[] = [];
      for (let j = 0; j < ts.length; j++) {
        const t = ts[j];
        const v = vals[j];
        if (t && v !== undefined) points.push({ ts: t, value: v });
      }
      out.set(r.Id, points);
    }
  }
  return out;
}

function emptyBuckets(window: WindowConfig, now: Date): ChartPoint[] {
  const out: ChartPoint[] = [];
  // Pre-fill so the chart is always the same length even when no data lands.
  // For 24h we step backward by 1 hour; for 7d by 1 day. Truncate the cursor
  // to the boundary so bucket keys match what CloudWatch returns.
  const stepMs = window.periodSec * 1000;
  const truncate = (d: Date): Date => {
    if (window.periodSec === 3600) {
      const c = new Date(d);
      c.setUTCMinutes(0, 0, 0);
      return c;
    }
    const c = new Date(d);
    c.setUTCHours(0, 0, 0, 0);
    return c;
  };
  let cursor = truncate(now);
  for (let i = 0; i < window.bucketCount; i++) {
    out.unshift({ bucket: window.bucketKey(cursor), value: 0 });
    cursor = new Date(cursor.getTime() - stepMs);
  }
  return out;
}

function applyToBuckets(buckets: ChartPoint[], points: { ts: Date; value: number }[], window: WindowConfig): void {
  // Map for fast lookup; ChartPoint[] is small (≤24) so this is cheap.
  const idx = new Map<string, number>();
  for (let i = 0; i < buckets.length; i++) idx.set(buckets[i]!.bucket, i);
  for (const p of points) {
    const key = window.bucketKey(p.ts);
    const i = idx.get(key);
    if (i !== undefined) buckets[i]!.value += p.value;
  }
}

// ── ARN parsers + console URL builders ───────────────────────────────────────

function lambdaName(arn: string): string | null {
  const m = /:function:([^:]+)/.exec(arn);
  return m ? m[1]! : null;
}

function albDim(arn: string): string | null {
  const m = /loadbalancer\/(app\/[^/]+\/[^/]+)$/.exec(arn);
  return m ? m[1]! : null;
}

function firehoseName(arn: string): string | null {
  const m = /deliverystream\/(.+)$/.exec(arn);
  return m ? m[1]! : null;
}

function snsName(arn: string): string | null {
  // arn:aws:sns:region:account:NAME
  const parts = arn.split(':');
  return parts[5] ?? null;
}

function sqsName(arn: string): string | null {
  const parts = arn.split(':');
  return parts[5] ?? null;
}

function isDlq(name: string): boolean {
  return DLQ_NAME_PATTERNS.some((re) => re.test(name));
}

function dynamoTableName(arn: string): string | null {
  const m = /:table\/([^/]+)/.exec(arn);
  return m ? m[1]! : null;
}

function stateMachineConsoleUrl(region: string, arn: string): string {
  return `https://${region}.console.aws.amazon.com/states/home?region=${region}#/statemachines/view/${encodeURIComponent(arn)}`;
}

// ── Per-category builders ────────────────────────────────────────────────────

interface CategoryFetch {
  resources: ResourceMeta[];
  queries: MetricDataQuery[];
  /**
   * Map from a resource's metric query Id(s) back to the resource. When a
   * single resource has multiple metrics we sum the results before storing.
   */
  resourceByQId: Map<string, ResourceMeta>;
  /**
   * Optional secondary-query map: { secondaryQueryId → primaryResourceQId }.
   * Used when one resource has multiple metrics that combine into one error
   * count (ALB target+ELB 5xx, DynamoDB user+system+throttled).
   */
  extraQIds?: Map<string, string>;
}

async function buildLambda(
  tagging: ResourceGroupsTaggingAPIClient,
  region: string,
  windowCfg: WindowConfig,
): Promise<CategoryFetch> {
  const arns = await arnsByEnvironment(tagging, 'lambda:function', PRODUCTION_ENV_TAG);
  const resources: ResourceMeta[] = [];
  const queries: MetricDataQuery[] = [];
  const resourceByQId = new Map<string, ResourceMeta>();
  arns.forEach((arn, i) => {
    const name = lambdaName(arn);
    if (!name) return;
    const meta: ResourceMeta = {
      qId: `lam${i}`,
      name,
      consoleUrl: `https://${region}.console.aws.amazon.com/lambda/home?region=${region}#/functions/${encodeURIComponent(name)}?tab=monitor`,
    };
    resources.push(meta);
    resourceByQId.set(meta.qId, meta);
    queries.push({
      Id: meta.qId,
      MetricStat: {
        Metric: { Namespace: 'AWS/Lambda', MetricName: 'Errors', Dimensions: [{ Name: 'FunctionName', Value: name }] },
        Period: windowCfg.periodSec,
        Stat: 'Sum',
      },
      ReturnData: true,
    });
  });
  return { resources, queries, resourceByQId };
}

async function buildAlb(
  tagging: ResourceGroupsTaggingAPIClient,
  region: string,
  windowCfg: WindowConfig,
): Promise<CategoryFetch> {
  // ALB has TWO metrics combined into one error count, so we need a second
  // query per resource. extraQIds maps the secondary qId back to the primary.
  const arns = await arnsByEnvironment(tagging, 'elasticloadbalancing:loadbalancer', PRODUCTION_ENV_TAG);
  const resources: ResourceMeta[] = [];
  const queries: MetricDataQuery[] = [];
  const resourceByQId = new Map<string, ResourceMeta>();
  const extraQIds = new Map<string, string>();
  arns.forEach((arn, i) => {
    const dim = albDim(arn);
    if (!dim) return;
    const meta: ResourceMeta = {
      qId: `alb${i}t`,
      name: dim,
      consoleUrl: `https://${region}.console.aws.amazon.com/ec2/home?region=${region}#LoadBalancer:loadBalancerArn=${encodeURIComponent(arn)}`,
    };
    resources.push(meta);
    resourceByQId.set(meta.qId, meta);
    extraQIds.set(`alb${i}e`, meta.qId);
    queries.push({
      Id: meta.qId,
      MetricStat: {
        Metric: { Namespace: 'AWS/ApplicationELB', MetricName: 'HTTPCode_Target_5XX_Count', Dimensions: [{ Name: 'LoadBalancer', Value: dim }] },
        Period: windowCfg.periodSec,
        Stat: 'Sum',
      },
      ReturnData: true,
    });
    queries.push({
      Id: `alb${i}e`,
      MetricStat: {
        Metric: { Namespace: 'AWS/ApplicationELB', MetricName: 'HTTPCode_ELB_5XX_Count', Dimensions: [{ Name: 'LoadBalancer', Value: dim }] },
        Period: windowCfg.periodSec,
        Stat: 'Sum',
      },
      ReturnData: true,
    });
  });
  return { resources, queries, resourceByQId, extraQIds };
}

async function buildFirehose(
  tagging: ResourceGroupsTaggingAPIClient,
  region: string,
  windowCfg: WindowConfig,
): Promise<CategoryFetch> {
  const arns = await arnsByEnvironment(tagging, 'firehose:deliverystream', PRODUCTION_ENV_TAG);
  const resources: ResourceMeta[] = [];
  const queries: MetricDataQuery[] = [];
  const resourceByQId = new Map<string, ResourceMeta>();
  arns.forEach((arn, i) => {
    const name = firehoseName(arn);
    if (!name) return;
    const meta: ResourceMeta = {
      qId: `fh${i}`,
      name,
      consoleUrl: `https://${region}.console.aws.amazon.com/firehose/home?region=${region}#/details/${encodeURIComponent(name)}/monitoring`,
    };
    resources.push(meta);
    resourceByQId.set(meta.qId, meta);
    queries.push({
      Id: meta.qId,
      MetricStat: {
        Metric: { Namespace: 'AWS/Firehose', MetricName: 'ThrottledRecords', Dimensions: [{ Name: 'DeliveryStreamName', Value: name }] },
        Period: windowCfg.periodSec,
        Stat: 'Sum',
      },
      ReturnData: true,
    });
  });
  return { resources, queries, resourceByQId };
}

async function buildSns(
  tagging: ResourceGroupsTaggingAPIClient,
  region: string,
  windowCfg: WindowConfig,
): Promise<CategoryFetch> {
  const arns = await arnsByEnvironment(tagging, 'sns:topic', PRODUCTION_ENV_TAG);
  const resources: ResourceMeta[] = [];
  const queries: MetricDataQuery[] = [];
  const resourceByQId = new Map<string, ResourceMeta>();
  arns.forEach((arn, i) => {
    const name = snsName(arn);
    if (!name) return;
    const meta: ResourceMeta = {
      qId: `sns${i}`,
      name,
      consoleUrl: `https://${region}.console.aws.amazon.com/sns/v3/home?region=${region}#/topic/${encodeURIComponent(arn)}`,
    };
    resources.push(meta);
    resourceByQId.set(meta.qId, meta);
    queries.push({
      Id: meta.qId,
      MetricStat: {
        Metric: { Namespace: 'AWS/SNS', MetricName: 'NumberOfNotificationsFailed', Dimensions: [{ Name: 'TopicName', Value: name }] },
        Period: windowCfg.periodSec,
        Stat: 'Sum',
      },
      ReturnData: true,
    });
  });
  return { resources, queries, resourceByQId };
}

async function buildSqs(
  tagging: ResourceGroupsTaggingAPIClient,
  region: string,
  windowCfg: WindowConfig,
): Promise<CategoryFetch> {
  const arns = await arnsByEnvironment(tagging, 'sqs', PRODUCTION_ENV_TAG);
  const resources: ResourceMeta[] = [];
  const queries: MetricDataQuery[] = [];
  const resourceByQId = new Map<string, ResourceMeta>();
  arns.forEach((arn, i) => {
    const name = sqsName(arn);
    if (!name || !isDlq(name)) return;  // Only DLQs — non-DLQ depth isn't a failure
    const meta: ResourceMeta = {
      qId: `sqs${i}`,
      name,
      consoleUrl: `https://${region}.console.aws.amazon.com/sqs/v3/home?region=${region}#/queues/${encodeURIComponent(`https://sqs.${region}.amazonaws.com/${arn.split(':')[4]}/${name}`)}`,
    };
    resources.push(meta);
    resourceByQId.set(meta.qId, meta);
    queries.push({
      Id: meta.qId,
      MetricStat: {
        // DLQ depth — Sum doesn't make sense for a gauge, use Maximum to surface
        // any visible messages during the window.
        Metric: { Namespace: 'AWS/SQS', MetricName: 'ApproximateNumberOfMessagesVisible', Dimensions: [{ Name: 'QueueName', Value: name }] },
        Period: windowCfg.periodSec,
        Stat: 'Maximum',
      },
      ReturnData: true,
    });
  });
  return { resources, queries, resourceByQId };
}

async function buildDynamo(
  tagging: ResourceGroupsTaggingAPIClient,
  region: string,
  windowCfg: WindowConfig,
): Promise<CategoryFetch> {
  // DynamoDB has THREE failure metrics combined: UserErrors, SystemErrors,
  // ThrottledRequests. Same per-resource pattern as ALB.
  const arns = await arnsByEnvironment(tagging, 'dynamodb:table', PRODUCTION_ENV_TAG);
  const resources: ResourceMeta[] = [];
  const queries: MetricDataQuery[] = [];
  const resourceByQId = new Map<string, ResourceMeta>();
  const extraQIds = new Map<string, string>();
  arns.forEach((arn, i) => {
    const name = dynamoTableName(arn);
    if (!name) return;
    const primary = `ddb${i}u`;
    const meta: ResourceMeta = {
      qId: primary,
      name,
      consoleUrl: `https://${region}.console.aws.amazon.com/dynamodbv2/home?region=${region}#table?name=${encodeURIComponent(name)}&tab=monitoring`,
    };
    resources.push(meta);
    resourceByQId.set(primary, meta);
    extraQIds.set(`ddb${i}s`, primary);
    extraQIds.set(`ddb${i}t`, primary);
    const dims = [{ Name: 'TableName', Value: name }];
    queries.push(
      { Id: primary,        MetricStat: { Metric: { Namespace: 'AWS/DynamoDB', MetricName: 'UserErrors',         Dimensions: dims }, Period: windowCfg.periodSec, Stat: 'Sum' }, ReturnData: true },
      { Id: `ddb${i}s`,     MetricStat: { Metric: { Namespace: 'AWS/DynamoDB', MetricName: 'SystemErrors',       Dimensions: dims }, Period: windowCfg.periodSec, Stat: 'Sum' }, ReturnData: true },
      { Id: `ddb${i}t`,     MetricStat: { Metric: { Namespace: 'AWS/DynamoDB', MetricName: 'ThrottledRequests',  Dimensions: dims }, Period: windowCfg.periodSec, Stat: 'Sum' }, ReturnData: true },
    );
  });
  return { resources, queries, resourceByQId, extraQIds };
}

async function buildApiGateway(
  apigw: APIGatewayClient,
  tagging: ResourceGroupsTaggingAPIClient,
  region: string,
  windowCfg: WindowConfig,
): Promise<CategoryFetch> {
  // ResourceGroupsTaggingAPI returns ARNs with the API ID, but the CloudWatch
  // dimension `ApiName` is the user-given name. So we look up name+tags from
  // the API Gateway SDK directly and intersect with tagged ARNs.
  const [arns, listResp] = await Promise.all([
    arnsByEnvironment(tagging, 'apigateway:restapis', PRODUCTION_ENV_TAG),
    apigw.send(new GetRestApisCommand({ limit: 500 })),
  ]);
  const taggedIds = new Set(arns.map((a) => a.split('/').pop() ?? '').filter(Boolean));
  const apis = (listResp.items ?? []).filter((a) => a.id && taggedIds.has(a.id) && a.name);

  const resources: ResourceMeta[] = [];
  const queries: MetricDataQuery[] = [];
  const resourceByQId = new Map<string, ResourceMeta>();
  apis.forEach((api, i) => {
    const name = api.name!;
    const meta: ResourceMeta = {
      qId: `apigw${i}`,
      name,
      consoleUrl: `https://${region}.console.aws.amazon.com/apigateway/home?region=${region}#/apis/${api.id}/dashboard`,
    };
    resources.push(meta);
    resourceByQId.set(meta.qId, meta);
    queries.push({
      Id: meta.qId,
      MetricStat: {
        Metric: { Namespace: 'AWS/ApiGateway', MetricName: '5XXError', Dimensions: [{ Name: 'ApiName', Value: name }] },
        Period: windowCfg.periodSec,
        Stat: 'Sum',
      },
      ReturnData: true,
    });
  });
  return { resources, queries, resourceByQId };
}

async function buildStepFunctions(
  tagging: ResourceGroupsTaggingAPIClient,
  region: string,
  windowCfg: WindowConfig,
): Promise<CategoryFetch> {
  // For SFN, the CloudWatch dimension `StateMachineArn` IS the ARN itself —
  // no name resolution needed.
  const arns = await arnsByEnvironment(tagging, 'states:stateMachine', PRODUCTION_ENV_TAG);
  const resources: ResourceMeta[] = [];
  const queries: MetricDataQuery[] = [];
  const resourceByQId = new Map<string, ResourceMeta>();
  arns.forEach((arn, i) => {
    const name = arn.split(':').pop() ?? arn;
    const meta: ResourceMeta = {
      qId: `sfn${i}`,
      name,
      consoleUrl: stateMachineConsoleUrl(region, arn),
    };
    resources.push(meta);
    resourceByQId.set(meta.qId, meta);
    queries.push({
      Id: meta.qId,
      MetricStat: {
        Metric: { Namespace: 'AWS/States', MetricName: 'ExecutionsFailed', Dimensions: [{ Name: 'StateMachineArn', Value: arn }] },
        Period: windowCfg.periodSec,
        Stat: 'Sum',
      },
      ReturnData: true,
    });
  });
  return { resources, queries, resourceByQId };
}

// ── Aggregation: turn a CategoryFetch + raw points into a CategoryResult ─────

function aggregateCategory(
  category: ServiceCategory,
  label: string,
  metric: string,
  fetch: CategoryFetch,
  rawByQId: Map<string, { ts: Date; value: number }[]>,
  windowCfg: WindowConfig,
  now: Date,
): CategoryResult {
  const buckets = emptyBuckets(windowCfg, now);
  const totals = new Map<string, number>();   // resource qId → totalErrors
  const points = new Map<string, { ts: Date; value: number }[]>();
  for (const meta of fetch.resources) {
    points.set(meta.qId, []);
    totals.set(meta.qId, 0);
  }

  // Primary metric points
  for (const meta of fetch.resources) {
    const pts = rawByQId.get(meta.qId) ?? [];
    points.get(meta.qId)!.push(...pts);
    for (const p of pts) totals.set(meta.qId, (totals.get(meta.qId) ?? 0) + p.value);
  }

  // Extra metrics that combine into the primary resource's total (ALB, Dynamo)
  if (fetch.extraQIds) {
    for (const [extraQId, primaryQId] of fetch.extraQIds.entries()) {
      const pts = rawByQId.get(extraQId) ?? [];
      points.get(primaryQId)!.push(...pts);
      for (const p of pts) totals.set(primaryQId, (totals.get(primaryQId) ?? 0) + p.value);
    }
  }

  // Roll into buckets
  for (const [qId, pts] of points.entries()) {
    if (pts.length > 0) applyToBuckets(buckets, pts, windowCfg);
    void qId;
  }

  const totalErrors = [...totals.values()].reduce((s, v) => s + v, 0);
  const resources: ResourceErrorEntry[] = fetch.resources
    .map((m) => ({ name: m.name, errors: Math.round(totals.get(m.qId) ?? 0), consoleUrl: m.consoleUrl }))
    .filter((r) => r.errors > 0)
    .sort((a, b) => b.errors - a.errors);

  return { category, label, metric, totalErrors: Math.round(totalErrors), chart: buckets, resources };
}

// ── Per-category execution ───────────────────────────────────────────────────

async function runCategory(
  category: ServiceCategory,
  windowCfg: WindowConfig,
  now: Date,
  cw: CloudWatchClient,
  tagging: ResourceGroupsTaggingAPIClient,
  apigw: APIGatewayClient,
  region: string,
): Promise<CategoryResult> {
  const start = new Date(now.getTime() - windowCfg.ms);
  let fetch: CategoryFetch;
  switch (category) {
    case 'lambda':        fetch = await buildLambda(tagging, region, windowCfg); break;
    case 'alb':           fetch = await buildAlb(tagging, region, windowCfg); break;
    case 'firehose':      fetch = await buildFirehose(tagging, region, windowCfg); break;
    case 'sns':           fetch = await buildSns(tagging, region, windowCfg); break;
    case 'sqs':           fetch = await buildSqs(tagging, region, windowCfg); break;
    case 'dynamodb':      fetch = await buildDynamo(tagging, region, windowCfg); break;
    case 'apigateway':    fetch = await buildApiGateway(apigw, tagging, region, windowCfg); break;
    case 'stepfunctions': fetch = await buildStepFunctions(tagging, region, windowCfg); break;
  }
  const rawByQId = fetch.queries.length > 0
    ? await fetchMetricData(cw, fetch.queries, start, now)
    : new Map<string, { ts: Date; value: number }[]>();
  const meta = CATEGORY_META[category];
  return aggregateCategory(category, meta.label, meta.metric, fetch, rawByQId, windowCfg, now);
}

// ── Router ───────────────────────────────────────────────────────────────────

export function createErrorsRouter(): Router {
  const router = Router();

  // GET /errors — lightweight catalog of categories. The frontend uses this to
  // render placeholder cards immediately, then fires one /errors/:category call
  // per card so each tile populates as soon as its data lands.
  router.get('/', (_req, res) => {
    res.json({
      categories: ALL_CATEGORIES.map((c) => CATEGORY_META[c]),
    });
  });

  // GET /errors/:category — runs a single category. Independent failure: if one
  // category 500s, the others still render.
  router.get('/:category', async (req, res) => {
    const category = req.params.category;
    if (!isCategory(category)) {
      res.status(400).json({
        type: 'about:blank',
        title: 'Unknown category',
        status: 400,
        detail: `Expected one of: ${ALL_CATEGORIES.join(', ')}`,
      });
      return;
    }
    const region = process.env['AWS_REGION'] ?? 'me-south-1';
    const windowParam: ErrorsWindow = req.query['window'] === '7d' ? '7d' : '24h';
    const windowCfg = WINDOWS[windowParam];
    const now = new Date();

    const credentials = credentialStore.getProvider();
    const cw = new CloudWatchClient({ region, credentials });
    const tagging = new ResourceGroupsTaggingAPIClient({ region, credentials });
    const apigw = new APIGatewayClient({ region, credentials });

    try {
      const result = await runCategory(category, windowCfg, now, cw, tagging, apigw, region);
      res.json({
        window: windowParam,
        generatedAt: now.toISOString(),
        ...result,
      });
    } catch (err) {
      console.warn(`[errors] ${category} failed:`, err instanceof Error ? err.message : String(err));
      res.status(500).json({
        type: 'about:blank',
        title: `${CATEGORY_META[category].label} failed`,
        status: 500,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
