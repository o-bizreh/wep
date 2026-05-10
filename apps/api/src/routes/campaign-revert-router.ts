import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import { problemDetails } from '@wep/domain-types';
import {
  DynamoDBDocumentClient,
  DynamoDBClient,
  PutCommand,
  ScanCommand,
  UpdateCommand,
  DeleteCommand,
  GetCommand,
  SchedulerClient,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  credentialStore,
  regionStore,
} from '@wep/aws-clients';
import { CreateTableCommand, ResourceInUseException } from '@aws-sdk/client-dynamodb';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TABLE_NAME = 'wep-campaign-reverts-production';
const PLATFORM_URL = process.env['PLATFORM_URL'] ?? 'http://localhost:5173';

// ---------------------------------------------------------------------------
// DynamoDB clients
// ---------------------------------------------------------------------------

function buildClients(): { docClient: DynamoDBDocumentClient; rawClient: DynamoDBClient } {
  const region = regionStore.getProvider();
  const credentials = credentialStore.getProvider();
  const endpoint = process.env['AWS_ENDPOINT_URL'];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config: Record<string, any> = endpoint
    ? { region: 'us-east-1', endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }
    : { region, credentials };

  const rawClient = new DynamoDBClient(config);
  const docClient = DynamoDBDocumentClient.from(rawClient);
  return { docClient, rawClient };
}

async function ensureTable(rawClient: DynamoDBClient): Promise<void> {
  try {
    await rawClient.send(
      new CreateTableCommand({
        TableName: TABLE_NAME,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [{ AttributeName: 'campaignId', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'campaignId', KeyType: 'HASH' }],
      }),
    );
    console.log(`[campaign-revert] Created table ${TABLE_NAME}`);
  } catch (err) {
    if (err instanceof ResourceInUseException) {
      // already exists — fine
    } else {
      console.warn('[campaign-revert] Could not create table:', (err as Error).message);
    }
  }
}

// ---------------------------------------------------------------------------
// Scheduler helpers
// ---------------------------------------------------------------------------

function buildSchedulerClient(): SchedulerClient {
  const region = regionStore.getProvider();
  const credentials = credentialStore.getProvider();
  return new SchedulerClient({ region, credentials });
}

