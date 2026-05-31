import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  type ResultByTime,
} from '@aws-sdk/client-cost-explorer';
import type { AlertRule } from './notifier.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDynamoClient(): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: process.env['AWS_REGION'] ?? 'me-south-1' }),
  );
}

function getCostExplorerClient(): CostExplorerClient {
  // Cost Explorer is a global service — its API endpoint is always us-east-1.
  return new CostExplorerClient({ region: 'us-east-1' });
}

function getTableName(context: string): string {
  const env = process.env['WEP_ENVIRONMENT'] ?? 'development';
  return `wep-${context}-${env}`;
}

/** Returns an ISO string for `minutesAgo` minutes in the past. */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

/** Returns an ISO string for `hoursAgo` hours in the past. */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

/** Returns a YYYY-MM-DD string for a Date, used by Cost Explorer. */
function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface EvaluationResult {
  triggered: boolean;
  /** Human-readable description of what was found, used as the Slack body. */
  finding: string;
  /** Service IDs affected by this evaluation — used by subscription notifier. */
  affectedServiceIds?: string[];
}

// ---------------------------------------------------------------------------
// Condition evaluators
// ---------------------------------------------------------------------------

export async function evaluateDeployFailed(_rule: AlertRule): Promise<EvaluationResult> {
  const docClient = getDynamoClient();
  const cutoff = minutesAgo(5);

  const result = await docClient.send(
    new ScanCommand({
      TableName: getTableName('deployment-tracker'),
      FilterExpression: 'SK = :meta AND #status = :failed AND startedAt >= :cutoff',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':meta': 'METADATA',
        ':failed': 'failed',
        ':cutoff': cutoff,
      },
    }),
  );

  const items = (result.Items ?? []) as { serviceId?: string }[];
  const count = items.length;
  if (count === 0) {
    return { triggered: false, finding: '' };
  }

  const affectedServiceIds = [...new Set(items.map((i) => i.serviceId).filter((id): id is string => Boolean(id)))];

  return {
    triggered: true,
    finding: `${count} failed deployment${count === 1 ? '' : 's'} detected in the last 5 minutes`,
    affectedServiceIds,
  };
}

export async function evaluateP1Incident(_rule: AlertRule): Promise<EvaluationResult> {
  const docClient = getDynamoClient();
  const cutoff = minutesAgo(5);

  const result = await docClient.send(
    new ScanCommand({
      TableName: getTableName('on-call'),
      FilterExpression:
        'begins_with(PK, :prefix) AND severity = :p1 AND #status = :investigating AND startedAt >= :cutoff',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':prefix': 'INCIDENT#',
        ':p1': 'P1',
        ':investigating': 'investigating',
        ':cutoff': cutoff,
      },
    }),
  );

  const count = result.Count ?? 0;
  if (count === 0) {
    return { triggered: false, finding: '' };
  }

  return {
    triggered: true,
    finding: `${count} new P1 incident${count === 1 ? '' : 's'} opened in the last 5 minutes`,
  };
}

