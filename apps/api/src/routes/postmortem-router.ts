import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  DeleteCommand,
  getTableName,
} from '@wep/aws-clients';
import { problemDetails } from '@wep/domain-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TimelineEntry {
  time: string;
  event: string;
  author?: string;
}

export interface ActionItem {
  id: string;
  description: string;
  owner: string;
  dueDate: string;
  status: 'open' | 'in_progress' | 'done';
}

export interface Postmortem {
  PK: 'POSTMORTEM';
  SK: string; // PM#<createdAt>#<id>
  id: string;
  incidentId?: string;
  title: string;
  severity: 'p1' | 'p2' | 'p3';
  status: 'draft' | 'in_review' | 'published';
  incidentDate: string;
  detectedAt: string;
  resolvedAt: string;
  duration: number;
  affectedServices: string[];
  summary: string;
  timeline: TimelineEntry[];
  rootCause: string;
  contributingFactors: string[];
  impact: string;
  actionItems: ActionItem[];
  author: string;
  authorName: string;
  reviewers: string[];
  createdAt: string;
  updatedAt: string;
}

type PostmortemInput = Omit<Postmortem, 'PK' | 'SK' | 'id' | 'status' | 'createdAt' | 'updatedAt'>;

const REQUIRED_FIELDS: (keyof PostmortemInput)[] = [
  'title',
  'severity',
  'incidentDate',
  'detectedAt',
  'resolvedAt',
  'author',
  'authorName',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findById(
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
  id: string,
): Promise<Postmortem | null> {
  // Query for the item whose SK begins with PM# and contains the id
  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      FilterExpression: 'id = :id',
      ExpressionAttributeValues: {
        ':pk': 'POSTMORTEM',
        ':prefix': 'PM#',
        ':id': id,
      },
      Limit: 1,
    }),
  );

  const item = result.Items?.[0];
  return item ? (item as Postmortem) : null;
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createPostmortemRouter(dynamoClient: DynamoDBDocumentClient): Router {
  const router = Router();
  const tableName = getTableName('postmortems');

  // GET / — list all postmortems (most recent first)
  router.get('/', async (_req: Request, res: Response): Promise<void> => {
    try {
      const items: Postmortem[] = [];
      let lastKey: Record<string, unknown> | undefined;

      do {
        const result = await dynamoClient.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeValues: { ':pk': 'POSTMORTEM' },
            ScanIndexForward: false,
            ExclusiveStartKey: lastKey,
          }),
        );

        for (const item of (result.Items ?? []) as Postmortem[]) {
          items.push(item);
        }

        lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastKey);

      res.json(items);
    } catch (err) {
      res.status(500).json(problemDetails(500, 'Internal Server Error', String(err)));
    }
  });

  // GET /:id — get single postmortem
  router.get('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const item = await findById(dynamoClient, tableName, id);

      if (!item) {
        res.status(404).json(problemDetails(404, 'Not Found', `Postmortem ${id} not found`));
        return;
      }

      res.json(item);
    } catch (err) {
      res.status(500).json(problemDetails(500, 'Internal Server Error', String(err)));
    }
  });

  // POST / — create postmortem
  router.post('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body as Partial<PostmortemInput>;

      const missingFields = REQUIRED_FIELDS.filter((f) => !body[f]);
      if (missingFields.length > 0) {
        res.status(400).json(
          problemDetails(400, 'Bad Request', `Missing required fields: ${missingFields.join(', ')}`),
        );
        return;
      }

      const now = new Date().toISOString();
      const id = randomUUID();

      const postmortem: Postmortem = {
        PK: 'POSTMORTEM',
        SK: `PM#${now}#${id}`,
        id,
        incidentId: body.incidentId,
        title: body.title!,
        severity: body.severity!,
        status: 'draft',
        incidentDate: body.incidentDate!,
        detectedAt: body.detectedAt!,
        resolvedAt: body.resolvedAt!,
        duration: body.duration ?? 0,
        affectedServices: body.affectedServices ?? [],
        summary: body.summary ?? '',
        timeline: body.timeline ?? [],
        rootCause: body.rootCause ?? '',
        contributingFactors: body.contributingFactors ?? [],
        impact: body.impact ?? '',
        actionItems: body.actionItems ?? [],
        author: body.author!,
        authorName: body.authorName!,
        reviewers: body.reviewers ?? [],
        createdAt: now,
        updatedAt: now,
      };

      await dynamoClient.send(new PutCommand({ TableName: tableName, Item: postmortem }));

      res.status(201).json(postmortem);
    } catch (err) {
      res.status(500).json(problemDetails(500, 'Internal Server Error', String(err)));
    }
  });

  // PUT /:id — update postmortem fields
  router.put('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const body = req.body as Partial<Omit<Postmortem, 'PK' | 'SK' | 'id' | 'createdAt'>>;

      const existing = await findById(dynamoClient, tableName, id);
      if (!existing) {
        res.status(404).json(problemDetails(404, 'Not Found', `Postmortem ${id} not found`));
        return;
      }

      const now = new Date().toISOString();
      const updated: Postmortem = {
        ...existing,
        ...body,
        PK: 'POSTMORTEM',
        SK: existing.SK,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: now,
      };

      await dynamoClient.send(new PutCommand({ TableName: tableName, Item: updated }));

      res.json(updated);
    } catch (err) {
      res.status(500).json(problemDetails(500, 'Internal Server Error', String(err)));
    }
  });

  // POST /:id/publish — publish postmortem
  router.post('/:id/publish', async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params as { id: string };

      const existing = await findById(dynamoClient, tableName, id);
      if (!existing) {
        res.status(404).json(problemDetails(404, 'Not Found', `Postmortem ${id} not found`));
        return;
      }

      const now = new Date().toISOString();
      const updated: Postmortem = { ...existing, status: 'published', updatedAt: now };

      await dynamoClient.send(new PutCommand({ TableName: tableName, Item: updated }));

      res.json(updated);
    } catch (err) {
      res.status(500).json(problemDetails(500, 'Internal Server Error', String(err)));
    }
  });

  // PATCH /:id/action-items/:actionId — update a single action item status
  router.patch('/:id/action-items/:actionId', async (req: Request, res: Response): Promise<void> => {
    try {
      const { id, actionId } = req.params as { id: string; actionId: string };
      const body = req.body as { status?: ActionItem['status'] };

      if (!body.status) {
        res.status(400).json(problemDetails(400, 'Bad Request', 'status is required'));
        return;
      }

      const existing = await findById(dynamoClient, tableName, id);
      if (!existing) {
        res.status(404).json(problemDetails(404, 'Not Found', `Postmortem ${id} not found`));
        return;
      }

      const actionIndex = existing.actionItems.findIndex((a) => a.id === actionId);
      if (actionIndex === -1) {
        res.status(404).json(problemDetails(404, 'Not Found', `Action item ${actionId} not found`));
        return;
      }

      const updatedActionItems = existing.actionItems.map((a) =>
        a.id === actionId ? { ...a, status: body.status! } : a,
      );

      const now = new Date().toISOString();
      const updated: Postmortem = { ...existing, actionItems: updatedActionItems, updatedAt: now };

      await dynamoClient.send(new PutCommand({ TableName: tableName, Item: updated }));

      res.json(updated);
    } catch (err) {
      res.status(500).json(problemDetails(500, 'Internal Server Error', String(err)));
    }
  });

  // DELETE /:id — delete postmortem
  router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params as { id: string };

      const existing = await findById(dynamoClient, tableName, id);
      if (!existing) {
        res.status(404).json(problemDetails(404, 'Not Found', `Postmortem ${id} not found`));
        return;
      }

      await dynamoClient.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { PK: 'POSTMORTEM', SK: existing.SK },
        }),
      );

      res.status(204).send();
    } catch (err) {
      res.status(500).json(problemDetails(500, 'Internal Server Error', String(err)));
    }
  });

  return router;
}
