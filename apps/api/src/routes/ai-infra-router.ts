/**
 * AI Infrastructure routes
 *
 * POST /api/v1/ai/campaign-impact  — Analyze ECS + Lambda readiness for a campaign
 * POST /api/v1/ai/infra-simulate   — Simulate the impact of an infrastructure change
 */
import { Router, type Request, type Response } from 'express';
import { problemDetails } from '@wep/domain-types';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  ECSClient,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  LambdaClient,
  GetFunctionCommand,
  CloudWatchClient,
  GetMetricDataCommand,
  RDSClient,
  DescribeDBInstancesCommand,
  ApplicationAutoScalingClient,
  DescribeScalableTargetsCommand,
  DescribeScalingPoliciesCommand,
  ElasticLoadBalancingV2Client,
  DescribeTargetGroupsCommand,
  credentialStore,
  regionStore,
} from '@wep/aws-clients';

const MODEL_ID = process.env['BEDROCK_MODEL_ID'] ?? 'eu.amazon.nova-micro-v1:0';

const regionProvider = regionStore.getProvider();
const credentialProvider = credentialStore.getProvider();

const bedrockClient = new BedrockRuntimeClient({ region: regionProvider, credentials: credentialProvider });
const ecsClient = new ECSClient({ region: regionProvider, credentials: credentialProvider });
const lambdaClient = new LambdaClient({ region: regionProvider, credentials: credentialProvider });
const cwClient = new CloudWatchClient({ region: regionProvider, credentials: credentialProvider });
const rdsClient = new RDSClient({ region: regionProvider, credentials: credentialProvider });
const aasClient = new ApplicationAutoScalingClient({ region: regionProvider, credentials: credentialProvider });
const elbClient = new ElasticLoadBalancingV2Client({ region: regionProvider, credentials: credentialProvider });

// ---------------------------------------------------------------------------
// Bedrock helper
// ---------------------------------------------------------------------------

async function invoke(prompt: string, maxTokens = 2000): Promise<string> {
  const body = JSON.stringify({
    messages: [{ role: 'user', content: [{ text: prompt }] }],
    inferenceConfig: { maxTokens, temperature: 0.3 },
  });
  const cmd = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: new TextEncoder().encode(body),
  });
  const res = await bedrockClient.send(cmd);
  const decoded = new TextDecoder().decode(res.body);
  const parsed = JSON.parse(decoded) as { output?: { message?: { content?: Array<{ text?: string }> } } };
  return parsed.output?.message?.content?.[0]?.text ?? '';
}

// ---------------------------------------------------------------------------
// CloudWatch helper — fetch metric stats for a 24h window
// ---------------------------------------------------------------------------

interface MetricStats {
  avg: number | null;
  max: number | null;
  sum: number | null;
}

async function fetchMetric(
  namespace: string,
  metricName: string,
  dimensions: Array<{ Name: string; Value: string }>,
  stat: 'Average' | 'Maximum' | 'Sum',
  lookbackHours = 24,
  periodSeconds = 300,
): Promise<number | null> {
  const now = new Date();
  const start = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);
  try {
    const resp = await cwClient.send(
      new GetMetricDataCommand({
        StartTime: start,
        EndTime: now,
        MetricDataQueries: [
          {
            Id: 'm1',
            MetricStat: {
              Metric: { Namespace: namespace, MetricName: metricName, Dimensions: dimensions },
              Period: periodSeconds,
              Stat: stat,
            },
          },
        ],
      }),
    );
    const values = resp.MetricDataResults?.[0]?.Values ?? [];
    if (values.length === 0) return null;
    if (stat === 'Maximum') return Math.max(...values);
    if (stat === 'Sum') return values.reduce((a, b) => a + b, 0);
    return values.reduce((a, b) => a + b, 0) / values.length;
  } catch {
    return null;
  }
}

/**
 * Detect load balancer type from service name.
 * Services ending with 'backend' are on NLB — no ALB request metrics available.
 * Everything else is treated as potentially ALB-fronted.
 */
function detectLbType(serviceName: string): 'alb' | 'nlb' {
  return serviceName.toLowerCase().endsWith('backend') ? 'nlb' : 'alb';
}

interface TrafficHistory {
  loadBalancerType: 'alb' | 'nlb';

  // ── Request volume ────────────────────────────────────────────────────────
  /** req/s per task at the 3-day peak (primary signal) */
  peakReqPerSecPerTask: number | null;
  /** How peakReqPerSecPerTask was derived */
  peakReqSource: 'RequestCountPerTarget' | 'totalReq/peakTasks' | 'networkBytes/estimate' | null;
  /** Raw RequestCountPerTarget max over 3d (requests per 1-min period per target) */
  requestsPerTargetMax3d: number | null;
  /** Raw RequestCountPerTarget avg over 3d */
  requestsPerTargetAvg3d: number | null;
  /** Total ALB requests in the single busiest 1-min window across 3d */
  totalRequestsPeakPerMin: number | null;