export async function evaluateCostSpike(rule: AlertRule): Promise<EvaluationResult> {
  const ceClient = getCostExplorerClient();
  const threshold = rule.threshold ?? 20;

  const now = new Date();
  // Current month: first day of this month → today
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  // Last month: first day → last day
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 1);

  const [thisMonthResult, lastMonthResult] = await Promise.all([
    ceClient.send(
      new GetCostAndUsageCommand({
        TimePeriod: {
          Start: toDateString(thisMonthStart),
          End: toDateString(now),
        },
        Granularity: 'MONTHLY',
        Metrics: ['UnblendedCost'],
      }),
    ),
    ceClient.send(
      new GetCostAndUsageCommand({
        TimePeriod: {
          Start: toDateString(lastMonthStart),
          End: toDateString(lastMonthEnd),
        },
        Granularity: 'MONTHLY',
        Metrics: ['UnblendedCost'],
      }),
    ),
  ]);

  const extractTotal = (results: ResultByTime[] | undefined): number => {
    if (!results || results.length === 0) return 0;
    const amount = results[0]?.Total?.['UnblendedCost']?.Amount;
    return amount ? parseFloat(amount) : 0;
  };

  const thisCost = extractTotal(thisMonthResult.ResultsByTime);
  const lastCost = extractTotal(lastMonthResult.ResultsByTime);

  if (lastCost === 0) {
    return { triggered: false, finding: '' };
  }

  // Pro-rate last month's cost to the same number of elapsed days this month.
  // new Date(year, month, 0) gives the last day of the previous month.
  const elapsedDays = now.getDate();
  const daysInLastMonth = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  const proratedLastCost = (lastCost / daysInLastMonth) * elapsedDays;

  if (proratedLastCost === 0) {
    return { triggered: false, finding: '' };
  }

  const increasePercent = ((thisCost - proratedLastCost) / proratedLastCost) * 100;

  if (increasePercent <= threshold) {
    return { triggered: false, finding: '' };
  }

  return {
    triggered: true,
    finding: `AWS spend is up ${increasePercent.toFixed(1)}% vs the same point last month ($${thisCost.toFixed(2)} this month vs $${proratedLastCost.toFixed(2)} prorated last month). Threshold: ${threshold}%`,
  };
}

export async function evaluateCriticalVuln(_rule: AlertRule): Promise<EvaluationResult> {
  const docClient = getDynamoClient();
  const cutoff = hoursAgo(1);

  const result = await docClient.send(
    new ScanCommand({
      TableName: getTableName('security'),
      FilterExpression: 'severity = :critical AND createdAt >= :cutoff',
      ExpressionAttributeValues: {
        ':critical': 'critical',
        ':cutoff': cutoff,
      },
    }),
  );

  const count = result.Count ?? 0;
  if (count === 0) {
    return { triggered: false, finding: '' };
  }

  return {
    triggered: true,
    finding: `${count} critical vulnerability finding${count === 1 ? '' : 's'} recorded in the last hour`,
  };
}

export async function evaluateConfigDrift(_rule: AlertRule): Promise<EvaluationResult> {
  const docClient = getDynamoClient();

  // Fetch all staging current-state items
  const stagingResult = await docClient.send(
    new ScanCommand({
      TableName: getTableName('deployment-tracker'),
      FilterExpression: 'begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':prefix': 'CURRENT_STATE#staging',
      },
      ProjectionExpression: 'PK, SK, serviceId, imageSha',
    }),
  );

  // Fetch all production current-state items

  const prodResult = await docClient.send(
    new ScanCommand({
      TableName: getTableName('deployment-tracker'),
      FilterExpression: 'begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':prefix': 'CURRENT_STATE#production',
      },
      ProjectionExpression: 'PK, SK, serviceId, imageSha',
    }),
  );

  type StateItem = { serviceId: string; imageSha: string };

  const stagingByServiceId = new Map<string, string>();
  for (const item of (stagingResult.Items ?? []) as StateItem[]) {
    if (item.serviceId && item.imageSha) {
      stagingByServiceId.set(item.serviceId, item.imageSha);
    }
  }

  const driftedServices: string[] = [];
  for (const item of (prodResult.Items ?? []) as StateItem[]) {
    if (!item.serviceId || !item.imageSha) continue;
    const stagingSha = stagingByServiceId.get(item.serviceId);
    if (stagingSha !== undefined && stagingSha !== item.imageSha) {
      driftedServices.push(item.serviceId);
    }
  }

  if (driftedServices.length === 0) {
    return { triggered: false, finding: '' };
  }

  return {
    triggered: true,
    finding: `${driftedServices.length} service${driftedServices.length === 1 ? '' : 's'} have different image SHAs in staging vs production: ${driftedServices.join(', ')}`,
    affectedServiceIds: driftedServices,
  };
}

