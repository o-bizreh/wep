import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const COOLDOWN_SECONDS: Record<string, number> = {
  deploy_failed: 30 * 60,        // 30 minutes
  p1_incident: 30 * 60,          // 30 minutes
  cost_spike: 6 * 60 * 60,       // 6 hours
  critical_vuln: 6 * 60 * 60,    // 6 hours
  config_drift: 2 * 60 * 60,     // 2 hours
  weekly_digest: 6 * 24 * 60 * 60,  // 6 days — prevents duplicate send on schedule misfire
  oncall_shift: 6 * 24 * 60 * 60,   // 6 days — one notification per on-call week
};

/** Weekly conditions need a longer TTL so the cooldown record outlives the 24-hour default. */
const CONDITIONS_WITH_WEEKLY_TTL = new Set(['weekly_digest', 'oncall_shift']);
const TTL_SECONDS = 24 * 60 * 60;          // 24 hours (default)
const WEEKLY_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function getDocClient(): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: process.env['AWS_REGION'] ?? 'me-south-1' }),
  );
}

function getNotifyTableName(): string {
  const env = process.env['WEP_ENVIRONMENT'] ?? 'development';
  return `wep-notify-${env}`;
}

/**
 * Returns true if the alert is within its cooldown window and should be suppressed.
 * Returns false if the alert should fire (not recently fired or cooldown expired).
 */
export async function isDuplicate(ruleId: string, condition: string): Promise<boolean> {
  const docClient = getDocClient();
  const tableName = getNotifyTableName();
  const sk = `RULE#${ruleId}#${condition}`;

  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: 'ALERT_FIRED',
        SK: sk,
      },
    }),
  );

  if (!result.Item) {
    return false;
  }

  const lastFiredAt = result.Item['lastFiredAt'] as string | undefined;
  if (!lastFiredAt) {
    return false;
  }

  const lastFiredMs = new Date(lastFiredAt).getTime();
  const nowMs = Date.now();
  const cooldownMs = (COOLDOWN_SECONDS[condition] ?? 30 * 60) * 1000;

  return nowMs - lastFiredMs < cooldownMs;
}

/**
 * Records that an alert fired right now, with a 24-hour TTL.
 */
export async function recordFired(ruleId: string, condition: string): Promise<void> {
  const docClient = getDocClient();
  const tableName = getNotifyTableName();
  const sk = `RULE#${ruleId}#${condition}`;
  const now = new Date();
  const ttl = CONDITIONS_WITH_WEEKLY_TTL.has(condition) ? WEEKLY_TTL_SECONDS : TTL_SECONDS;
  const ttlUnix = Math.floor(now.getTime() / 1000) + ttl;

  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: 'ALERT_FIRED',
        SK: sk,
        lastFiredAt: now.toISOString(),
        ttl: ttlUnix,
      },
    }),
  );
}
