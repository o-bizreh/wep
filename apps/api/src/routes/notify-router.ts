import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  ScanCommand,
  UpdateCommand,
} from '@wep/aws-clients';
import { getTableName } from '@wep/aws-clients';
import { WebClient } from '@slack/web-api';

const slackClient = new WebClient(process.env['SLACK_BOT_TOKEN'] ?? '');

const BROADCAST_TYPE_EMOJI: Record<string, string> = {
  incident: '🚨',
  maintenance: '🔧',
  release: '🚀',
  general: '📢',
};

function broadcastChannel(type: string): string {
  switch (type) {
    case 'incident':    return process.env['SLACK_INCIDENT_CHANNEL']    ?? '#incidents';
    case 'maintenance': return process.env['SLACK_ENGINEERING_CHANNEL'] ?? '#engineering';
    case 'release':     return process.env['SLACK_RELEASES_CHANNEL']    ?? '#releases';
    default:            return process.env['SLACK_GENERAL_CHANNEL']     ?? '#general';
  }
}

function notFound(res: Response, msg = 'Not found') {
  return res.status(404).json({ type: '/errors/not-found', title: 'Not Found', status: 404, detail: msg });
}

function badRequest(res: Response, msg: string) {
  return res.status(400).json({ type: '/errors/bad-request', title: 'Bad Request', status: 400, detail: msg });
}

