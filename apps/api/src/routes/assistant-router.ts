import { Router, type Request, type Response } from 'express';
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type BedrockMessage,
  type BedrockTool,
  type ContentBlock,
} from '@wep/aws-clients';
import { credentialsFromRequest } from '../plugins/identity.js';

const MODEL_ID = 'amazon.nova-micro-v1:0';
const BEDROCK_REGION = 'us-east-1';

const SYSTEM_PROMPT = `You are the WEP (Washmen Engineering Platform) assistant. You have access to real-time data from Washmen's engineering infrastructure.

Answer questions concisely and directly. When you get tool results, synthesize them into a plain-English answer — no need to repeat raw JSON. Use numbers, percentages, and service names where helpful. If something isn't available, say so briefly.

Do not make up data. Only use what the tools return.`;

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS: BedrockTool[] = [
  {
    toolSpec: {
      name: 'get_cost_overview',
      description: 'Get AWS cost overview: current month total, last month comparison, cost by service, and daily trend.',
      inputSchema: { json: { type: 'object', properties: {}, required: [] } },
    },
  },
  {
    toolSpec: {
      name: 'get_deployment_feed',
      description: 'Get recent deployment activity across all services. Can filter by environment (production or development).',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            environment: { type: 'string', enum: ['production', 'development'], description: 'Filter by environment' },
            page: { type: 'number', description: 'Page number, default 1' },
          },
          required: [],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'get_velocity_metrics',
      description: 'Get DORA metrics and deployment velocity for the engineering org: deployment frequency, change failure rate, lead time, MTTR.',
      inputSchema: { json: { type: 'object', properties: {}, required: [] } },
    },
  },
  {
    toolSpec: {
      name: 'get_errors_overview',
      description: 'Get error counts across AWS services (Lambda, ALB, DynamoDB, SQS, etc.) for the last 24h or 7 days.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            window: { type: 'string', enum: ['24h', '7d'], description: 'Time window, default 24h' },
          },
          required: [],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'get_services',
      description: 'Search or list services in the service catalog. Returns service names, owner teams, runtime types, and environments.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query to filter services' },
          },
          required: [],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'get_infra_resources',
      description: 'Get live infrastructure resources: ECS services, Lambda functions, RDS instances with their status.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            environment: { type: 'string', description: 'Filter by environment tag (prod, dev, staging)' },
          },
          required: [],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'get_active_portal_requests',
      description: 'Get pending or recent portal/Act requests (JIT access, AWS actions). Shows who requested what and current status.',
      inputSchema: { json: { type: 'object', properties: {}, required: [] } },
    },
  },
];

// ── Internal API caller ───────────────────────────────────────────────────────

