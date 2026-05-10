import { Router } from 'express';
import {
  CloudWatchClient,
  DescribeAlarmsCommand,
  DynamoDBDocumentClient,
  QueryCommand,
  GetMetricDataCommand,
  ResourceGroupsTaggingAPIClient,
  GetResourcesCommand,
  APIGatewayClient,
  GetRestApisCommand,
  type MetricAlarm,
  type MetricDataQuery,
  credentialStore,
} from '@wep/aws-clients';
import type { SearchServicesHandler } from '@wep/service-catalog';
import type { Service } from '@wep/service-catalog';

const AUTOSCALING_PREFIXES = [
  'TargetTracking-',
  'ScaleIn-',
  'ScaleOut-',
  'AWSSEBAutoScaling',
];

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const HEALTH_HOURS = 24;
const HOURLY_PERIOD_SEC = 3_600;
const PRODUCTION_ENV_TAG = 'Production';
const GET_METRIC_DATA_BATCH = 500;
const DLQ_NAME_PATTERNS = [/-dlq$/i, /-deadletter$/i, /-dead-letter$/i, /-dead_letter$/i];

function isAutoScalingAlarm(name: string): boolean {
  return AUTOSCALING_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function alarmConsoleUrl(alarmName: string, region: string): string {
  return `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#alarmsV2:alarm/${encodeURIComponent(alarmName)}`;
}

async function drainAllServices(searchServices: SearchServicesHandler): Promise<Service[]> {
  const all: Service[] = [];
  let cursor: string | undefined;
  do {
    const result = await searchServices.execute({ pagination: { limit: 500, cursor } });
    if (!result.ok) break;
    all.push(...result.value.items);
    cursor = result.value.nextCursor;
  } while (cursor);
  return all;
}

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

function lambdaNameFromArn(arn: string): string | null {
  // arn:aws:lambda:region:account:function:name[:qualifier]
  const parts = arn.split(':function:');
  if (parts.length !== 2) return null;
  return parts[1]!.split(':')[0]!;
}

function albDimFromArn(arn: string): string | null {
  // arn:...:loadbalancer/app/name/id  →  CloudWatch dimension value: app/name/id
  const m = /loadbalancer\/(app\/[^/]+\/[^/]+)$/.exec(arn);
  return m ? m[1]! : null;
}

interface TrendPoint {
  date: string;          // ISO yyyy-mm-dd
  healthPct: number;     // 0-100
  errors: number;        // total 5xx + Lambda errors that day
  requests: number;      // total ALB requests + Lambda invocations that day
}

interface HealthTrend {
  currentPct: number;
  deltaPct: number;
  trend: TrendPoint[];
  resourceCounts: {
    lambdas: number;
    albs: number;
    firehose: number;
    sns: number;
    sqsDlqs: number;
    dynamodb: number;
    apigateway: number;
    stepfunctions: number;
  };
}

function isDlqName(name: string): boolean {
  return DLQ_NAME_PATTERNS.some((re) => re.test(name));
}

function hourKey(d: Date): string {
  // ISO yyyy-mm-ddTHH (UTC). CloudWatch returns hourly datapoints already
  // bucketed at the start of the hour, which makes this key match cleanly.
  return d.toISOString().slice(0, 13);
}

/**
 * Platform health over the last 24 hours, derived from real production traffic
 * across every category the Errors page measures. We pull the same metrics as
 * /errors but cap the window at 24 hours with hourly granularity so the data
 * volume stays low (24 datapoints per metric) and the value stays comparable
 * across navigations (full window aggregates, not a partial "today" bucket).
 *
 * Signals (per-resource, tagged Environment=Production):
 *   Errors numerator            | Requests denominator
 *   ─────────────────────────────┼──────────────────────────────────
 *   Lambda Errors               | Lambda Invocations
 *   ALB Target 5xx + ELB 5xx    | ALB RequestCount
 *   API Gateway 5XXError        | API Gateway Count
 *   Step Functions Failed       | Step Functions Started
 *   SNS NotificationsFailed     | SNS NumberOfMessagesPublished
 *   Firehose ThrottledRecords   | Firehose IncomingRecords
 *   DynamoDB UserErrors+SystemErrors+ThrottledRequests | (no clean denom — adds to errors only)
 *   SQS DLQ depth (Maximum)     | (no denom — adds to errors only)
 *
 * healthPct(window) = (1 - totalErrors / totalRequests) * 100, clamped [0,100].
 *                     100% when there's no traffic at all.
 */
async function computeHealthFromMetrics(
  cw: CloudWatchClient,
  tagging: ResourceGroupsTaggingAPIClient,
  apigw: APIGatewayClient,
): Promise<HealthTrend> {
  // Discover production resources for every category in parallel.
  const [
    lambdaArns,
    albArns,
    firehoseArns,
    snsArns,
    sqsArns,
    dynamoArns,
    apigwTaggedArns,
    sfnArns,
    restApiList,
  ] = await Promise.all([
    arnsByEnvironment(tagging, 'lambda:function', PRODUCTION_ENV_TAG),
    arnsByEnvironment(tagging, 'elasticloadbalancing:loadbalancer', PRODUCTION_ENV_TAG),
    arnsByEnvironment(tagging, 'firehose:deliverystream', PRODUCTION_ENV_TAG),
    arnsByEnvironment(tagging, 'sns:topic', PRODUCTION_ENV_TAG),
    arnsByEnvironment(tagging, 'sqs', PRODUCTION_ENV_TAG),
    arnsByEnvironment(tagging, 'dynamodb:table', PRODUCTION_ENV_TAG),
    arnsByEnvironment(tagging, 'apigateway:restapis', PRODUCTION_ENV_TAG),
    arnsByEnvironment(tagging, 'states:stateMachine', PRODUCTION_ENV_TAG),
    apigw.send(new GetRestApisCommand({ limit: 500 })),
  ]);

  const queries: MetricDataQuery[] = [];
  // qId → role: 'errors' contributes to the error count, 'requests' to the
  // denominator. Anything not in the map gets ignored.
  const qRole = new Map<string, 'errors' | 'requests'>();

  const addError = (id: string) => qRole.set(id, 'errors');
  const addRequest = (id: string) => qRole.set(id, 'requests');

  const stat = (
    id: string,
    namespace: string,
    metric: string,
    dimName: string,
    dimVal: string,
    s: 'Sum' | 'Maximum' = 'Sum',
  ): MetricDataQuery => ({
    Id: id,
    MetricStat: {
      Metric: { Namespace: namespace, MetricName: metric, Dimensions: [{ Name: dimName, Value: dimVal }] },
      Period: HOURLY_PERIOD_SEC,
      Stat: s,
    },
    ReturnData: true,
  });

  // Lambda
  const lambdaNames = lambdaArns.map(lambdaNameFromArn).filter((x): x is string => !!x);
  lambdaNames.forEach((name, i) => {
    queries.push(stat(`le${i}`, 'AWS/Lambda', 'Errors',      'FunctionName', name)); addError(`le${i}`);
    queries.push(stat(`li${i}`, 'AWS/Lambda', 'Invocations', 'FunctionName', name)); addRequest(`li${i}`);
  });

  // ALB (target 5xx + ELB 5xx, both → errors; RequestCount → requests)
  const albDims = albArns.map(albDimFromArn).filter((x): x is string => !!x);
  albDims.forEach((dim, i) => {
    queries.push(stat(`at${i}`, 'AWS/ApplicationELB', 'HTTPCode_Target_5XX_Count', 'LoadBalancer', dim)); addError(`at${i}`);
    queries.push(stat(`ae${i}`, 'AWS/ApplicationELB', 'HTTPCode_ELB_5XX_Count',    'LoadBalancer', dim)); addError(`ae${i}`);
    queries.push(stat(`ar${i}`, 'AWS/ApplicationELB', 'RequestCount',              'LoadBalancer', dim)); addRequest(`ar${i}`);
  });

  // Firehose (throttled records → errors; incoming → requests)
  const firehoseNames = firehoseArns
    .map((arn) => /deliverystream\/(.+)$/.exec(arn)?.[1])
    .filter((n): n is string => !!n);
  firehoseNames.forEach((name, i) => {
    queries.push(stat(`fhe${i}`, 'AWS/Firehose', 'ThrottledRecords', 'DeliveryStreamName', name)); addError(`fhe${i}`);
    queries.push(stat(`fhi${i}`, 'AWS/Firehose', 'IncomingRecords',  'DeliveryStreamName', name)); addRequest(`fhi${i}`);
  });

  // SNS (failed → errors; published → requests)
  const snsNames = snsArns
    .map((arn) => arn.split(':')[5])
    .filter((n): n is string => !!n);
  snsNames.forEach((name, i) => {
    queries.push(stat(`sne${i}`, 'AWS/SNS', 'NumberOfNotificationsFailed', 'TopicName', name)); addError(`sne${i}`);
    queries.push(stat(`snp${i}`, 'AWS/SNS', 'NumberOfMessagesPublished',   'TopicName', name)); addRequest(`snp${i}`);
  });

  // SQS DLQs only — depth → errors. No denominator (gauge metric).
  const sqsDlqNames = sqsArns
    .map((arn) => arn.split(':')[5])
    .filter((n): n is string => !!n && isDlqName(n));
  sqsDlqNames.forEach((name, i) => {
    queries.push(stat(`sqe${i}`, 'AWS/SQS', 'ApproximateNumberOfMessagesVisible', 'QueueName', name, 'Maximum'));
    addError(`sqe${i}`);
  });

  // DynamoDB (errors only — no single canonical denominator)
  const dynamoNames = dynamoArns
    .map((arn) => /:table\/([^/]+)/.exec(arn)?.[1])
    .filter((n): n is string => !!n);
  dynamoNames.forEach((name, i) => {
    queries.push(stat(`due${i}`, 'AWS/DynamoDB', 'UserErrors',        'TableName', name)); addError(`due${i}`);
    queries.push(stat(`dse${i}`, 'AWS/DynamoDB', 'SystemErrors',      'TableName', name)); addError(`dse${i}`);
    queries.push(stat(`dte${i}`, 'AWS/DynamoDB', 'ThrottledRequests', 'TableName', name)); addError(`dte${i}`);
  });

  // API Gateway (REST APIs only). Tagging API returns ARNs containing the API
  // ID; CloudWatch dimension is the API name. Resolve via GetRestApis ∩ tagged.
  const taggedRestIds = new Set(apigwTaggedArns.map((a) => a.split('/').pop() ?? '').filter(Boolean));
  const apiNames = (restApiList.items ?? [])
    .filter((api) => api.id && api.name && taggedRestIds.has(api.id))
    .map((api) => api.name!);
  apiNames.forEach((name, i) => {
    queries.push(stat(`age${i}`, 'AWS/ApiGateway', '5XXError', 'ApiName', name)); addError(`age${i}`);
    queries.push(stat(`agc${i}`, 'AWS/ApiGateway', 'Count',    'ApiName', name)); addRequest(`agc${i}`);
  });

  // Step Functions — dimension IS the ARN.
  sfnArns.forEach((arn, i) => {
    queries.push(stat(`sfe${i}`, 'AWS/States', 'ExecutionsFailed',  'StateMachineArn', arn)); addError(`sfe${i}`);
    queries.push(stat(`sfs${i}`, 'AWS/States', 'ExecutionsStarted', 'StateMachineArn', arn)); addRequest(`sfs${i}`);
  });

  // Pre-init 24 hourly buckets so the chart always covers the window even on
  // quiet hours.
  const now = new Date();
  const start = new Date(now.getTime() - HEALTH_HOURS * HOUR_MS);
  const byHour = new Map<string, { errors: number; requests: number }>();
  for (let h = HEALTH_HOURS - 1; h >= 0; h--) {
    const at = new Date(now.getTime() - h * HOUR_MS);
    at.setUTCMinutes(0, 0, 0);
    byHour.set(hourKey(at), { errors: 0, requests: 0 });
  }

  // Fetch in batches of 500 queries (SDK limit).
  for (let i = 0; i < queries.length; i += GET_METRIC_DATA_BATCH) {
    const batch = queries.slice(i, i + GET_METRIC_DATA_BATCH);
    const result = await cw.send(new GetMetricDataCommand({
      MetricDataQueries: batch,
      StartTime: start,
      EndTime: now,
      ScanBy: 'TimestampAscending',
    }));
    for (const r of result.MetricDataResults ?? []) {
      const role = qRole.get(r.Id ?? '');
      if (!role) continue;
      const ts = r.Timestamps ?? [];
      const vals = r.Values ?? [];
      for (let j = 0; j < ts.length; j++) {
        const stamp = ts[j];
        const val = vals[j];
        if (!stamp || val === undefined) continue;
        const bucket = byHour.get(hourKey(stamp));
        if (!bucket) continue;
        if (role === 'errors') bucket.errors += val;
        else bucket.requests += val;
      }
    }
  }

  const trend: TrendPoint[] = [...byHour.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { errors, requests }]) => {
      const errorRate = requests > 0 ? errors / requests : 0;
      const healthPct = Math.max(0, Math.min(100, Math.round((1 - errorRate) * 1000) / 10));
      return { date, healthPct, errors: Math.round(errors), requests: Math.round(requests) };
    });

  // currentPct = aggregate over the WHOLE 24-hour window. Stable across
  // navigations: the same window/data → same number. Only changes when:
  //   (a) the hour rolls over (oldest hour drops, newest hour appears), or
  //   (b) CloudWatch backfills late-arriving datapoints.
  const totalErrors = trend.reduce((s, p) => s + p.errors, 0);
  const totalRequests = trend.reduce((s, p) => s + p.requests, 0);
  const overallRate = totalRequests > 0 ? totalErrors / totalRequests : 0;
  const currentPct = Math.max(0, Math.min(100, Math.round((1 - overallRate) * 1000) / 10));

  // Delta = current vs the oldest hour in the window.
  const oldest = trend[0];
  const deltaPct = oldest ? Math.round((currentPct - oldest.healthPct) * 10) / 10 : 0;

  return {
    currentPct,
    deltaPct,
    trend,
    resourceCounts: {
      lambdas:       lambdaNames.length,
      albs:          albDims.length,
      firehose:      firehoseNames.length,
      sns:           snsNames.length,
      sqsDlqs:       sqsDlqNames.length,
      dynamodb:      dynamoNames.length,
      apigateway:    apiNames.length,
      stepfunctions: sfnArns.length,
    },
  };
}