  // ── Task count ────────────────────────────────────────────────────────────
  /** Peak running task count from Container Insights over 3d */
  peakObservedTaskCount: number | null;
  /** How many tasks were healthy/registered in ALB at peak (HealthyHostCount max) */
  peakHealthyHostCount: number | null;

  // ── Latency & errors ──────────────────────────────────────────────────────
  /** ALB target response time avg over 3d (ms) */
  avgResponseTimeMs: number | null;
  /** ALB target response time max over 3d (ms) */
  maxResponseTimeMs: number | null;
  /** Total 5xx errors from targets over 3d */
  total5xxErrors: number | null;

  // ── Network (Container Insights fallback) ─────────────────────────────────
  /** Peak network bytes received per task per minute (3d max) — traffic proxy when ALB unavailable */
  peakNetworkRxBytesPerTaskPerMin: number | null;

  // ── Metadata ──────────────────────────────────────────────────────────────
  targetGroupArn: string | null;
  matchedTargetGroupName: string | null;
  dataQuality: 'full' | 'partial' | 'none';
  notes: string[];
}

async function collectTrafficHistory(
  serviceName: string,
  cluster: string,
): Promise<TrafficHistory> {
  const lbType = detectLbType(serviceName);
  const notes: string[] = [];

  // ── Container Insights metrics (cluster + service dimensions) ──────────────
  // These are always attempted regardless of LB type.
  const ciServiceDims = [
    { Name: 'ClusterName', Value: cluster },
    { Name: 'ServiceName', Value: serviceName },
  ];
  const ciTaskDims = [
    { Name: 'ClusterName', Value: cluster },
    { Name: 'ServiceName', Value: serviceName },
  ];

  const [peakObservedTaskCount, peakNetworkRxRaw] = await Promise.all([
    fetchMetric('ECS/ContainerInsights', 'RunningTaskCount', ciServiceDims, 'Maximum', 72, 60),
    fetchMetric('ECS/ContainerInsights', 'NetworkRxBytes',  ciTaskDims,    'Maximum', 72, 60),
  ]);

  // Normalise NetworkRxBytes to per-task (divide by peak task count if > 1)
  const peakNetworkRxBytesPerTaskPerMin =
    peakNetworkRxRaw != null
      ? Math.round(peakNetworkRxRaw / Math.max(peakObservedTaskCount ?? 1, 1))
      : null;

  if (peakObservedTaskCount == null) notes.push('Container Insights RunningTaskCount unavailable — ensure Container Insights is enabled on the cluster.');

  // ── NLB: no ALB request metrics, return what we have ─────────────────────
  if (lbType === 'nlb') {
    return {
      loadBalancerType: 'nlb',
      peakReqPerSecPerTask: null,
      peakReqSource: null,
      requestsPerTargetMax3d: null,
      requestsPerTargetAvg3d: null,
      totalRequestsPeakPerMin: null,
      peakObservedTaskCount,
      peakHealthyHostCount: null,
      avgResponseTimeMs: null,
      maxResponseTimeMs: null,
      total5xxErrors: null,
      peakNetworkRxBytesPerTaskPerMin,
      targetGroupArn: null,
      matchedTargetGroupName: null,
      dataQuality: peakObservedTaskCount != null || peakNetworkRxBytesPerTaskPerMin != null ? 'partial' : 'none',
      notes: ['NLB — per-request ALB metrics unavailable. Traffic estimated at ~70% of combined ALB API services.', ...notes],
    };
  }

  // ── ALB: find matching target group ───────────────────────────────────────
  interface TgCandidate { arn: string; name: string; lbArn: string | null; score: number; }
  let bestTg: TgCandidate | null = null;
  try {
    // Paginate through all TGs — default page size is 100, large accounts may have more
    const allTgs: Array<{ TargetGroupArn?: string; TargetGroupName?: string; LoadBalancerArns?: string[] }> = [];
    let marker: string | undefined;
    do {
      const tgsResp = await elbClient.send(new DescribeTargetGroupsCommand({ Marker: marker }));
      allTgs.push(...(tgsResp.TargetGroups ?? []));
      marker = tgsResp.NextMarker;
    } while (marker);

    const svcLower = serviceName.toLowerCase();

    const candidates: TgCandidate[] = allTgs
      .filter((tg) => tg.TargetGroupArn && tg.TargetGroupName)
      .map((tg) => {
        const tgName = (tg.TargetGroupName ?? '').toLowerCase();
        // Exact match scores highest, then substring, then token overlap
        const exactMatch = tgName === svcLower;
        const substringMatch = !exactMatch && (tgName.includes(svcLower) || svcLower.includes(tgName));
        const tokenScore = svcLower.split(/[-_]/).filter((t) => t.length > 2 && tgName.split(/[-_]/).includes(t)).length;
        return {
          arn: tg.TargetGroupArn!,
          name: tg.TargetGroupName!,
          lbArn: tg.LoadBalancerArns?.[0] ?? null,
          score: exactMatch ? 10000 : substringMatch ? 999 : tokenScore,
        };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score);

    bestTg = candidates[0] ?? null;
  } catch (e) {
    notes.push(`DescribeTargetGroups failed: ${(e as Error).message}`);
  }

  if (!bestTg) {
    notes.push(`No ALB target group matched for "${serviceName}" — ALB request/latency/error metrics unavailable.`);
    return {
      loadBalancerType: 'alb',
      peakReqPerSecPerTask: null,
      peakReqSource: null,
      requestsPerTargetMax3d: null,
      requestsPerTargetAvg3d: null,
      totalRequestsPeakPerMin: null,
      peakObservedTaskCount,
      peakHealthyHostCount: null,
      avgResponseTimeMs: null,
      maxResponseTimeMs: null,
      total5xxErrors: null,
      peakNetworkRxBytesPerTaskPerMin,
      targetGroupArn: null,
      matchedTargetGroupName: null,
      dataQuality: peakObservedTaskCount != null ? 'partial' : 'none',
      notes,
    };
  }

  notes.push(`Matched TG: "${bestTg.name}"`);

  // ── ALB CloudWatch metrics ─────────────────────────────────────────────────
  const tgDimValue = bestTg.arn.split(':').pop() ?? bestTg.arn;
  const lbDimValue = bestTg.lbArn ? (bestTg.lbArn.split(':').pop() ?? null) : null;
  const dims = [
    { Name: 'TargetGroup', Value: tgDimValue },
    ...(lbDimValue ? [{ Name: 'LoadBalancer', Value: lbDimValue }] : []),
  ];

  const [
    reqPerTargetMax,
    reqPerTargetAvg,
    totalReqPeakMin,
    healthyHostMax,
    responseTimeAvg,
    responseTimeMax,
    errors5xx,
  ] = await Promise.all([
    fetchMetric('AWS/ApplicationELB', 'RequestCountPerTarget', dims, 'Maximum', 72, 60),
    fetchMetric('AWS/ApplicationELB', 'RequestCountPerTarget', dims, 'Average', 72, 60),
    fetchMetric('AWS/ApplicationELB', 'RequestCount',          dims, 'Sum',     72, 60),
    fetchMetric('AWS/ApplicationELB', 'HealthyHostCount',      dims, 'Maximum', 72, 60),
    fetchMetric('AWS/ApplicationELB', 'TargetResponseTime',    dims, 'Average', 72, 60),
    fetchMetric('AWS/ApplicationELB', 'TargetResponseTime',    dims, 'Maximum', 72, 60),
    fetchMetric('AWS/ApplicationELB', 'HTTPCode_Target_5XX_Count', dims, 'Sum', 72, 60),
  ]);

  // ── Derive peakReqPerSecPerTask with fallback chain ────────────────────────
  let peakReqPerSecPerTask: number | null = null;
  let peakReqSource: TrafficHistory['peakReqSource'] = null;

  if (reqPerTargetMax != null) {
    // Primary: RequestCountPerTarget is requests per 1-min period per registered target
    peakReqPerSecPerTask = Math.round((reqPerTargetMax / 60) * 10) / 10;
    peakReqSource = 'RequestCountPerTarget';
  } else if (totalReqPeakMin != null) {
    // Fallback 1: total requests ÷ healthy host count at peak ÷ 60
    const divisor = healthyHostMax ?? peakObservedTaskCount;
    if (divisor != null && divisor > 0) {
      peakReqPerSecPerTask = Math.round((totalReqPeakMin / divisor / 60) * 10) / 10;
      peakReqSource = 'totalReq/peakTasks';
      notes.push(`RequestCountPerTarget unavailable — derived from total RequestCount ÷ ${healthyHostMax != null ? 'HealthyHostCount' : 'RunningTaskCount'} (${divisor} tasks).`);
    }
  } else if (peakNetworkRxBytesPerTaskPerMin != null) {
    // Fallback 2: rough estimate — assume avg 2 KB per request
    peakReqPerSecPerTask = Math.round((peakNetworkRxBytesPerTaskPerMin / 2048 / 60) * 10) / 10;
    peakReqSource = 'networkBytes/estimate';
    notes.push('Both ALB request metrics unavailable — req/s estimated from NetworkRxBytes (assumes ~2 KB/req). Treat as rough order-of-magnitude only.');
  } else {
    notes.push('No request metric data available from any source. Service may be idle or Container Insights / ALB metrics not configured.');
  }

  const dataQuality =
    peakReqSource === 'RequestCountPerTarget' ? 'full' :
    peakReqSource != null ? 'partial' :
    'none';

  return {
    loadBalancerType: 'alb',
    peakReqPerSecPerTask,
    peakReqSource,
    requestsPerTargetMax3d: reqPerTargetMax != null ? Math.round(reqPerTargetMax * 10) / 10 : null,
    requestsPerTargetAvg3d: reqPerTargetAvg != null ? Math.round(reqPerTargetAvg * 10) / 10 : null,
    totalRequestsPeakPerMin: totalReqPeakMin != null ? Math.round(totalReqPeakMin) : null,
    peakObservedTaskCount,
    peakHealthyHostCount: healthyHostMax != null ? Math.round(healthyHostMax) : null,
    avgResponseTimeMs: responseTimeAvg != null ? Math.round(responseTimeAvg * 1000) : null,
    maxResponseTimeMs: responseTimeMax != null ? Math.round(responseTimeMax * 1000) : null,
    total5xxErrors: errors5xx != null ? Math.round(errors5xx) : null,
    peakNetworkRxBytesPerTaskPerMin,
    targetGroupArn: bestTg.arn,
    matchedTargetGroupName: bestTg.name,
    dataQuality,
    notes,
  };
}

async function fetchMetricStats(
  namespace: string,
  metricName: string,
  dimensions: Array<{ Name: string; Value: string }>,
): Promise<MetricStats> {
  const [avg, max] = await Promise.all([
    fetchMetric(namespace, metricName, dimensions, 'Average'),
    fetchMetric(namespace, metricName, dimensions, 'Maximum'),
  ]);
  return { avg, max, sum: null };
}

// ---------------------------------------------------------------------------
// ECS data collector
// ---------------------------------------------------------------------------

interface EcsServiceData {
  type: 'ecs-service';
  name: string;
  cluster: string;
  desiredCount: number | null;
  runningCount: number | null;
  taskDefinitionArn: string | null;
  taskCpu: string | null;       // raw string e.g. "256", "1024"
  taskMemory: string | null;    // raw string in MB e.g. "512", "2048"
  containerEnvVars: Array<{ name: string; value: string }>;
  metrics: {
    cpuAvg: number | null;
    cpuMax: number | null;
    memAvg: number | null;
    memMax: number | null;
  };
  autoScaling: {
    minCapacity: number | null;
    maxCapacity: number | null;
    targetTrackingValue: number | null;   // CPU % target
    scaleOutCooldown: number | null;      // seconds
    scaleInCooldown: number | null;       // seconds
  };
  trafficHistory: TrafficHistory | null;
  linkedRds: RdsInstanceData[];
}

interface RdsInstanceData {
  identifier: string;
  instanceClass: string | null;
  engine: string | null;
  multiAz: boolean | null;
  endpoint: string | null;
  metrics: {
    cpuAvg: number | null;
    cpuMax: number | null;
    connectionsAvg: number | null;
    connectionsMax: number | null;
  };
}

async function collectEcsData(name: string, cluster: string): Promise<EcsServiceData> {
  const result: EcsServiceData = {
    type: 'ecs-service',
    name,
    cluster,
    desiredCount: null,
    runningCount: null,
    taskDefinitionArn: null,
    taskCpu: null,
    taskMemory: null,
    containerEnvVars: [],
    metrics: { cpuAvg: null, cpuMax: null, memAvg: null, memMax: null },
    autoScaling: { minCapacity: null, maxCapacity: null, targetTrackingValue: null, scaleOutCooldown: null, scaleInCooldown: null },
    trafficHistory: null,
    linkedRds: [],
  };

  // 1. DescribeServices
  try {
    const svcResp = await ecsClient.send(
      new DescribeServicesCommand({ cluster, services: [name] }),
    );
    const svc = svcResp.services?.[0];
    if (svc) {
      result.desiredCount = svc.desiredCount ?? null;
      result.runningCount = svc.runningCount ?? null;
      result.taskDefinitionArn = svc.taskDefinition ?? null;
    }
  } catch { /* non-fatal */ }

  // 2. DescribeTaskDefinition
  if (result.taskDefinitionArn) {
    try {
      const tdResp = await ecsClient.send(
        new DescribeTaskDefinitionCommand({ taskDefinition: result.taskDefinitionArn }),
      );
      const td = tdResp.taskDefinition;
      if (td) {
        result.taskCpu = td.cpu ?? null;
        result.taskMemory = td.memory ?? null;
        const envVars = td.containerDefinitions?.[0]?.environment ?? [];
        result.containerEnvVars = envVars
          .filter((e): e is { name: string; value: string } => typeof e.name === 'string' && typeof e.value === 'string');
      }
    } catch { /* non-fatal */ }
  }

  // 3. CloudWatch metrics
  const ecsDims = [
    { Name: 'ClusterName', Value: cluster },
    { Name: 'ServiceName', Value: name },
  ];
  const [cpuStats, memStats] = await Promise.all([
    fetchMetricStats('AWS/ECS', 'CPUUtilization', ecsDims),
    fetchMetricStats('AWS/ECS', 'MemoryUtilization', ecsDims),
  ]);
  result.metrics = {
    cpuAvg: cpuStats.avg,
    cpuMax: cpuStats.max,
    memAvg: memStats.avg,
    memMax: memStats.max,
  };

  // 4. Application Auto Scaling
  const resourceId = `service/${cluster}/${name}`;
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
      result.autoScaling.minCapacity = target.MinCapacity ?? null;
      result.autoScaling.maxCapacity = target.MaxCapacity ?? null;
    }
    for (const policy of policiesResp.ScalingPolicies ?? []) {
      const ttc = policy.TargetTrackingScalingPolicyConfiguration;
      if (ttc?.TargetValue != null) {
        result.autoScaling.targetTrackingValue = ttc.TargetValue;
        result.autoScaling.scaleOutCooldown = ttc.ScaleOutCooldown ?? null;
        result.autoScaling.scaleInCooldown = ttc.ScaleInCooldown ?? null;
        break;
      }
    }
  } catch { /* non-fatal */ }

  // 5. Traffic history (ALB or NLB)
  result.trafficHistory = await collectTrafficHistory(name, cluster);

  // 6. RDS auto-detection via env vars
  const rdsHosts = result.containerEnvVars
    .filter((e) => e.value.includes('.rds.amazonaws.com'))
    .map((e) => e.value.split('.')[0] ?? '')
    .filter((id) => id.length > 0);
  const uniqueIds = [...new Set(rdsHosts)];

  if (uniqueIds.length > 0) {
    const rdsResults = await Promise.all(uniqueIds.map((id) => collectRdsData(id)));
    result.linkedRds = rdsResults;
  }

  return result;
}

