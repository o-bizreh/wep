import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { EVALUATORS } from './evaluator.js';
import { isDuplicate, recordFired } from './deduplication.js';
import { sendSlackAlert, type AlertRule } from './notifier.js';
import { notifySubscribers } from './subscriptions.js';

function getDocClient(): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: process.env['AWS_REGION'] ?? 'me-south-1' }),
  );
}

function getNotifyTableName(): string {
  const env = process.env['WEP_ENVIRONMENT'] ?? 'development';
  return `wep-notify-${env}`;
}

async function loadEnabledRules(conditions: string[]): Promise<AlertRule[]> {
  const docClient = getDocClient();

  const result = await docClient.send(
    new ScanCommand({
      TableName: getNotifyTableName(),
      FilterExpression: 'PK = :pk AND enabled = :enabled',
      ExpressionAttributeValues: {
        ':pk': 'ALERT_RULE',
        ':enabled': true,
      },
    }),
  );

  const items = (result.Items ?? []) as AlertRule[];
  return items.filter((rule) => conditions.includes(rule.condition));
}

export const handler = async (event: { conditions?: string[] }): Promise<void> => {
  const conditions =
    event.conditions ?? [
      'deploy_failed',
      'p1_incident',
      'cost_spike',
      'critical_vuln',
      'config_drift',
    ];

  console.log(JSON.stringify({ message: 'Alert evaluator started', conditions }));

  let rules: AlertRule[];
  try {
    rules = await loadEnabledRules(conditions);
  } catch (err) {
    console.error(JSON.stringify({ message: 'Failed to load alert rules', error: String(err) }));
    return;
  }

  console.log(JSON.stringify({ message: `Loaded ${rules.length} enabled rule(s)`, conditions }));

  let evaluated = 0;
  let fired = 0;

  for (const rule of rules) {
    evaluated++;

    const evaluator = EVALUATORS[rule.condition];
    if (!evaluator) {
      console.warn(
        JSON.stringify({ message: 'No evaluator found for condition', condition: rule.condition }),
      );
      continue;
    }

    let result: Awaited<ReturnType<typeof evaluator>>;
    try {
      result = await evaluator(rule);
    } catch (err) {
      console.error(
        JSON.stringify({
          message: 'Condition evaluation failed',
          ruleId: rule.id,
          condition: rule.condition,
          error: String(err),
        }),
      );
      continue;
    }

    if (!result.triggered) {
      console.log(
        JSON.stringify({
          message: 'Condition not triggered',
          ruleId: rule.id,
          condition: rule.condition,
        }),
      );
      continue;
    }

    // Check deduplication cooldown
    let duplicate: boolean;
    try {
      duplicate = await isDuplicate(rule.id, rule.condition);
    } catch (err) {
      console.error(
        JSON.stringify({
          message: 'Deduplication check failed — will fire alert anyway',
          ruleId: rule.id,
          error: String(err),
        }),
      );
      duplicate = false;
    }

    if (duplicate) {
      console.log(
        JSON.stringify({
          message: 'Alert suppressed by deduplication cooldown',
          ruleId: rule.id,
          condition: rule.condition,
        }),
      );
      continue;
    }

    // Only Slack notifications are supported for now
    if (rule.channelType !== 'slack') {
      console.warn(
        JSON.stringify({
          message: 'Unsupported channel type — skipping notification',
          ruleId: rule.id,
          channelType: rule.channelType,
        }),
      );
      continue;
    }

    try {
      await sendSlackAlert(rule.channelTarget, rule, result.finding);
      console.log(
        JSON.stringify({
          message: 'Slack alert sent',
          ruleId: rule.id,
          condition: rule.condition,
          channel: rule.channelTarget,
          finding: result.finding,
        }),
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          message: 'Failed to send Slack alert',
          ruleId: rule.id,
          condition: rule.condition,
          error: String(err),
        }),
      );
      continue;
    }

    // Fan out to per-service subscribers for conditions that carry affected service IDs.
    if (
      result.affectedServiceIds &&
      result.affectedServiceIds.length > 0 &&
      (rule.condition === 'deploy_failed' || rule.condition === 'config_drift')
    ) {
      const eventType = rule.condition === 'deploy_failed' ? 'deploy' : 'drift';
      for (const serviceId of result.affectedServiceIds) {
        try {
          await notifySubscribers(serviceId, serviceId, eventType, result.finding);
        } catch (err) {
          console.error(
            JSON.stringify({
              message: 'Subscription fan-out failed',
              serviceId,
              condition: rule.condition,
              error: String(err),
            }),
          );
        }
      }
    }

    try {
      await recordFired(rule.id, rule.condition);
    } catch (err) {
      console.error(
        JSON.stringify({
          message: 'Failed to record alert fired timestamp',
          ruleId: rule.id,
          error: String(err),
        }),
      );
    }

    fired++;
  }

  console.log(
    JSON.stringify({
      message: `Evaluated ${evaluated} rule(s), fired ${fired} alert(s)`,
      evaluated,
      fired,
    }),
  );
};
