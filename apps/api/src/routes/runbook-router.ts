import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import * as https from 'https';
import * as http from 'http';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  DeleteCommand,
  GetCommand,
  credentialStore,
} from '@wep/aws-clients';
import { problemDetails } from '@wep/domain-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BlockType =
  | 'slack'
  | 'lambda-invoke'
  | 'ecs-describe'
  | 'ecs-force-deploy'
  | 'cloudwatch-logs'
  | 'cloudwatch-alarm'
  | 'sqs-peek'
  | 'step-fn-start'
  | 'github-workflow'
  | 'http-call'
  | 'delay';

export interface RunbookBlock {
  id: string;
  type: BlockType;
  title: string;
  config: Record<string, string>;
}

interface RunbookListItem {
  PK: 'RUNBOOK_LIST';
  SK: string; // <updatedAt>#<id>
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  blockCount: number;
  ownerId: string;
  ownerName: string;
  createdAt: string;
  updatedAt: string;
}

interface RunbookDetail {
  PK: string; // RUNBOOK#<id>
  SK: 'METADATA';
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  blocks: RunbookBlock[];
  ownerId: string;
  ownerName: string;
  createdAt: string;
  updatedAt: string;
}

type StepStatus = 'ok' | 'error' | 'skipped';
type ExecutionStatus = 'running' | 'completed' | 'failed';

interface StepResult {
  blockId: string;
  blockType: BlockType;
  blockTitle: string;
  status: StepStatus;
  output?: string;
  error?: string;
  durationMs: number;
}

interface ExecutionRecord {
  PK: string; // RUNBOOK#<id>
  SK: string; // EXEC#<startedAt>#<execId>
  execId: string;
  runbookId: string;
  executedBy: string;
  startedAt: string;
  completedAt?: string;
  status: ExecutionStatus;
  dryRun: boolean;
  stepResults: StepResult[];
}

// ---------------------------------------------------------------------------
// Block executor
// ---------------------------------------------------------------------------

async function httpRequest(
  url: string,
  method: string,
  body?: string,
  headers?: Record<string, string>,
  timeoutMs = 10_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const lib = isHttps ? https : http;

    const options: http.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: method.toUpperCase(),
      headers: {
        'Content-Type': 'application/json',
        ...headers,
        ...(body ? { 'Content-Length': Buffer.byteLength(body).toString() } : {}),
      },
    };

    const req = lib.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Converts standard Markdown to Slack mrkdwn format.
 * Slack does not render CommonMark — it has its own syntax.
 */
function markdownToMrkdwn(md: string): string {
  return md
    // Headings → bold (Slack has no headings)
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    // Horizontal rules → blank line
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Bold: **text** or __text__ → *text*
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '*$1*')
    // Italic: *text* → _text_ (after bold is resolved, single * left means italic)
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '_$1_')
    // Unordered lists: - item or * item → • item
    .replace(/^[ \t]*[-*]\s+/gm, '• ')
    // Inline code stays the same; strip triple-backtick fences to inline
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, '`').replace(/\n/g, ' '))
    .trim();
}