async function collectRdsData(identifier: string): Promise<RdsInstanceData> {
  const result: RdsInstanceData = {
    identifier,
    instanceClass: null,
    engine: null,
    multiAz: null,
    endpoint: null,
    metrics: { cpuAvg: null, cpuMax: null, connectionsAvg: null, connectionsMax: null },
  };
  try {
    const resp = await rdsClient.send(
      new DescribeDBInstancesCommand({ DBInstanceIdentifier: identifier }),
    );
    const db = resp.DBInstances?.[0];
    if (db) {
      result.instanceClass = db.DBInstanceClass ?? null;
      result.engine = db.Engine ?? null;
      result.multiAz = db.MultiAZ ?? null;
      result.endpoint = db.Endpoint?.Address ?? null;
    }
  } catch { /* non-fatal */ }

  const rdsDims = [{ Name: 'DBInstanceIdentifier', Value: identifier }];
  const [cpuStats, connStats] = await Promise.all([
    fetchMetricStats('AWS/RDS', 'CPUUtilization', rdsDims),
    fetchMetricStats('AWS/RDS', 'DatabaseConnections', rdsDims),
  ]);
  result.metrics = {
    cpuAvg: cpuStats.avg,
    cpuMax: cpuStats.max,
    connectionsAvg: connStats.avg,
    connectionsMax: connStats.max,
  };

  return result;
}