async function callInternalApi(
  toolName: string,
  input: Record<string, unknown>,
  req: Request,
): Promise<unknown> {
  const baseUrl = `http://localhost:${process.env['PORT'] ?? 3001}/api/v1`;
  const sessionCookie = req.headers.cookie ?? '';

  const get = async (path: string) => {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { Cookie: sessionCookie, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return { error: `${res.status} ${res.statusText}` };
    return res.json();
  };

  switch (toolName) {
    case 'get_cost_overview':
      return get('/costs/overview');

    case 'get_deployment_feed': {
      const params = new URLSearchParams();
      if (input.environment) params.set('environment', String(input.environment));
      if (input.page) params.set('page', String(input.page));
      const data = await get(`/catalog/deployments/feed?${params}`) as any;
      // Trim to last 20 items to keep context small
      if (data?.items) data.items = data.items.slice(0, 20);
      return data;
    }

    case 'get_velocity_metrics':
      return get('/catalog/deployments/velocity');

    case 'get_errors_overview': {
      const window = (input.window as string) ?? '24h';
      const categories = await get('/errors') as any;
      if (!categories?.categories) return categories;
      const results = await Promise.all(
        (categories.categories as Array<{ category: string }>).map((c) =>
          get(`/errors/${c.category}?window=${window}`).then((r: any) => ({
            category: r.category,
            label: r.label,
            totalErrors: r.totalErrors,
          })),
        ),
      );
      return { window, categories: results };
    }

    case 'get_services': {
      const params = new URLSearchParams();
      if (input.query) params.set('q', String(input.query));
      const data = await get(`/catalog/services?${params}`) as any;
      if (data?.items) data.items = data.items.slice(0, 30);
      return data;
    }

    case 'get_infra_resources': {
      const params = new URLSearchParams();
      if (input.environment) params.set('environment', String(input.environment));
      return get(`/aws-resources/infra/resources?${params}`);
    }

    case 'get_active_portal_requests':
      return get('/portal/requests?status=pending&limit=20');

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export function createAssistantRouter(): Router {
  const router = Router();

  router.post('/chat', async (req: Request, res: Response) => {
    const { message, history = [] } = req.body as {
      message: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    };

    if (!message?.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const creds = credentialsFromRequest(req);
    if (!creds) {
      res.status(401).json({ error: 'Not authenticated — connect AWS in Settings first' });
      return;
    }

    const bedrock = new BedrockRuntimeClient({
      region: BEDROCK_REGION,
      credentials: creds,
    });

    // Build message history for multi-turn context
    const messages: BedrockMessage[] = [
      ...history.map((h) => ({
        role: h.role,
        content: [{ text: h.content }] as ContentBlock[],
      })),
      { role: 'user', content: [{ text: message }] },
    ];

    const toolsUsed: string[] = [];

    try {
      // Agentic loop — keep going until Nova stops calling tools
      let iterations = 0;
      const MAX_ITERATIONS = 5;

      while (iterations < MAX_ITERATIONS) {
        iterations++;

        const response = await bedrock.send(new ConverseCommand({
          modelId: MODEL_ID,
          system: [{ text: SYSTEM_PROMPT }],
          messages,
          toolConfig: { tools: TOOLS },
          inferenceConfig: { maxTokens: 1024, temperature: 0.2 },
        }));

        const stopReason = response.stopReason;
        const outputMsg = response.output?.message;
        if (!outputMsg) break;

        messages.push(outputMsg);

        if (stopReason === 'end_turn') {
          // Final answer — extract text
          const text = outputMsg.content
            ?.filter((b): b is { text: string } => 'text' in b && typeof (b as any).text === 'string')
            .map((b) => b.text)
            .join('') ?? '';

          res.json({ answer: text, toolsUsed });
          return;
        }

        if (stopReason === 'tool_use') {
          // Extract tool use blocks from the response
          const toolUseBlocks = (outputMsg.content ?? [])
            .map((b) => (b as any).toolUse as { toolUseId: string; name: string; input: Record<string, unknown> } | undefined)
            .filter((tu): tu is { toolUseId: string; name: string; input: Record<string, unknown> } => !!tu?.toolUseId);

          const toolResults = await Promise.all(
            toolUseBlocks.map(async ({ toolUseId, name, input }) => {
              if (!toolsUsed.includes(name)) toolsUsed.push(name);
              try {
                const result = await callInternalApi(name, input, req);
                return { toolResult: { toolUseId, content: [{ json: result }] } };
              } catch (e) {
                return {
                  toolResult: {
                    toolUseId,
                    content: [{ text: e instanceof Error ? e.message : 'Tool call failed' }],
                    status: 'error' as const,
                  },
                };
              }
            }),
          );

          messages.push({ role: 'user', content: toolResults as any });
          continue;
        }

        // Unexpected stop reason
        break;
      }

      res.status(500).json({ error: 'Assistant did not produce a final answer' });
    } catch (e) {
      console.error('[assistant] error:', e);
      const msg = e instanceof Error ? e.message : 'Unknown error';
      if (msg.includes('AccessDenied') || msg.includes('is not authorized')) {
        res.status(403).json({ error: 'AWS credentials do not have Bedrock access. Ensure your IAM role includes `bedrock:InvokeModel`.' });
      } else {
        res.status(500).json({ error: msg });
      }
    }
  });

  return router;
}