async function executeBlock(
  block: RunbookBlock,
  dryRun: boolean,
): Promise<StepResult> {
  const start = Date.now();
  const base: Omit<StepResult, 'status' | 'output' | 'error' | 'durationMs'> = {
    blockId: block.id,
    blockType: block.type,
    blockTitle: block.title,
  };

  if (dryRun) {
    return {
      ...base,
      status: 'ok',
      output: `[dry-run] Would execute: ${block.type} with config: ${JSON.stringify(block.config)}`,
      durationMs: 0,
    };
  }

  try {
    const region = process.env['AWS_REGION'] ?? 'me-south-1';

    switch (block.type) {
      case 'slack': {
        const { webhookUrl, message, channel } = block.config;
        if (!webhookUrl) throw new Error('webhookUrl is required');
        const mrkdwn = markdownToMrkdwn(message ?? '');
        const payload = JSON.stringify({ text: mrkdwn, channel });
        await httpRequest(webhookUrl, 'POST', payload);
        return { ...base, status: 'ok', output: 'Message sent', durationMs: Date.now() - start };
      }

      case 'lambda-invoke': {
        const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
        const { functionName, payload } = block.config;
        if (!functionName) throw new Error('functionName is required');
        const client = new LambdaClient({ region, credentials: credentialStore.getProvider() });
        const cmd = new InvokeCommand({
          FunctionName: functionName,
          Payload: new TextEncoder().encode(payload ?? '{}'),
        });
        const response = await client.send(cmd);
        const decoded = response.Payload
          ? new TextDecoder().decode(response.Payload).slice(0, 500)
          : '(no payload)';
        return { ...base, status: 'ok', output: decoded, durationMs: Date.now() - start };
      }

      case 'ecs-describe': {
        const { ECSClient, DescribeServicesCommand } = await import('@aws-sdk/client-ecs');
        const { cluster, service } = block.config;
        if (!cluster || !service) throw new Error('cluster and service are required');
        const client = new ECSClient({ region, credentials: credentialStore.getProvider() });
        const cmd = new DescribeServicesCommand({ cluster, services: [service] });
        const response = await client.send(cmd);
        const svc = response.services?.[0];
        const output = svc
          ? `status=${svc.status} runningCount=${svc.runningCount} desiredCount=${svc.desiredCount}`
          : 'Service not found';
        return { ...base, status: 'ok', output, durationMs: Date.now() - start };
      }

      case 'ecs-force-deploy': {
        const { ECSClient, UpdateServiceCommand } = await import('@aws-sdk/client-ecs');
        const { cluster, service } = block.config;
        if (!cluster || !service) throw new Error('cluster and service are required');
        const client = new ECSClient({ region, credentials: credentialStore.getProvider() });
        const cmd = new UpdateServiceCommand({ cluster, service, forceNewDeployment: true });
        await client.send(cmd);
        return { ...base, status: 'ok', output: `Force deployment triggered for ${service}`, durationMs: Date.now() - start };
      }

      case 'cloudwatch-logs': {
        const { CloudWatchLogsClient, GetLogEventsCommand } = await import('@aws-sdk/client-cloudwatch-logs');
        const { logGroup, logStream, limit } = block.config;
        if (!logGroup || !logStream) throw new Error('logGroup and logStream are required');
        const client = new CloudWatchLogsClient({ region, credentials: credentialStore.getProvider() });
        const cmd = new GetLogEventsCommand({
          logGroupName: logGroup,
          logStreamName: logStream,
          limit: parseInt(limit ?? '50', 10),
        });
        const response = await client.send(cmd);
        const lines = (response.events ?? []).map((e) => e.message ?? '').join('\n');
        return { ...base, status: 'ok', output: lines || '(no events)', durationMs: Date.now() - start };
      }

      case 'cloudwatch-alarm': {
        const { CloudWatchClient, DescribeAlarmsCommand } = await import('@aws-sdk/client-cloudwatch');
        const { alarmName } = block.config;
        if (!alarmName) throw new Error('alarmName is required');
        const client = new CloudWatchClient({ region, credentials: credentialStore.getProvider() });
        const cmd = new DescribeAlarmsCommand({ AlarmNames: [alarmName] });
        const response = await client.send(cmd);
        const alarm = response.MetricAlarms?.[0];
        const output = alarm
          ? `state=${alarm.StateValue} reason=${alarm.StateReason ?? 'n/a'}`
          : 'Alarm not found';
        return { ...base, status: 'ok', output, durationMs: Date.now() - start };
      }

      case 'sqs-peek': {
        const { SQSClient, GetQueueAttributesCommand } = await import('@aws-sdk/client-sqs');
        const { queueUrl } = block.config;
        if (!queueUrl) throw new Error('queueUrl is required');
        const client = new SQSClient({ region, credentials: credentialStore.getProvider() });
        const cmd = new GetQueueAttributesCommand({
          QueueUrl: queueUrl,
          AttributeNames: ['ApproximateNumberOfMessages'],
        });
        const response = await client.send(cmd);
        const depth = response.Attributes?.['ApproximateNumberOfMessages'] ?? 'unknown';
        return { ...base, status: 'ok', output: `ApproximateNumberOfMessages=${depth}`, durationMs: Date.now() - start };
      }

      case 'step-fn-start': {
        const { SFNClient, StartExecutionCommand } = await import('@aws-sdk/client-sfn');
        const { stateMachineArn, input } = block.config;
        if (!stateMachineArn) throw new Error('stateMachineArn is required');
        const client = new SFNClient({ region, credentials: credentialStore.getProvider() });
        const cmd = new StartExecutionCommand({
          stateMachineArn,
          input: input ?? '{}',
        });
        const response = await client.send(cmd);
        return { ...base, status: 'ok', output: `executionArn=${response.executionArn ?? 'unknown'}`, durationMs: Date.now() - start };
      }

      case 'github-workflow': {
        const { Octokit } = await import('@octokit/rest');
        const { owner, repo, workflow_id, ref, inputs } = block.config;
        if (!owner || !repo || !workflow_id) throw new Error('owner, repo, and workflow_id are required');
        const octokit = new Octokit({ auth: process.env['GITHUB_TOKEN'] });
        await octokit.actions.createWorkflowDispatch({
          owner,
          repo,
          workflow_id,
          ref: ref ?? 'main',
          inputs: inputs ? (JSON.parse(inputs) as Record<string, string>) : {},
        });
        return { ...base, status: 'ok', output: `Workflow ${workflow_id} dispatched on ${ref ?? 'main'}`, durationMs: Date.now() - start };
      }

      case 'http-call': {
        const { url, method, body, headers } = block.config;
        if (!url) throw new Error('url is required');
        const parsedHeaders = headers ? (JSON.parse(headers) as Record<string, string>) : undefined;
        const output = await httpRequest(url, method ?? 'GET', body || undefined, parsedHeaders);
        return { ...base, status: 'ok', output: output.slice(0, 1000), durationMs: Date.now() - start };
      }

      case 'delay': {
        const seconds = parseInt(block.config['seconds'] ?? '5', 10);
        await new Promise<void>((r) => setTimeout(r, seconds * 1000));
        return { ...base, status: 'ok', output: `Waited ${seconds} seconds`, durationMs: Date.now() - start };
      }

      default: {
        const exhaustiveCheck: never = block.type;
        throw new Error(`Unknown block type: ${String(exhaustiveCheck)}`);
      }
    }
  } catch (err) {
    return {
      ...base,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createRunbookRouter(
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
): Router {
  const router = Router();

  // GET / — list runbooks
  router.get('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const search = typeof req.query['search'] === 'string' ? req.query['search'].toLowerCase() : undefined;

      const items: RunbookListItem[] = [];
      let lastKey: Record<string, unknown> | undefined;
      do {
        const result = await dynamoClient.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeValues: { ':pk': 'RUNBOOK_LIST' },
            ScanIndexForward: false,
            ExclusiveStartKey: lastKey,
          }),
        );
        for (const item of (result.Items ?? []) as RunbookListItem[]) {
          items.push(item);
        }
        lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastKey);

      let filtered = items;
      if (search) {
        filtered = items.filter(
          (item) =>
            item.name.toLowerCase().includes(search) ||
            (item.description ?? '').toLowerCase().includes(search),
        );
      }

      res.json(filtered);
    } catch (err) {
      res.status(500).json(problemDetails(500, 'Internal Server Error', String(err)));
    }
  });

  // POST / — create runbook
  router.post('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body as {
        name?: string;
        description?: string;
        tags?: string[];
        blocks?: RunbookBlock[];
        ownerId?: string;
        ownerName?: string;
      };

      if (!body.name || !body.blocks || !body.ownerId || !body.ownerName) {
        res.status(400).json(problemDetails(400, 'Bad Request', 'name, blocks, ownerId, and ownerName are required'));
        return;
      }

      const now = new Date().toISOString();
      const id = randomUUID();

      const listItem: RunbookListItem = {
        PK: 'RUNBOOK_LIST',
        SK: `${now}#${id}`,
        id,
        name: body.name,
        description: body.description,
        tags: body.tags,
        blockCount: body.blocks.length,
        ownerId: body.ownerId,
        ownerName: body.ownerName,
        createdAt: now,
        updatedAt: now,
      };

      const detailItem: RunbookDetail = {
        PK: `RUNBOOK#${id}`,
        SK: 'METADATA',
        id,
        name: body.name,
        description: body.description,
        tags: body.tags,
        blocks: body.blocks,
        ownerId: body.ownerId,
        ownerName: body.ownerName,
        createdAt: now,
        updatedAt: now,
      };

      await Promise.all([
        dynamoClient.send(new PutCommand({ TableName: tableName, Item: listItem })),
        dynamoClient.send(new PutCommand({ TableName: tableName, Item: detailItem })),
      ]);

      res.status(201).json(detailItem);
    } catch (err) {
      res.status(500).json(problemDetails(500, 'Internal Server Error', String(err)));
    }
  });

  // GET /:id — get runbook detail
  router.get('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params as { id: string };

      const result = await dynamoClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: `RUNBOOK#${id}`, SK: 'METADATA' },
        }),
      );

      if (!result.Item) {
        res.status(404).json(problemDetails(404, 'Not Found', `Runbook ${id} not found`));
        return;
      }

      res.json(result.Item);
    } catch (err) {
      res.status(500).json(problemDetails(500, 'Internal Server Error', String(err)));
    }
  });

  // PUT /:id — update runbook
  router.put('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const body = req.body as {
        name?: string;
        description?: string;
        tags?: string[];
        blocks?: RunbookBlock[];
        updatedBy?: string;
        updatedByName?: string;
      };

      // Load existing detail to get old updatedAt and ownerId
      const existing = await dynamoClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: `RUNBOOK#${id}`, SK: 'METADATA' },
        }),
      );

      if (!existing.Item) {
        res.status(404).json(problemDetails(404, 'Not Found', `Runbook ${id} not found`));
        return;
      }

      const oldDetail = existing.Item as RunbookDetail;
      const oldUpdatedAt = oldDetail.updatedAt;
      const now = new Date().toISOString();

      const updatedDetail: RunbookDetail = {
        ...oldDetail,
        name: body.name ?? oldDetail.name,
        description: body.description ?? oldDetail.description,
        tags: body.tags ?? oldDetail.tags,
        blocks: body.blocks ?? oldDetail.blocks,
        updatedAt: now,
      };

      const newListItem: RunbookListItem = {
        PK: 'RUNBOOK_LIST',
        SK: `${now}#${id}`,
        id,
        name: updatedDetail.name,
        description: updatedDetail.description,
        tags: updatedDetail.tags,
        blockCount: updatedDetail.blocks.length,
        ownerId: updatedDetail.ownerId,
        ownerName: updatedDetail.ownerName,
        createdAt: updatedDetail.createdAt,
        updatedAt: now,
      };

      await Promise.all([
        // Delete old list item
        dynamoClient.send(
          new DeleteCommand({
            TableName: tableName,
            Key: { PK: 'RUNBOOK_LIST', SK: `${oldUpdatedAt}#${id}` },
          }),
        ),
        // Write new list item
        dynamoClient.send(new PutCommand({ TableName: tableName, Item: newListItem })),
        // Overwrite detail
        dynamoClient.send(new PutCommand({ TableName: tableName, Item: updatedDetail })),
      ]);

      res.json(updatedDetail);
    } catch (err) {
      res.status(500).json(problemDetails(500, 'Internal Server Error', String(err)));
    }
  });

  // DELETE /:id — delete runbook
  router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const body = req.body as { requesterId?: string };
      const requesterId = body.requesterId ?? 'anonymous';

      // Load detail to check ownership and get updatedAt for list SK
      const existing = await dynamoClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: `RUNBOOK#${id}`, SK: 'METADATA' },
        }),
      );

      if (!existing.Item) {
        res.status(404).json(problemDetails(404, 'Not Found', `Runbook ${id} not found`));
        return;
      }

      const detail = existing.Item as RunbookDetail;

      if (requesterId !== 'devops' && detail.ownerId !== requesterId) {
        res.status(403).json(problemDetails(403, 'Forbidden', 'You do not own this runbook'));
        return;
      }

      await Promise.all([
        dynamoClient.send(
          new DeleteCommand({
            TableName: tableName,
            Key: { PK: 'RUNBOOK_LIST', SK: `${detail.updatedAt}#${id}` },
          }),
        ),
        dynamoClient.send(
          new DeleteCommand({
            TableName: tableName,
            Key: { PK: `RUNBOOK#${id}`, SK: 'METADATA' },
          }),
        ),
      ]);

      res.status(204).send();
    } catch (err) {
      res.status(500).json(problemDetails(500, 'Internal Server Error', String(err)));
    }
  });

  // GET /:id/executions — list executions
  router.get('/:id/executions', async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params as { id: string };

      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: {
            ':pk': `RUNBOOK#${id}`,
            ':prefix': 'EXEC#',
          },
          ScanIndexForward: false,
          Limit: 20,
        }),
      );

      res.json(result.Items ?? []);
    } catch (err) {
      res.status(500).json(problemDetails(500, 'Internal Server Error', String(err)));
    }
  });

  // GET /:id/executions/:execId — get single execution
  router.get('/:id/executions/:execId', async (req: Request, res: Response): Promise<void> => {
    try {
      const { id, execId } = req.params as { id: string; execId: string };

      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          FilterExpression: 'execId = :execId',
          ExpressionAttributeValues: {
            ':pk': `RUNBOOK#${id}`,
            ':prefix': 'EXEC#',
            ':execId': execId,
          },
          Limit: 1,
        }),
      );

      const item = result.Items?.[0];
      if (!item) {
        res.status(404).json(problemDetails(404, 'Not Found', `Execution ${execId} not found`));
        return;
      }

      res.json(item);
    } catch (err) {
      res.status(500).json(problemDetails(500, 'Internal Server Error', String(err)));
    }
  });

  // POST /:id/execute — start execution
  router.post('/:id/execute', async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const body = req.body as { executedBy?: string; dryRun?: boolean };
      const executedBy = body.executedBy ?? 'anonymous';
      const dryRun = body.dryRun ?? false;

      // Load runbook detail
      const existing = await dynamoClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: `RUNBOOK#${id}`, SK: 'METADATA' },
        }),
      );

      if (!existing.Item) {
        res.status(404).json(problemDetails(404, 'Not Found', `Runbook ${id} not found`));
        return;
      }

      const detail = existing.Item as RunbookDetail;
      const execId = randomUUID();
      const startedAt = new Date().toISOString();
      const sk = `EXEC#${startedAt}#${execId}`;

      // Write initial execution record
      const initialRecord: ExecutionRecord = {
        PK: `RUNBOOK#${id}`,
        SK: sk,
        execId,
        runbookId: id,
        executedBy,
        startedAt,
        status: 'running',
        dryRun,
        stepResults: [],
      };

      await dynamoClient.send(new PutCommand({ TableName: tableName, Item: initialRecord }));

      // Respond immediately with 202
      res.status(202).json({ execId, runbookId: id, status: 'running', startedAt });

      // Run blocks asynchronously
      void (async () => {
        const stepResults: StepResult[] = [];
        let overallStatus: ExecutionStatus = 'completed';

        for (const block of detail.blocks) {
          const result = await executeBlock(block, dryRun);
          stepResults.push(result);
          if (result.status === 'error') {
            overallStatus = 'failed';
            break;
          }
        }

        const completedAt = new Date().toISOString();
        const finalRecord: ExecutionRecord = {
          ...initialRecord,
          stepResults,
          status: overallStatus,
          completedAt,
        };

        await dynamoClient.send(new PutCommand({ TableName: tableName, Item: finalRecord }));
      })();
    } catch (err) {
      res.status(500).json(problemDetails(500, 'Internal Server Error', String(err)));
    }
  });

  return router;
}