// ---------------------------------------------------------------------------
// Lambda data collector
// ---------------------------------------------------------------------------

interface LambdaFunctionData {
  type: 'lambda';
  name: string;
  memorySize: number | null;
  timeout: number | null;
  reservedConcurrency: number | null;
  metrics: {
    durationAvg: number | null;
    throttlesSum: number | null;
    concurrentExecutionsMax: number | null;
    invocationsSum: number | null;
  };
}

async function collectLambdaData(name: string): Promise<LambdaFunctionData> {
  const result: LambdaFunctionData = {
    type: 'lambda',
    name,
    memorySize: null,
    timeout: null,
    reservedConcurrency: null,
    metrics: { durationAvg: null, throttlesSum: null, concurrentExecutionsMax: null, invocationsSum: null },
  };

  try {
    const resp = await lambdaClient.send(new GetFunctionCommand({ FunctionName: name }));
    result.memorySize = resp.Configuration?.MemorySize ?? null;
    result.timeout = resp.Configuration?.Timeout ?? null;
    result.reservedConcurrency = resp.Concurrency?.ReservedConcurrentExecutions ?? null;
  } catch { /* non-fatal */ }

  const lambdaDims = [{ Name: 'FunctionName', Value: name }];
  const [durationAvg, throttlesSum, concMax, invocSum] = await Promise.all([
    fetchMetric('AWS/Lambda', 'Duration', lambdaDims, 'Average'),
    fetchMetric('AWS/Lambda', 'Throttles', lambdaDims, 'Sum'),
    fetchMetric('AWS/Lambda', 'ConcurrentExecutions', lambdaDims, 'Maximum'),
    fetchMetric('AWS/Lambda', 'Invocations', lambdaDims, 'Sum'),
  ]);
  result.metrics = {
    durationAvg,
    throttlesSum,
    concurrentExecutionsMax: concMax,
    invocationsSum: invocSum,
  };

  return result;
}

