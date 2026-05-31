import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import {
  type DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
} from '@wep/aws-clients';
import { getTableName } from '@wep/aws-clients';
import { WebClient } from '@slack/web-api';

interface Announcement {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
  createdAt: string;
  author: string;
}

const slackClient = new WebClient(process.env['SLACK_BOT_TOKEN'] ?? '');

const SEVERITY_EMOJI: Record<string, string> = {
  critical: '🔴',
  warning: '🟡',
  info: '🔵',
};


export function createAnnouncementsRouter(dynamoClient: DynamoDBDocumentClient): Router {
  const router = Router();
  const table = getTableName('announcements');

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const result = await dynamoClient.send(new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': 'ANNOUNCEMENT' },
        ScanIndexForward: false,
        Limit: 50,
      }));
      return res.json((result as any).Items ?? []);
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to list announcements' });
    }
  });

  router.post('/', async (req: Request, res: Response) => {
    const { title, body, severity, author } = req.body as Partial<Announcement>;
    if (!title || !body || !severity || !author) {
      return res.status(400).json({
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        detail: 'title, body, severity, and author are required',
      });
    }
    if (!['info', 'warning', 'critical'].includes(severity)) {
      return res.status(400).json({
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        detail: 'severity must be info, warning, or critical',
      });
    }

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const announcement: Announcement = { id, title, body, severity, author, createdAt };

    const item: Record<string, unknown> = {
      PK: 'ANNOUNCEMENT',
      SK: `POST#${createdAt}#${id}`,
      GSI1PK: 'ANNOUNCEMENT',
      GSI1SK: `POST#${createdAt}#${id}`,
      ...announcement,
    };

    try {
      await dynamoClient.send(new PutCommand({ TableName: table, Item: item }));
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to create announcement' });
    }

    const channel = process.env['SLACK_ANNOUNCEMENTS_CHANNEL'] ?? '#announcements';
    const emoji = SEVERITY_EMOJI[severity] ?? '🔵';
    const truncatedBody = body.length > 500 ? body.slice(0, 500) + '…' : body;

    try {
      await slackClient.chat.postMessage({
        channel,
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: `${emoji} ${title}`, emoji: true },
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: truncatedBody },
          },
          {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: `Posted by ${author} • WEP Announcements` }],
          },
        ],
      });
    } catch (e) {
      console.error('[announcements] Slack post failed:', e instanceof Error ? e.message : e);
    }

    return res.status(201).json(announcement);
  });

  return router;
}
