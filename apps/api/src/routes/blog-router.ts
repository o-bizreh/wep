import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import {
  type DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  GetCommand,
  DeleteCommand,
  UpdateCommand,
} from '@wep/aws-clients';
import { getTableName } from '@wep/aws-clients';
import {
  WebClient,
  type HeaderBlock,
  type SectionBlock,
  type ActionsBlock,
  type ContextBlock,
  type KnownBlock,
} from '@slack/web-api';

// ─── Domain Types ─────────────────────────────────────────────────────────────

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  summary: string;
  content: string;
  author: string;
  authorName: string;
  tags: string[];
  coverImageUrl?: string;
  demoUrl?: string;
  status: 'draft' | 'published';
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  readingTimeMinutes: number;
  reactions: { likes: number };
}

interface DynamoBlogItem extends BlogPost {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function problemDetails(status: number, title: string, detail: string) {
  return { type: 'about:blank', title, status, detail };
}

function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function computeReadingTime(content: string): number {
  return Math.max(1, Math.ceil(content.split(/\s+/).length / 200));
}

function stripContent(post: DynamoBlogItem): Omit<BlogPost, 'content'> & { PK: string; SK: string; GSI1PK: string; GSI1SK: string } {
  const { content: _content, ...rest } = post;
  void _content;
  return rest;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export function createBlogRouter(dynamoClient: DynamoDBDocumentClient): Router {
  const router = Router();
  const table = getTableName('blog');
  const slackClient = new WebClient(process.env['SLACK_BOT_TOKEN'] ?? '');
  const FRONTEND_URL = process.env['FRONTEND_URL'] ?? 'http://localhost:5173';
  const SLACK_CHANNEL = '#wtm-engineering-team';

  // GET /posts — list published posts, optionally filtered by ?tag=
  router.get('/posts', async (req: Request, res: Response) => {
    const { tag } = req.query;

    const allItems: DynamoBlogItem[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': 'POST' },
          ScanIndexForward: false,
          ExclusiveStartKey: lastKey,
        }),
      );
      for (const item of (result.Items ?? []) as DynamoBlogItem[]) {
        allItems.push(item);
      }
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    let items = allItems;
    if (typeof tag === 'string' && tag) {
      items = items.filter((i) => i.tags.includes(tag));
    }

    res.json(items.map(stripContent));
  });