export async function evaluateWeeklyDigest(_rule: AlertRule): Promise<EvaluationResult> {
  const docClient = getDynamoClient();
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [deploymentsResult, incidentsResult] = await Promise.all([
    docClient.send(
      new ScanCommand({
        TableName: getTableName('deployment-tracker'),
        FilterExpression: 'SK = :meta AND startedAt >= :cutoff',
        ExpressionAttributeValues: {
          ':meta': 'METADATA',
          ':cutoff': cutoff,
        },
        ProjectionExpression: 'serviceId, actor',
      }),
    ),
    docClient.send(
      new ScanCommand({
        TableName: getTableName('on-call'),
        FilterExpression: 'begins_with(PK, :prefix) AND #status = :resolved AND resolvedAt >= :cutoff',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':prefix': 'INCIDENT#',
          ':resolved': 'resolved',
          ':cutoff': cutoff,
        },
        ProjectionExpression: 'PK',
      }),
    ),
  ]);

  type DeployItem = { serviceId?: string; actor?: string };
  const deployItems = (deploymentsResult.Items ?? []) as DeployItem[];
  const totalDeployments = deployItems.length;
  const uniqueServices = new Set(deployItems.map((i) => i.serviceId).filter(Boolean)).size;
  const uniqueActors = new Set(deployItems.map((i) => i.actor).filter(Boolean)).size;
  const resolvedIncidents = incidentsResult.Count ?? 0;

  return {
    triggered: true,
    finding: `Weekly digest: ${totalDeployments} deployment${totalDeployments === 1 ? '' : 's'} across ${uniqueServices} service${uniqueServices === 1 ? '' : 's'} by ${uniqueActors} engineer${uniqueActors === 1 ? '' : 's'}. ${resolvedIncidents} incident${resolvedIncidents === 1 ? '' : 's'} resolved.`,
  };
}

/** Returns the ISO date string (YYYY-MM-DD) for the most recent Monday. */
function getMondayISO(): string {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
  const daysToMonday = (day + 6) % 7; // days since last Monday
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - daysToMonday);
  return monday.toISOString().slice(0, 10);
}

export async function evaluateOnCallShift(_rule: AlertRule): Promise<EvaluationResult> {
  const docClient = getDynamoClient();
  const mondayISO = getMondayISO();

  const result = await docClient.send(
    new ScanCommand({
      TableName: getTableName('on-call'),
      FilterExpression: 'SK = :week',
      ExpressionAttributeValues: {
        ':week': `WEEK#${mondayISO}`,
      },
      ProjectionExpression: 'teamId, teamName, weekStart, #primary, secondary',
      ExpressionAttributeNames: {
        '#primary': 'primary',
      },
    }),
  );

  type RotationItem = { teamId?: string; teamName?: string; weekStart?: string; primary?: string; secondary?: string };
  const rotations = (result.Items ?? []) as RotationItem[];

  if (rotations.length === 0) {
    return { triggered: false, finding: '' };
  }

  const lines = rotations.map(
    (r) => `• *${r.teamName ?? r.teamId ?? 'Unknown'}*: ${r.primary ?? '—'}${r.secondary ? ` (backup: ${r.secondary})` : ''}`,
  );

  return {
    triggered: true,
    finding: `On-call this week:\n${lines.join('\n')}`,
  };
}

// ---------------------------------------------------------------------------
// Dispatch table
// ---------------------------------------------------------------------------

type ConditionEvaluator = (rule: AlertRule) => Promise<EvaluationResult>;

export const EVALUATORS: Record<AlertRule['condition'], ConditionEvaluator> = {
  deploy_failed: evaluateDeployFailed,
  p1_incident: evaluateP1Incident,
  cost_spike: evaluateCostSpike,
  critical_vuln: evaluateCriticalVuln,
  config_drift: evaluateConfigDrift,
  weekly_digest: evaluateWeeklyDigest,
  oncall_shift: evaluateOnCallShift,
};