// ---------------------------------------------------------------------------
// CPU / Memory helpers
// ---------------------------------------------------------------------------

function cpuToVcpu(cpu: string | null): string {
  if (!cpu) return 'unknown';
  const n = parseInt(cpu, 10);
  if (isNaN(n)) return cpu;
  return n >= 1024 ? `${n / 1024} vCPU` : `${(n / 1024).toFixed(2).replace(/\.?0+$/, '')} vCPU`;
}

function memoryToGb(memMb: string | null): string {
  if (!memMb) return 'unknown';
  const n = parseInt(memMb, 10);
  if (isNaN(n)) return memMb;
  return n >= 1024 ? `${(n / 1024).toFixed(1).replace(/\.0$/, '')} GB` : `${n} MB`;
}

// ---------------------------------------------------------------------------
// Dependency graph builder — parses env vars to find service-to-service calls
// ---------------------------------------------------------------------------

/**
 * Identifies which of the selected services this service calls, based on env vars
 * like SRV_ORDER_URL, SRV_CUSTOMER_BACKEND_URL, SRV_ORDER_BACKEND, etc.
 */
function detectServiceDependencies(
  envVars: Array<{ name: string; value: string }>,
  allServiceNames: string[],
): string[] {
  const deps = new Set<string>();

  for (const { name: key, value } of envVars) {
    const upperKey = key.toUpperCase();

    // Only consider keys that look like inter-service pointers
    if (!upperKey.startsWith('SRV_') && !upperKey.includes('_URL') && !upperKey.includes('_BACKEND') && !upperKey.includes('_SERVICE') && !upperKey.includes('_HOST')) continue;
    // Skip non-HTTP values and obvious non-service vars
    if (!value.startsWith('http') && !value.includes('.') ) continue;

    // Derive a normalised slug from the key:
    // SRV_ORDER_BACKEND_URL → order-backend
    // SRV_CUSTOMER_BACKEND  → customer-backend
    const slug = upperKey
      .replace(/^SRV_/, '')
      .replace(/_URL$/, '')
      .replace(/_HOST$/, '')
      .replace(/_SERVICE$/, '')
      .toLowerCase()
      .replace(/_/g, '-');

    // Match slug against every selected service name
    for (const svcName of allServiceNames) {
      const svcLower = svcName.toLowerCase();
      // Remove common environment prefixes like "prod-", "staging-" for matching
      const svcCore = svcLower.replace(/^(prod|staging|dev|uat)-/, '').replace(/^srv-/, '');
      if (svcCore.includes(slug) || slug.includes(svcCore) || svcLower.includes(slug)) {
        if (svcName !== '') deps.add(svcName);
      }
    }
  }

  return [...deps];
}