  // GET /posts/:slug — get single post by slug with full content
  router.get('/posts/:slug', async (req: Request<{ slug: string }>, res: Response) => {
    const { slug } = req.params;

    // Scan published posts for matching slug (slug is not the key, so we query POST partition)
    const allItems: DynamoBlogItem[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': 'POST' },
          ScanIndexForward: false,
          ExclusiveStartKey: lastKey,
        }),
      );
      for (const item of (result.Items ?? []) as DynamoBlogItem[]) {
        allItems.push(item);
      }
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    // Also search drafts in case it's being previewed
    let draftLastKey: Record<string, unknown> | undefined;
    do {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': 'DRAFT' },
          ScanIndexForward: false,
          ExclusiveStartKey: draftLastKey,
        }),
      );
      for (const item of (result.Items ?? []) as DynamoBlogItem[]) {
        allItems.push(item);
      }
      draftLastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (draftLastKey);

    const post = allItems.find((i) => i.slug === slug);
    if (!post) {
      res.status(404).json(problemDetails(404, 'Not Found', `Post with slug "${slug}" not found`));
      return;
    }

    res.json(post);
  });

  // GET /drafts — list drafts
  router.get('/drafts', async (_req: Request, res: Response) => {
    const allItems: DynamoBlogItem[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': 'DRAFT' },
          ScanIndexForward: false,
          ExclusiveStartKey: lastKey,
        }),
      );
      for (const item of (result.Items ?? []) as DynamoBlogItem[]) {
        allItems.push(item);
      }
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    res.json(allItems.map(stripContent));
  });

  // POST /posts — create a post as draft
  router.post('/posts', async (req: Request, res: Response) => {
    const body = req.body as {
      title?: string;
      summary?: string;
      content?: string;
      author?: string;
      authorName?: string;
      tags?: string[];
      coverImageUrl?: string;
      demoUrl?: string;
    };

    if (!body.title || !body.summary || !body.content || !body.author || !body.authorName) {
      res.status(400).json(problemDetails(400, 'Bad Request', 'title, summary, content, author, and authorName are required'));
      return;
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const slug = toSlug(body.title);
    const readingTimeMinutes = computeReadingTime(body.content);

    const post: BlogPost = {
      id,
      title: body.title,
      slug,
      summary: body.summary,
      content: body.content,
      author: body.author,
      authorName: body.authorName,
      tags: body.tags ?? [],
      coverImageUrl: body.coverImageUrl,
      demoUrl: body.demoUrl,
      status: 'draft',
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
      readingTimeMinutes,
      reactions: { likes: 0 },
    };

    const sk = `DRAFT#${now}#${id}`;
    const item: DynamoBlogItem = {
      ...post,
      PK: 'DRAFT',
      SK: sk,
      GSI1PK: `AUTHOR#${body.author}`,
      GSI1SK: sk,
    };

    await dynamoClient.send(new PutCommand({ TableName: table, Item: item }));
    res.status(201).json(post);
  });

  // PUT /posts/:id — update a post
  router.put('/posts/:id', async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;
    const body = req.body as {
      title?: string;
      summary?: string;
      content?: string;
      tags?: string[];
      coverImageUrl?: string;
      demoUrl?: string;
    };

    // Find the post in both partitions
    const item = await findPostById(dynamoClient, table, id);
    if (!item) {
      res.status(404).json(problemDetails(404, 'Not Found', `Post ${id} not found`));
      return;
    }

    const now = new Date().toISOString();
    const updatedTitle = body.title ?? item.title;
    const updatedContent = body.content ?? item.content;

    const updated: DynamoBlogItem = {
      ...item,
      title: updatedTitle,
      slug: body.title ? toSlug(updatedTitle) : item.slug,
      summary: body.summary ?? item.summary,
      content: updatedContent,
      tags: body.tags ?? item.tags,
      coverImageUrl: body.coverImageUrl !== undefined ? body.coverImageUrl : item.coverImageUrl,
      demoUrl: body.demoUrl !== undefined ? body.demoUrl : item.demoUrl,
      readingTimeMinutes: body.content ? computeReadingTime(updatedContent) : item.readingTimeMinutes,
      updatedAt: now,
    };

    await dynamoClient.send(new PutCommand({ TableName: table, Item: updated }));
    res.json(updated);
  });

  // POST /posts/:id/publish — publish a draft
  router.post('/posts/:id/publish', async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;

    const item = await findPostById(dynamoClient, table, id);
    if (!item) {
      res.status(404).json(problemDetails(404, 'Not Found', `Post ${id} not found`));
      return;
    }

    if (item.status === 'published') {
      res.status(400).json(problemDetails(400, 'Bad Request', 'Post is already published'));
      return;
    }

    const now = new Date().toISOString();
    const newSK = `POST#${now}#${id}`;

    const publishedItem: DynamoBlogItem = {
      ...item,
      status: 'published',
      publishedAt: now,
      updatedAt: now,
      PK: 'POST',
      SK: newSK,
      GSI1PK: `AUTHOR#${item.author}`,
      GSI1SK: newSK,
    };

    // Delete old draft item and put new published item
    await dynamoClient.send(new DeleteCommand({ TableName: table, Key: { PK: item.PK, SK: item.SK } }));
    await dynamoClient.send(new PutCommand({ TableName: table, Item: publishedItem }));

    // Post to Slack (fire and forget on failure)
    try {
      const headerBlock: HeaderBlock = {
        type: 'header',
        text: { type: 'plain_text', text: `✍️ New Engineering Post: ${item.title}`, emoji: true },
      };
      const summaryBlock: SectionBlock = {
        type: 'section',
        text: { type: 'mrkdwn', text: item.summary },
      };
      const fieldsBlock: SectionBlock = {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Author*\n${item.authorName}` },
          { type: 'mrkdwn', text: `*Reading Time*\n${item.readingTimeMinutes} min` },
          { type: 'mrkdwn', text: `*Tags*\n${item.tags.join(', ') || 'none'}` },
        ],
      };
      const contextBlock: ContextBlock = {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Read on WEP → ${FRONTEND_URL}/blog/${publishedItem.slug}`,
          },
        ],
      };

      const blocks: KnownBlock[] = [headerBlock, summaryBlock, fieldsBlock];

      if (item.demoUrl) {
        const actionsBlock: ActionsBlock = {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'View Demo →', emoji: true },
              url: item.demoUrl,
              action_id: 'view_demo',
            },
          ],
        };
        blocks.push(actionsBlock);
      }

      blocks.push(contextBlock);

      await slackClient.chat.postMessage({
        channel: SLACK_CHANNEL,
        blocks,
        text: `New engineering post: ${item.title}`,
      });
    } catch (slackErr) {
      console.error('[blog-router] Slack notification failed:', slackErr);
    }

    const { PK: _pk, SK: _sk, GSI1PK: _g1pk, GSI1SK: _g1sk, ...postWithoutKeys } = publishedItem;
    void _pk; void _sk; void _g1pk; void _g1sk;
    res.json(postWithoutKeys);
  });

  // POST /posts/:id/react — increment likes
  router.post('/posts/:id/react', async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;

    const item = await findPostById(dynamoClient, table, id);
    if (!item) {
      res.status(404).json(problemDetails(404, 'Not Found', `Post ${id} not found`));
      return;
    }

    await dynamoClient.send(
      new UpdateCommand({
        TableName: table,
        Key: { PK: item.PK, SK: item.SK },
        UpdateExpression: 'ADD reactions.likes :one',
        ExpressionAttributeValues: { ':one': 1 },
      }),
    );

    res.json({ ok: true });
  });

  // POST /seed — insert a demo post (dev/staging only, idempotent by slug)
  router.post('/seed', async (_req: Request, res: Response) => {
    const DEMO_SLUG = 'how-we-cut-build-times-by-60-percent';

    // Check if already exists
    const existing: DynamoBlogItem[] = [];
    let lk: Record<string, unknown> | undefined;
    do {
      const r = await dynamoClient.send(new QueryCommand({ TableName: table, KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': 'POST' }, ScanIndexForward: false, ExclusiveStartKey: lk }));
      (r.Items ?? []).forEach((i) => existing.push(i as DynamoBlogItem));
      lk = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lk);

    if (existing.find((i) => i.slug === DEMO_SLUG)) {
      res.json({ ok: true, message: 'Demo post already exists' });
      return;
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const content = `## The Problem

Our monorepo had grown to 40+ packages and our CI builds were taking **18–22 minutes** on every pull request. Engineers were context-switching constantly while waiting, and slow feedback loops were killing our flow state.

We dug into the data and found three culprits:

- Unnecessary full rebuilds even for unrelated changes
- No caching of \`node_modules\` between runs
- Type-checking every package on every run regardless of what changed

## What We Did

### 1. Turborepo Remote Caching

We enabled Turborepo's remote cache backed by S3. The first build primes the cache; subsequent runs for the same input hash are instant.

\`\`\`yaml
# .github/workflows/ci.yml
- name: Build
  run: pnpm turbo build --cache-dir=.turbo
  env:
    TURBO_TOKEN: \${{ secrets.TURBO_TOKEN }}
    TURBO_TEAM: washmen
\`\`\`

This alone cut **6 minutes** off average build time by skipping unchanged packages.

### 2. Dependency-aware Type Checking

Instead of running \`tsc\` on the whole repo, we now only type-check packages whose source files changed — determined by comparing the git diff against Turborepo's dependency graph.

### 3. pnpm Store Caching

We started caching the pnpm store between runs using GitHub Actions' \`cache\` action keyed on \`pnpm-lock.yaml\`. Installing dependencies dropped from 3 minutes to under 30 seconds on cache hits.

\`\`\`yaml
- uses: actions/cache@v4
  with:
    path: ~/.pnpm-store
    key: pnpm-\${{ hashFiles('pnpm-lock.yaml') }}
\`\`\`

## Results

| Metric | Before | After |
|--------|--------|-------|
| Average CI time | 21 min | 8 min |
| Cache hit rate | 0% | 74% |
| TypeCheck time | 6 min | 1.5 min |

> "The moment we saw green in under 10 minutes, the whole team's energy shifted. PRs started moving faster the same day." — Backend Lead

## What's Next

We're evaluating splitting the monorepo's test suite into sharded matrix jobs. Early tests suggest we can get the full suite under 5 minutes. Stay tuned.`;

    const post: BlogPost = {
      id,
      title: 'How We Cut Build Times by 60%',
      slug: DEMO_SLUG,
      summary: 'Our CI pipeline was taking 20+ minutes. Here\'s the three-step approach we used with Turborepo, pnpm caching, and dependency-aware type checking to bring it down to under 8 minutes.',
      content,
      author: 'omar.bizreh',
      authorName: 'Omar Bizreh',
      tags: ['devops', 'ci-cd', 'turborepo', 'dx'],
      status: 'published',
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
      readingTimeMinutes: computeReadingTime(content),
      reactions: { likes: 7 },
    };

    const sk = `POST#${now}#${id}`;
    await dynamoClient.send(new PutCommand({
      TableName: table,
      Item: { ...post, PK: 'POST', SK: sk, GSI1PK: `AUTHOR#${post.author}`, GSI1SK: sk },
    }));

    res.status(201).json({ ok: true, slug: DEMO_SLUG });
  });

  // DELETE /posts/:id — delete a post
  router.delete('/posts/:id', async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;

    const item = await findPostById(dynamoClient, table, id);
    if (!item) {
      res.status(404).json(problemDetails(404, 'Not Found', `Post ${id} not found`));
      return;
    }

    await dynamoClient.send(new DeleteCommand({ TableName: table, Key: { PK: item.PK, SK: item.SK } }));
    res.status(204).send();
  });

  return router;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function findPostById(
  dynamoClient: DynamoDBDocumentClient,
  table: string,
  id: string,
): Promise<DynamoBlogItem | null> {
  for (const pk of ['POST', 'DRAFT']) {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': pk, ':prefix': `${pk}#` },
      }),
    );
    const found = (result.Items ?? []).find((item) => (item as { id: string }).id === id);
    if (found) return found as DynamoBlogItem;
  }
  return null;
}