function formatScheduleDate(isoDate: string): string {
  const d = new Date(isoDate);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T12:00:00`;
}

function computeRevertDate(campaignStartDate: string, durationDays: number): string {
  const ts = new Date(campaignStartDate).getTime() + durationDays * 86_400_000;
  return new Date(ts).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Slack helpers
// ---------------------------------------------------------------------------

async function postToSlack(webhookUrl: string, blocks: unknown[]): Promise<void> {
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks }),
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CampaignRevert {
  campaignId: string;
  name: string;
  report: string;
  resourceSnapshot: unknown[];
  campaignStartDate: string;
  durationDays: number;
  revertDate: string;
  revertSuggestions: string;
  status: 'pending-revert' | 'reverted';
  createdBy: string;
  createdByEmail: string;
  notificationWebhook: string | null;
  notificationChannel: string | null;
  scheduleName: string | null;
  createdAt: string;
  revertedAt: string | null;
}

export interface CampaignApproval {
  campaignId: string; // primary key — value: approval_${approvalId}
  approvalId: string;
  report: string;
  resourceData: string;
  sharedByName: string;
  sharedByEmail: string;
  targetChannel: string;
  slackWebhook: string;
  status: 'pending' | 'approved';
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createCampaignRevertRouter(): Router {
  const router = Router();
  const { docClient, rawClient } = buildClients();

  // Best-effort table creation at startup
  void ensureTable(rawClient);

  // -------------------------------------------------------------------------
  // POST /campaign-reverts/remind
  // -------------------------------------------------------------------------
  router.post('/remind', async (req: Request, res: Response) => {
    const {
      name,
      report,
      resourceSnapshot,
      campaignStartDate,
      durationDays,
      revertSuggestions,
      createdBy,
      createdByEmail,
      notificationWebhook,
      notificationChannel,
    } = req.body as Partial<{
      name: string;
      report: string;
      resourceSnapshot: unknown[];
      campaignStartDate: string;
      durationDays: number;
      revertSuggestions: string;
      createdBy: string;
      createdByEmail: string;
      notificationWebhook: string;
      notificationChannel: string;
    }>;

    if (!name || !campaignStartDate || durationDays === undefined || !report) {
      res.status(400).json(problemDetails(400, 'Bad request', 'name, campaignStartDate, durationDays, and report are required'));
      return;
    }

    const campaignId = randomUUID();
    const revertDate = computeRevertDate(campaignStartDate, durationDays);
    const now = new Date().toISOString();

    let scheduleName: string | null = null;

    const roleArn = process.env['EVENTBRIDGE_SCHEDULER_ROLE_ARN'];
    if (roleArn) {
      try {
        const schedulerClient = buildSchedulerClient();
        const busArn = process.env['EVENTBRIDGE_BUS_ARN']
          ?? `arn:aws:events:${process.env['AWS_REGION'] ?? 'me-south-1'}:${process.env['AWS_ACCOUNT_ID'] ?? '000000000000'}:event-bus/default`;

        scheduleName = `wep-cr-${campaignId.slice(0, 8)}`;

        const targetInput = JSON.stringify({
          source: 'wep.campaign-revert',
          'detail-type': 'CampaignRevertReminder',
          detail: {
            campaignId,
            campaignName: name,
            revertDate,
            createdBy: createdBy ?? 'unknown',
            createdByEmail: createdByEmail ?? '',
            notificationWebhook: notificationWebhook ?? null,
            notificationChannel: notificationChannel ?? null,
            revertSuggestions: revertSuggestions ?? '',
          },
        });

        await schedulerClient.send(
          new CreateScheduleCommand({
            Name: scheduleName,
            ScheduleExpression: `at(${formatScheduleDate(revertDate)})`,
            FlexibleTimeWindow: { Mode: 'OFF' },
            Target: {
              Arn: busArn,
              RoleArn: roleArn,
              Input: targetInput,
            },
          }),
        );
        console.log(`[campaign-revert] Created schedule ${scheduleName} for ${revertDate}`);
      } catch (schedErr) {
        console.warn('[campaign-revert] Failed to create schedule:', (schedErr as Error).message);
        scheduleName = null;
      }
    } else {
      console.warn('[campaign-revert] EVENTBRIDGE_SCHEDULER_ROLE_ARN not set — skipping schedule creation');
    }

    const item: CampaignRevert = {
      campaignId,
      name,
      report,
      resourceSnapshot: resourceSnapshot ?? [],
      campaignStartDate,
      durationDays,
      revertDate,
      revertSuggestions: revertSuggestions ?? '',
      status: 'pending-revert',
      createdBy: createdBy ?? (req.headers['x-user'] as string | undefined) ?? 'unknown',
      createdByEmail: createdByEmail ?? '',
      notificationWebhook: notificationWebhook ?? null,
      notificationChannel: notificationChannel ?? null,
      scheduleName,
      createdAt: now,
      revertedAt: null,
    };

    try {
      await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item as unknown as Record<string, unknown> }));
      res.status(201).json({ campaignId, revertDate });
    } catch (dbErr) {
      console.error('[campaign-revert] DynamoDB put failed:', dbErr);
      res.status(500).json(problemDetails(500, 'Internal error', 'Failed to save campaign'));
    }
  });

  // -------------------------------------------------------------------------
  // POST /campaign-reverts/share
  // -------------------------------------------------------------------------
  router.post('/share', async (req: Request, res: Response) => {
    const {
      report,
      resourceData,
      sharedByName,
      sharedByEmail,
      targetChannel,
      slackWebhook,
    } = req.body as Partial<{
      report: string;
      resourceData: unknown;
      sharedByName: string;
      sharedByEmail: string;
      targetChannel: string;
      slackWebhook: string;
    }>;

    if (!report || !sharedByName || !targetChannel || !slackWebhook) {
      res.status(400).json(problemDetails(400, 'Bad request', 'report, sharedByName, targetChannel, and slackWebhook are required'));
      return;
    }

    const approvalId = randomUUID();
    const now = new Date().toISOString();

    const item: CampaignApproval = {
      campaignId: `approval_${approvalId}`,
      approvalId,
      report,
      resourceData: typeof resourceData === 'string' ? resourceData : JSON.stringify(resourceData ?? null),
      sharedByName,
      sharedByEmail: sharedByEmail ?? '',
      targetChannel,
      slackWebhook,
      status: 'pending',
      approvedBy: null,
      approvedAt: null,
      createdAt: now,
    };

    try {
      await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item as unknown as Record<string, unknown> }));
    } catch (dbErr) {
      console.error('[campaign-revert] DynamoDB put failed:', dbErr);
      res.status(500).json(problemDetails(500, 'Internal error', 'Failed to save approval'));
      return;
    }

    const approveUrl = `${PLATFORM_URL}/ai/campaign-impact/approve/${approvalId}`;
    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `Campaign Impact Analysis shared by ${sharedByName}`, emoji: true },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: 'Review the campaign impact analysis before approving scaling changes.' },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'View Analysis', emoji: true },
            url: approveUrl,
            style: 'primary',
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Approve', emoji: true },
            url: `${approveUrl}?action=approve`,
            style: 'primary',
          },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Shared to ${targetChannel} • ${new Date().toLocaleDateString()}`,
          },
        ],
      },
    ];

    try {
      await postToSlack(slackWebhook, blocks);
    } catch (slackErr) {
      console.warn('[campaign-revert] Failed to post to Slack:', (slackErr as Error).message);
      // Don't fail the request — the approval was saved
    }

    res.status(201).json({ approvalId });
  });

  // -------------------------------------------------------------------------
  // GET /campaign-reverts/approval/:approvalId
  // -------------------------------------------------------------------------
  router.get('/approval/:approvalId', async (req: Request, res: Response) => {
    const { approvalId } = req.params as { approvalId: string };

    try {
      const result = await docClient.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { campaignId: `approval_${approvalId}` },
      }));

      if (!result.Item) {
        res.status(404).json(problemDetails(404, 'Not found', `Approval ${approvalId} not found`));
        return;
      }

      res.json(result.Item);
    } catch (err) {
      console.error('[campaign-revert] Get approval failed:', err);
      res.status(500).json(problemDetails(500, 'Internal error', 'Failed to fetch approval'));
    }
  });

  // -------------------------------------------------------------------------
  // POST /campaign-reverts/approval/:approvalId/approve
  // -------------------------------------------------------------------------
  router.post('/approval/:approvalId/approve', async (req: Request, res: Response) => {
    const { approvalId } = req.params as { approvalId: string };
    const { approvedBy } = req.body as { approvedBy?: string };

    // Fetch item to get slackWebhook
    let slackWebhook: string | null = null;
    try {
      const existing = await docClient.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { campaignId: `approval_${approvalId}` },
      }));
      if (!existing.Item) {
        res.status(404).json(problemDetails(404, 'Not found', `Approval ${approvalId} not found`));
        return;
      }
      slackWebhook = (existing.Item as unknown as CampaignApproval).slackWebhook ?? null;
    } catch (err) {
      console.error('[campaign-revert] Get approval failed:', err);
      res.status(500).json(problemDetails(500, 'Internal error', 'Failed to fetch approval'));
      return;
    }

    try {
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { campaignId: `approval_${approvalId}` },
          UpdateExpression: 'SET #status = :status, approvedBy = :approvedBy, approvedAt = :approvedAt',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':status': 'approved',
            ':approvedBy': approvedBy ?? 'unknown',
            ':approvedAt': new Date().toISOString(),
          },
        }),
      );
    } catch (err) {
      console.error('[campaign-revert] Update approval failed:', err);
      res.status(500).json(problemDetails(500, 'Internal error', 'Failed to approve'));
      return;
    }

    if (slackWebhook) {
      const remindUrl = `${PLATFORM_URL}/ai/campaign-impact/approve/${approvalId}?action=remind`;
      const blocks = [
        {
          type: 'header',
          text: { type: 'plain_text', text: `✅ Campaign Approved by ${approvedBy ?? 'unknown'}`, emoji: true },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: 'The campaign impact analysis has been approved. Click below to set up a revert reminder.' },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Add Revert Reminder', emoji: true },
              url: remindUrl,
              style: 'primary',
            },
          ],
        },
      ];
      try {
        await postToSlack(slackWebhook, blocks);
      } catch (slackErr) {
        console.warn('[campaign-revert] Failed to post approval Slack message:', (slackErr as Error).message);
      }
    }

    res.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // GET /campaign-reverts
  // -------------------------------------------------------------------------
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const result = await docClient.send(new ScanCommand({ TableName: TABLE_NAME }));
      // Filter out approval items (PK starts with approval_)
      const items = ((result.Items ?? []) as unknown as CampaignRevert[]).filter(
        (item) => typeof item.campaignId === 'string' && !item.campaignId.startsWith('approval_'),
      );
      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      res.json({ items });
    } catch (err) {
      console.error('[campaign-revert] Scan failed:', err);
      res.status(500).json(problemDetails(500, 'Internal error', 'Failed to list campaigns'));
    }
  });

  // -------------------------------------------------------------------------
  // PATCH /campaign-reverts/:id/revert
  // -------------------------------------------------------------------------
  router.patch('/:id/revert', async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };

    let existingScheduleName: string | null = null;
    try {
      const existing = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: { campaignId: id } }));
      if (!existing.Item) {
        res.status(404).json(problemDetails(404, 'Not found', `Campaign ${id} not found`));
        return;
      }
      existingScheduleName = (existing.Item as unknown as CampaignRevert).scheduleName ?? null;
    } catch (err) {
      console.error('[campaign-revert] Get failed:', err);
      res.status(500).json(problemDetails(500, 'Internal error', 'Failed to fetch campaign'));
      return;
    }

    if (existingScheduleName) {
      try {
        const schedulerClient = buildSchedulerClient();
        await schedulerClient.send(new DeleteScheduleCommand({ Name: existingScheduleName }));
        console.log(`[campaign-revert] Deleted schedule ${existingScheduleName}`);
      } catch (schedErr) {
        console.warn('[campaign-revert] Failed to delete schedule:', (schedErr as Error).message);
      }
    }

    try {
      const result = await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { campaignId: id },
          UpdateExpression: 'SET #status = :status, revertedAt = :revertedAt, scheduleName = :null',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':status': 'reverted',
            ':revertedAt': new Date().toISOString(),
            ':null': null,
          },
          ReturnValues: 'ALL_NEW',
        }),
      );
      res.json(result.Attributes);
    } catch (err) {
      console.error('[campaign-revert] Update failed:', err);
      res.status(500).json(problemDetails(500, 'Internal error', 'Failed to update campaign'));
    }
  });

  // -------------------------------------------------------------------------
  // DELETE /campaign-reverts/:id
  // -------------------------------------------------------------------------
  router.delete('/:id', async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };

    let existingScheduleName: string | null = null;
    try {
      const existing = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: { campaignId: id } }));
      existingScheduleName = existing.Item ? ((existing.Item as unknown as CampaignRevert).scheduleName ?? null) : null;
    } catch (_err) {
      // Continue — attempt delete anyway
    }

    if (existingScheduleName) {
      try {
        const schedulerClient = buildSchedulerClient();
        await schedulerClient.send(new DeleteScheduleCommand({ Name: existingScheduleName }));
        console.log(`[campaign-revert] Deleted schedule ${existingScheduleName}`);
      } catch (schedErr) {
        console.warn('[campaign-revert] Failed to delete schedule:', (schedErr as Error).message);
      }
    }

    try {
      await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { campaignId: id } }));
      res.status(204).send();
    } catch (err) {
      console.error('[campaign-revert] Delete failed:', err);
      res.status(500).json(problemDetails(500, 'Internal error', 'Failed to delete campaign'));
    }
  });

  return router;
}
