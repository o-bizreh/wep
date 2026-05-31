import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { WebClient } from '@slack/web-api';

interface Subscription {
  userId: string;
  serviceId: string;
  serviceName: string;
  events: string[];
}

let slackClient: WebClient | null = null;

function getSlackClient(): WebClient {
  if (!slackClient) {
    const token = process.env['SLACK_BOT_TOKEN'];
    if (!token) {
      throw new Error('SLACK_BOT_TOKEN environment variable is not set');
    }
    slackClient = new WebClient(token);
  }
  return slackClient;
}

function getDocClient(): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: process.env['AWS_REGION'] ?? 'me-south-1' }),
  );
}

function getNotifyTable(): string {
  return `wep-notify-${process.env['WEP_ENVIRONMENT'] ?? 'development'}`;
}

/**
 * Returns all subscribers for a given serviceId who have opted in to the
 * specified event type. Subscriptions are stored with:
 *   PK = 'SUBSCRIPTION#<serviceId>'
 *   SK = 'USER#<userId>'
 */
export async function getSubscribers(
  serviceId: string,
  eventType: 'deploy' | 'drift',
): Promise<Subscription[]> {
  const docClient = getDocClient();

  const result = await docClient.send(
    new QueryCommand({
      TableName: getNotifyTable(),
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `SUBSCRIPTION#${serviceId}`,
      },
    }),
  );

  const items = (result.Items ?? []) as Subscription[];
  return items.filter(
    (sub) => Array.isArray(sub.events) && sub.events.includes(eventType),
  );
}

/**
 * Sends a Slack DM to every subscriber of the given service for the given
 * event type. Each message is sent as a direct message opened by user ID.
 * Failures per subscriber are logged but do not abort the rest.
 */
export async function notifySubscribers(
  serviceId: string,
  serviceName: string,
  eventType: 'deploy' | 'drift',
  detail: string,
): Promise<void> {
  let subscribers: Subscription[];
  try {
    subscribers = await getSubscribers(serviceId, eventType);
  } catch (err) {
    console.error(
      JSON.stringify({
        message: 'Failed to fetch subscribers',
        serviceId,
        eventType,
        error: String(err),
      }),
    );
    return;
  }

  if (subscribers.length === 0) {
    return;
  }

  const client = getSlackClient();

  for (const sub of subscribers) {
    try {
      const dmResult = await client.conversations.open({ users: sub.userId });
      const channelId = dmResult.channel?.id;
      if (!channelId) {
        console.warn(
          JSON.stringify({
            message: 'Could not open DM channel for subscriber',
            userId: sub.userId,
            serviceId,
          }),
        );
        continue;
      }

      await client.chat.postMessage({
        channel: channelId,
        text: `🔔 *${serviceName}* — ${detail}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `🔔 *${serviceName}* — ${detail}`,
            },
          },
        ],
      });
    } catch (err) {
      console.error(
        JSON.stringify({
          message: 'Failed to send DM to subscriber',
          userId: sub.userId,
          serviceId,
          error: String(err),
        }),
      );
    }
  }
}