async function countRunbooks(dynamo: DynamoDBDocumentClient, tableName: string): Promise<number> {
  let total = 0;
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await dynamo.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': 'RUNBOOK_LIST' },
      Select: 'COUNT',
      ExclusiveStartKey: lastKey,
    }));
    total += result.Count ?? 0;
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return total;
}

function daysSinceSync(svc: Service, now: number): number {
  const lastSyncedAt = svc.lastSyncedAt ?? new Date(0).toISOString();
  return Math.floor((now - new Date(lastSyncedAt).getTime()) / DAY_MS);
}

function isStaleInEnvironment(svc: Service, env: string, now: number): boolean {
  // "Stale" means the service exists in the given environment AND hasn't been
  // synced in 30+ days — matches the StaleServicesPage "Stale >30D" stat.
  return svc.environments.includes(env as typeof svc.environments[number]) && daysSinceSync(svc, now) > 30;
}

export function createDashboardRouter(
  searchServices: SearchServicesHandler,
  dynamo: DynamoDBDocumentClient,
  runbooksTable: string,
): Router {
  const router = Router();

  // GET / — fast path. Currently-firing alarms, degraded services, tile counts.
  // The 30-day health trend is computed by /health-trend (lazy-loaded).
  router.get('/', async (_req, res) => {
    const region = process.env['AWS_REGION'] ?? 'me-south-1';
    const cw = new CloudWatchClient({ region, credentials: credentialStore.getProvider() });

    const firingPromise: Promise<MetricAlarm[]> = (async () => {
      try {
        const result: MetricAlarm[] = [];
        let nextToken: string | undefined;
        do {
          const r = await cw.send(new DescribeAlarmsCommand({
            StateValue: 'ALARM',
            MaxRecords: 100,
            NextToken: nextToken,
          }));
          result.push(...(r.MetricAlarms ?? []));
          nextToken = r.NextToken;
        } while (nextToken);
        return result.filter((a) => !isAutoScalingAlarm(a.AlarmName ?? ''));
      } catch (err) {
        console.warn('[dashboard] CloudWatch DescribeAlarms failed:', err instanceof Error ? err.message : String(err));
        return [];
      }
    })();

    const servicesPromise: Promise<Service[]> = (async () => {
      try { return await drainAllServices(searchServices); }
      catch (err) {
        console.warn('[dashboard] Service catalog drain failed:', err);
        return [];
      }
    })();

    const runbooksCountPromise: Promise<number> = (async () => {
      try { return await countRunbooks(dynamo, runbooksTable); }
      catch (err) {
        console.warn('[dashboard] Runbook count failed:', err instanceof Error ? err.message : String(err));
        return 0;
      }
    })();

    const [firing, services, runbooksCount] = await Promise.all([
      firingPromise,
      servicesPromise,
      runbooksCountPromise,
    ]);

    const degraded = services.filter(
      (s) => s.healthStatus.status === 'degraded' || s.healthStatus.status === 'unhealthy',
    );
    const now = Date.now();
    const staleServicesProdCount = services.filter((s) => isStaleInEnvironment(s, 'production', now)).length;
    const staleServicesDevCount  = services.filter((s) => isStaleInEnvironment(s, 'development', now)).length;

    const alarms = firing.map((a) => ({
      name: a.AlarmName ?? '',
      state: a.StateValue ?? 'UNKNOWN',
      namespace: a.Namespace ?? '',
      metric: a.MetricName ?? '',
      region,
      updatedAt: a.StateUpdatedTimestamp?.toISOString() ?? new Date().toISOString(),
      consoleUrl: alarmConsoleUrl(a.AlarmName ?? '', region),
    }));

    const degradedServices = degraded.map((s) => ({
      serviceId: s.serviceId,
      serviceName: s.serviceName,
      status: s.healthStatus.status,
      signals: s.healthStatus.signals.map((sig) => `${sig.source}: ${sig.status}`),
    }));

    res.json({
      alarms,
      degradedServices,
      tiles: {
        staleServicesProdCount,
        staleServicesDevCount,
        runbooksCount,
        servicesTotal: services.length,
        degradedCount: degraded.length,
      },
    });
  });

  // GET /health-trend — derives platform health from real production traffic
  // (ALB 5xx + Lambda Errors against ALB requests + Lambda invocations) for
  // resources tagged Environment=Production. Daily aggregation over 30 days.
  router.get('/health-trend', async (_req, res) => {
    const region = process.env['AWS_REGION'] ?? 'me-south-1';
    const credentials = credentialStore.getProvider();
    const cw = new CloudWatchClient({ region, credentials });
    const tagging = new ResourceGroupsTaggingAPIClient({ region, credentials });
    const apigw = new APIGatewayClient({ region, credentials });

    try {
      const result = await computeHealthFromMetrics(cw, tagging, apigw);
      res.json(result);
    } catch (err) {
      console.warn('[dashboard] health-trend failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({
        type: 'about:blank',
        title: 'Health trend failed',
        status: 500,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