export function createNotifyRouter(dynamoClient: DynamoDBDocumentClient): Router {
  const router = Router();
  const table = getTableName('notify');

  // ─── Alert Rules ──────────────────────────────────────────────────────────

  // GET /notify/alert-rules
  router.get('/alert-rules', async (_req: Request, res: Response) => {
    try {
      const result = await dynamoClient.send(new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': 'ALERT_RULE' },
      }));
      return res.json({ rules: (result as any).Items ?? [] });
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to list alert rules' });
    }
  });

  // POST /notify/alert-rules
  router.post('/alert-rules', async (req: Request, res: Response) => {
    const { name, condition, threshold, channelType, channelTarget, enabled } = req.body as {
      name?: string;
      condition?: string;
      threshold?: number;
      channelType?: string;
      channelTarget?: string;
      enabled?: boolean;
    };

    if (!name?.trim()) return badRequest(res, 'name is required');
    if (!condition) return badRequest(res, 'condition is required');
    if (!channelType) return badRequest(res, 'channelType is required');
    if (!channelTarget?.trim()) return badRequest(res, 'channelTarget is required');

    const validConditions = ['deploy_failed', 'p1_incident', 'cost_spike', 'critical_vuln', 'config_drift'];
    if (!validConditions.includes(condition)) return badRequest(res, `condition must be one of: ${validConditions.join(', ')}`);

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const item = {
      PK: 'ALERT_RULE',
      SK: `RULE#${id}`,
      id,
      name: name.trim(),
      condition,
      threshold: threshold ?? null,
      channelType,
      channelTarget: channelTarget.trim(),
      enabled: enabled ?? true,
      createdAt,
    };

    try {
      await dynamoClient.send(new PutCommand({ TableName: table, Item: item }));
      return res.status(201).json(item);
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to create alert rule' });
    }
  });

  // PATCH /notify/alert-rules/:id
  router.patch('/alert-rules/:id', async (req: Request, res: Response) => {
    const id = req.params['id']!;
    const { enabled, channelTarget } = req.body as { enabled?: boolean; channelTarget?: string };

    const existing = await dynamoClient.send(new GetCommand({
      TableName: table,
      Key: { PK: 'ALERT_RULE', SK: `RULE#${id}` },
    }));
    if (!(existing as any).Item) return notFound(res, 'Alert rule not found');

    const updates: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};

    if (enabled !== undefined) {
      updates.push('#enabled = :enabled');
      names['#enabled'] = 'enabled';
      values[':enabled'] = enabled;
    }
    if (channelTarget !== undefined) {
      updates.push('#channelTarget = :channelTarget');
      names['#channelTarget'] = 'channelTarget';
      values[':channelTarget'] = channelTarget;
    }

    if (updates.length === 0) return badRequest(res, 'No fields to update');

    try {
      const result = await dynamoClient.send(new UpdateCommand({
        TableName: table,
        Key: { PK: 'ALERT_RULE', SK: `RULE#${id}` },
        UpdateExpression: `SET ${updates.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      }));
      return res.json((result as any).Attributes);
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to update alert rule' });
    }
  });

  // DELETE /notify/alert-rules/:id
  router.delete('/alert-rules/:id', async (req: Request, res: Response) => {
    const id = req.params['id']!;
    try {
      await dynamoClient.send(new DeleteCommand({
        TableName: table,
        Key: { PK: 'ALERT_RULE', SK: `RULE#${id}` },
      }));
      return res.status(204).send();
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to delete alert rule' });
    }
  });

  // ─── Subscriptions ────────────────────────────────────────────────────────

  // GET /notify/subscriptions?userId=<id>
  router.get('/subscriptions', async (req: Request, res: Response) => {
    const userId = req.query['userId'] as string | undefined;
    if (!userId) return badRequest(res, 'userId query param is required');

    try {
      const result = await dynamoClient.send(new QueryCommand({
        TableName: table,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `USER#${userId}` },
      }));
      return res.json({ subscriptions: (result as any).Items ?? [] });
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to list subscriptions' });
    }
  });

  // POST /notify/subscriptions
  router.post('/subscriptions', async (req: Request, res: Response) => {
    const { userId, serviceId, serviceName, events } = req.body as {
      userId?: string;
      serviceId?: string;
      serviceName?: string;
      events?: string[];
    };

    if (!userId?.trim()) return badRequest(res, 'userId is required');
    if (!serviceId?.trim()) return badRequest(res, 'serviceId is required');
    if (!serviceName?.trim()) return badRequest(res, 'serviceName is required');
    if (!Array.isArray(events) || events.length === 0) return badRequest(res, 'events is required');

    const createdAt = new Date().toISOString();
    const item = {
      PK: `SUBSCRIPTION#${serviceId.trim()}`,
      SK: `USER#${userId.trim()}`,
      GSI1PK: `USER#${userId.trim()}`,
      GSI1SK: `SUB#${serviceId.trim()}`,
      userId: userId.trim(),
      serviceId: serviceId.trim(),
      serviceName: serviceName.trim(),
      events,
      createdAt,
    };

    try {
      await dynamoClient.send(new PutCommand({ TableName: table, Item: item }));
      return res.status(201).json(item);
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to create subscription' });
    }
  });

  // DELETE /notify/subscriptions/:userId/:serviceId
  router.delete('/subscriptions/:userId/:serviceId', async (req: Request, res: Response) => {
    const userId = req.params['userId']!;
    const serviceId = req.params['serviceId']!;
    try {
      await dynamoClient.send(new DeleteCommand({
        TableName: table,
        Key: { PK: `SUBSCRIPTION#${serviceId}`, SK: `USER#${userId}` },
      }));
      return res.status(204).send();
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to delete subscription' });
    }
  });

  // ─── Weekly Digest ────────────────────────────────────────────────────────

  // GET /notify/weekly-digest/latest
  router.get('/weekly-digest/latest', async (_req: Request, res: Response) => {
    try {
      const result = await dynamoClient.send(new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': 'DIGEST' },
        ScanIndexForward: false,
        Limit: 1,
      }));
      const items = (result as any).Items ?? [];
      if (items.length === 0) return res.status(404).json({ detail: 'No digest found yet' });
      return res.json(items[0]);
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to get digest' });
    }
  });

  // POST /notify/weekly-digest/generate
  router.post('/weekly-digest/generate', async (_req: Request, res: Response) => {
    try {
      const deployTable = getTableName('deployment-tracker');
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      let deployments: any[] = [];
      try {
        const deployResult = await dynamoClient.send(new ScanCommand({
          TableName: deployTable,
          Limit: 50,
          FilterExpression: '#ts >= :cutoff',
          ExpressionAttributeNames: { '#ts': 'completedAt' },
          ExpressionAttributeValues: { ':cutoff': sevenDaysAgo },
        }));
        deployments = (deployResult as any).Items ?? [];
      } catch {
        // Deployment table may be empty or not exist — degrade gracefully
      }

      const serviceNames = [...new Set(deployments.map((d: any) => d.serviceName ?? d.serviceId).filter(Boolean))] as string[];

      // Compute Monday of current week
      const now = new Date();
      const day = now.getDay();
      const diffToMonday = (day === 0 ? -6 : 1 - day);
      const monday = new Date(now);
      monday.setDate(now.getDate() + diffToMonday);
      monday.setHours(0, 0, 0, 0);

      const highlights: string[] = [
        `${deployments.length} deployment${deployments.length !== 1 ? 's' : ''} recorded in the last 7 days`,
        `${serviceNames.length} unique service${serviceNames.length !== 1 ? 's' : ''} deployed`,
      ];
      if (deployments.length === 0) highlights.push('No deployment activity detected — check GitHub Actions integration');

      const isoDate = monday.toISOString().slice(0, 10);
      const generatedAt = new Date().toISOString();

      const digest = {
        PK: 'DIGEST',
        SK: `RUN#${isoDate}`,
        generatedAt,
        weekOf: isoDate,
        deployments: { total: deployments.length, services: serviceNames },
        highlights,
      };

      await dynamoClient.send(new PutCommand({ TableName: table, Item: digest }));
      return res.status(201).json(digest);
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to generate digest' });
    }
  });

  // ─── Broadcasts ───────────────────────────────────────────────────────────

  // GET /notify/broadcasts
  router.get('/broadcasts', async (_req: Request, res: Response) => {
    try {
      const result = await dynamoClient.send(new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': 'TEMPLATE' },
      }));
      return res.json({ broadcasts: (result as any).Items ?? [] });
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to list broadcasts' });
    }
  });

  // POST /notify/broadcasts
  router.post('/broadcasts', async (req: Request, res: Response) => {
    const { name, type, subject, body } = req.body as {
      name?: string;
      type?: string;
      subject?: string;
      body?: string;
    };

    if (!name?.trim()) return badRequest(res, 'name is required');
    if (!type) return badRequest(res, 'type is required');
    if (!subject?.trim()) return badRequest(res, 'subject is required');
    if (!body?.trim()) return badRequest(res, 'body is required');

    const validTypes = ['incident', 'maintenance', 'release', 'general'];
    if (!validTypes.includes(type)) return badRequest(res, `type must be one of: ${validTypes.join(', ')}`);

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const item = {
      PK: 'TEMPLATE',
      SK: `TPL#${id}`,
      id,
      name: name.trim(),
      type,
      subject: subject.trim(),
      body: body.trim(),
      createdAt,
      sentAt: null,
    };

    try {
      await dynamoClient.send(new PutCommand({ TableName: table, Item: item }));
      return res.status(201).json(item);
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to create broadcast' });
    }
  });

  // POST /notify/broadcasts/:id/send
  router.post('/broadcasts/:id/send', async (req: Request, res: Response) => {
    const id = req.params['id']!;

    const existing = await dynamoClient.send(new GetCommand({
      TableName: table,
      Key: { PK: 'TEMPLATE', SK: `TPL#${id}` },
    }));
    if (!(existing as any).Item) return notFound(res, 'Broadcast not found');

    const broadcast = (existing as any).Item as { name: string; type: string; subject: string; body: string };
    const sentAt = new Date().toISOString();

    try {
      await dynamoClient.send(new UpdateCommand({
        TableName: table,
        Key: { PK: 'TEMPLATE', SK: `TPL#${id}` },
        UpdateExpression: 'SET sentAt = :sentAt',
        ExpressionAttributeValues: { ':sentAt': sentAt },
        ReturnValues: 'ALL_NEW',
      }));
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to send broadcast' });
    }

    const channel = broadcastChannel(broadcast.type);
    const emoji = BROADCAST_TYPE_EMOJI[broadcast.type] ?? '📢';

    try {
      await slackClient.chat.postMessage({
        channel,
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: `${emoji} ${broadcast.subject}`, emoji: true },
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: broadcast.body },
          },
          {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: `Broadcast by WEP • ${sentAt}` }],
          },
        ],
      });
      return res.json({ sentAt, slackDelivered: true, channel });
    } catch (e) {
      console.error('[notify] Slack post failed for broadcast', id, e);
      return res.json({ sentAt, slackDelivered: false, slackError: e instanceof Error ? e.message : String(e) });
    }
  });

  return router;
}