// ---------------------------------------------------------------------------
// Error helper
// ---------------------------------------------------------------------------

function err(res: Response, msg: string): void {
  res.status(500).json(problemDetails(500, 'AI Infrastructure error', msg));
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function createAiInfraRouter(): Router {
  const router = Router();

  // POST /ai/campaign-impact
  router.post('/campaign-impact', async (req: Request, res: Response) => {
    const { totalUsers, resources, channels, context } = req.body as {
      totalUsers?: number;
      resources?: Array<{ type: 'ecs-service' | 'lambda'; name: string; cluster?: string }>;
      channels?: string[];
      context?: string;
    };

    if (!totalUsers || !Array.isArray(resources) || resources.length === 0) {
      res.status(400).json(problemDetails(400, 'Bad request', 'totalUsers and resources[] are required'));
      return;
    }

    try {
      const collectedData: Array<EcsServiceData | LambdaFunctionData> = await Promise.all(
        resources.map((r) =>
          r.type === 'ecs-service' ? collectEcsData(r.name, r.cluster ?? 'default') : collectLambdaData(r.name),
        ),
      );

      const channelList = channels?.length ? channels.join(', ') : 'unspecified channels';
      const channelCount = channels?.length ?? 0;

      const ecsServices = collectedData.filter((d): d is EcsServiceData => d.type === 'ecs-service');
      const lambdas = collectedData.filter((d): d is LambdaFunctionData => d.type === 'lambda');
      const allServiceNames = ecsServices.map((s) => s.name);

      // ── Build call graph from env vars ──────────────────────────────────────
      const callGraph: Record<string, string[]> = {};
      for (const svc of ecsServices) {
        const deps = detectServiceDependencies(svc.containerEnvVars, allServiceNames)
          .filter((dep) => dep !== svc.name);
        if (deps.length > 0) callGraph[svc.name] = deps;
      }

      // ── Build clean structured AI payload ───────────────────────────────────
      const ecsPayload = ecsServices.map((svc) => ({
        name: svc.name,
        allocatedCpu: cpuToVcpu(svc.taskCpu),
        allocatedMemory: memoryToGb(svc.taskMemory),
        currentRunning: svc.runningCount,
        capacity: {
          min: svc.autoScaling.minCapacity,
          max: svc.autoScaling.maxCapacity,
        },
        autoScaling: {
          scalesOutWhenCpuExceeds: svc.autoScaling.targetTrackingValue != null
            ? `${svc.autoScaling.targetTrackingValue}% average CPU`
            : 'not configured',
          scaleOutCooldown: svc.autoScaling.scaleOutCooldown != null
            ? `${svc.autoScaling.scaleOutCooldown}s`
            : 'unknown',
          scaleInCooldown: svc.autoScaling.scaleInCooldown != null
            ? `${svc.autoScaling.scaleInCooldown}s`
            : 'unknown',
        },
        metrics24h: {
          cpuAvgPct: svc.metrics.cpuAvg != null ? `${svc.metrics.cpuAvg.toFixed(1)}%` : 'no data',
          cpuMaxPct: svc.metrics.cpuMax != null ? `${svc.metrics.cpuMax.toFixed(1)}%` : 'no data',
          memAvgPct: svc.metrics.memAvg != null ? `${svc.metrics.memAvg.toFixed(1)}%` : 'no data',
          memMaxPct: svc.metrics.memMax != null ? `${svc.metrics.memMax.toFixed(1)}%` : 'no data',
        },
        callsTo: callGraph[svc.name] ?? [],
      }));

      const lambdaPayload = lambdas.map((fn) => ({
        name: fn.name,
        memoryMb: fn.memorySize,
        timeoutSec: fn.timeout,
        reservedConcurrency: fn.reservedConcurrency ?? 'unreserved (account limit)',
        metrics24h: {
          invocationsTotal: fn.metrics.invocationsSum,
          maxConcurrentExecutions: fn.metrics.concurrentExecutionsMax,
          avgDurationMs: fn.metrics.durationAvg != null ? `${Math.round(fn.metrics.durationAvg)} ms` : 'no data',
          throttlesTotal: fn.metrics.throttlesSum,
        },
      }));

      const prompt = `You are a senior AWS solutions architect and SRE. Analyse campaign readiness for the services below.

## System Facts (treat as ground truth)
- **Load balancer**: Least-outstanding-requests routing — new connections go to the task with the lowest active load. This distributes traffic more evenly than round-robin under variable request durations.
- **Mobile app timeout**: 30 seconds. Any request that doesn't complete within 30s is abandoned by the client. This is your hard latency SLA.
- **ECS startup**: ~5 minutes from scale-out trigger to a new task receiving live traffic. Two health check layers must both pass (ECS container check → ALB target group check). During this window existing tasks absorb all load.
- **Auto scaling lag**: alarm evaluation period + scale-out cooldown + ~5 min startup = typically 8–12 minutes before new capacity is useful.
- **Node.js / SailsJS**: single-threaded event loop. One slow or CPU-bound request delays all others on that task. Memory pressure causes GC pauses before OOM.
- **Lambda cold starts**: 200–800 ms added latency on first invocation after idle. Concurrent cold starts cascade under sudden load.

## Known System Topology & Baseline (provided by the team)
${context?.trim() || 'No additional context provided.'}

## Service Call Graph (derived from environment variables)
${Object.keys(callGraph).length > 0
  ? Object.entries(callGraph).map(([svc, deps]) => `- ${svc} → calls → ${deps.join(', ')}`).join('\n')
  : 'No inter-service call dependencies detected among selected services.'}

Note: downstream services in the call graph receive AT LEAST the same request rate as their callers. If a caller is under load, all its downstream dependencies are too.

## ECS Services
${JSON.stringify(ecsPayload, null, 2)}

${lambdaPayload.length > 0 ? `## Lambda Functions\n${JSON.stringify(lambdaPayload, null, 2)}` : ''}

## Campaign
- Target audience: ${totalUsers.toLocaleString()} users
- Delivery channel${channelCount > 1 ? 's' : ''}: ${channelList}
${channelCount === 1 ? `- Analyse this single channel only. Do not speculate about other channels.` : `- Analyse each channel independently, then the combined impact if all fire simultaneously.`}

---

Produce the report in this exact structure. Use markdown tables for every section that contains per-service data.

## Executive Summary
3–4 sentences covering: overall readiness verdict, the single biggest risk, and whether to proceed or make changes first.

---

## Service Readiness

| Service | CPU Allocated | Memory | Current Running | Min | Max | Scale-out Trigger | CPU Avg | CPU Max | Mem Avg | Headroom | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|

- Headroom = 100% − CPU Max. This is the available buffer before auto-scaling fires.
- Status: ✅ READY / ⚠️ NEEDS ATTENTION / 🔴 AT RISK

---

These three scenarios are ordered from least to most severe. Risk must increase (or stay equal) from Scenario 1 → 2 → 3. If a service survives Scenario 3, it survives all scenarios. Never mark a scenario as lower risk than a less severe one.

## Scenario 1 — Normal response (traffic grows gradually over 30–60 min, ~1.5–2× baseline)
This is the easiest scenario. Auto-scaling has time to react. Existing tasks carry the early load while new tasks spin up.

| Service | Current CPU Max | Headroom | Auto-scaling Fires At | New Tasks Ready At | Verdict |
|---|---|---|---|---|---|

- "Headroom" = 100% − CPU Max (from 24h data).
- "Auto-scaling Fires At" = the configured CPU target threshold.
- "New Tasks Ready At" = scale-out cooldown + 5 min startup.
- Verdict: ✅ HANDLES IT / ⚠️ TIGHT / 🔴 AT RISK

2–3 sentences of narrative.

## Scenario 2 — Moderate burst (~3× baseline, majority of responses arrive within 10–15 min)
Auto-scaling will fire but new tasks won't be ready for 8–12 min. Existing tasks must absorb 3× load alone during that window.

| Service | Allocated CPU | Current CPU Max | Load at 3× baseline (est.) | Survives 8–12 min blind spot? | Risk |
|---|---|---|---|---|---|

- Estimate load at 3× by scaling current CPU Max proportionally: if CPU is 25% at baseline, 3× load ≈ 75% CPU.
- If estimated CPU exceeds 100%, requests queue → timeouts at 30s → 🔴 AT RISK.
- Risk: ✅ LOW / ⚠️ MODERATE / 🔴 HIGH

2–3 sentences of narrative.

## Scenario 3 — Large burst (~5× baseline, most responses arrive within 2–3 min — entirely within the scaling blind spot)
This is the worst case. Auto-scaling cannot help — new tasks won't be ready before the surge has passed. Existing tasks are the only defence.

| Service | Allocated CPU | Current CPU Max | Load at 5× baseline (est.) | Survives blind spot? | Failure Mode if Not |
|---|---|---|---|---|---|

- Estimate: CPU Max × 5. If this exceeds 100%, the task is saturated.
- A saturated Node.js/SailsJS task queues all requests behind a blocked event loop. Requests older than 30s are dropped by the mobile client.
- Failure mode examples: "requests queue and time out after 30s", "OOM kill", "event loop blocked".
- Risk must be equal to or higher than Scenario 2 for every service.

2–3 sentences of narrative.

---

## Downstream Impact Analysis
For each call graph dependency, explain: if the caller is stressed, what happens to the downstream service? Show the propagation chain.

| Caller | Downstream | Risk if Caller is at Capacity | Mitigating Factor |
|---|---|---|---|

---

## Minimum Instance Recommendations

| Service | Allocated CPU | Current CPU Max | Current Running | Current Min | Recommended Min | Reason |
|---|---|---|---|---|---|---|

- Base recommendations on CPU headroom and the auto-scaling lag (8–12 min blind spot), not on audience size.
- Recommended Min must never exceed configured Max.
- Reason must be one sentence referencing the actual CPU data.

## Scaling Configuration Recommendations

| Service | Current Scale-out Trigger | Recommended Trigger | Current Scale-out Cooldown | Recommended Cooldown | Priority |
|---|---|---|---|---|---|

- Priority: 🔴 Critical / 🟡 Important / 🟢 Optional
- Lower scale-out cooldown = faster reaction. Lower trigger threshold = scales earlier before saturation.

## Go / No-Go Verdict
**GO**, **GO WITH CHANGES**, or **NO-GO**.
If GO WITH CHANGES: list each required change as a table row with: Change | Service | Why it matters.

Use markdown. Every recommendation must reference actual numbers from the data above.`;

      const report = await invoke(prompt, 4000);
      res.json({ report, data: collectedData });
    } catch (e) {
      err(res, e instanceof Error ? e.message : 'Failed');
    }
  });

  // POST /ai/infra-simulate
  router.post('/infra-simulate', async (req: Request, res: Response) => {
    const { resourceType, resourceName, cluster, change } = req.body as {
      resourceType?: 'ecs-service' | 'lambda';
      resourceName?: string;
      cluster?: string;
      change?: string;
    };

    if (!resourceType || !resourceName || !change) {
      res.status(400).json(problemDetails(400, 'Bad request', 'resourceType, resourceName, and change are required'));
      return;
    }

    try {
      const currentState =
        resourceType === 'ecs-service'
          ? await collectEcsData(resourceName, cluster ?? 'default')
          : await collectLambdaData(resourceName);

      const prompt = `You are a senior AWS solutions architect. An engineer proposes this change:

Change: ${change}

Current state of ${resourceType} "${resourceName}":
${JSON.stringify(currentState, null, 2)}

## Summary
2–3 sentence overview of the change and its primary implication.

---

## Scenario 1 — Change succeeds as intended
Cost delta, performance improvement, reliability gain. IAM permissions needed. Implementation steps (numbered).

## Scenario 2 — Partial failure or unexpected behaviour
What could go wrong, which dependent services are affected, failure modes introduced. How to detect this.

## Scenario 3 — Rollback required
Step-by-step rollback plan. Data loss risk. Time to recover.

---

## General Recommendation
Whether to proceed, defer, or redesign the change. Specific conditions or prerequisites. Reference actual values from the current state.

Use markdown.`;

      const report = await invoke(prompt);
      res.json({ report });
    } catch (e) {
      err(res, e instanceof Error ? e.message : 'Failed');
    }
  });

  return router;
}
