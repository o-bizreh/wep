import { Router, type Request, type Response } from 'express';
import { withMcp, McpAuthRequiredError } from '../mcp/factory.js';
import { McpError } from '../mcp/client.js';

/**
 * REST proxy over the Washmen MCP. Every endpoint runs as the logged-in WEP
 * user (their session AWS credentials sign the MCP request). The browser never
 * speaks MCP directly — it calls these endpoints like any other WEP API.
 */

function handleError(res: Response, e: unknown): void {
  if (e instanceof McpAuthRequiredError) {
    res.status(401).json({ type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'Connect AWS to use MCP-backed data.' });
    return;
  }
  if (e instanceof McpError) {
    res.status(502).json({ type: 'about:blank', title: 'MCP Error', status: 502, detail: e.message, tool: e.tool });
    return;
  }
  res.status(500).json({ type: 'about:blank', title: 'Internal Error', status: 500, detail: e instanceof Error ? e.message : 'unknown' });
}

export function createMcpRouter(): Router {
  const router = Router();

  // ── Meta ──────────────────────────────────────────────────────────────────

  // Freshness-aware domain map — drives the "MCP source of truth" badge.
  router.get('/capability-map', async (req: Request, res: Response) => {
    try {
      const r = await withMcp(req, (c) => c.call('mcp.capability_map'));
      res.json(r.data);
    } catch (e) { handleError(res, e); }
  });

  router.get('/health', async (req: Request, res: Response) => {
    try {
      const r = await withMcp(req, (c) => c.call('mcp.health'));
      res.json(r.data);
    } catch (e) { handleError(res, e); }
  });

  // List every tool the MCP advertises (used by the agentic assistant in Phase 2).
  router.get('/tools', async (req: Request, res: Response) => {
    try {
      const tools = await withMcp(req, (c) => c.listTools());
      res.json({ tools });
    } catch (e) { handleError(res, e); }
  });

  // Generic escape hatch: invoke any tool. Body: { tool: string, args?: object }.
  router.post('/invoke', async (req: Request, res: Response) => {
    const { tool, args } = req.body as { tool?: string; args?: Record<string, unknown> };
    if (!tool) {
      res.status(400).json({ type: 'about:blank', title: 'Bad Request', status: 400, detail: 'tool is required' });
      return;
    }
    try {
      const r = await withMcp(req, (c) => c.call(tool, args ?? {}));
      res.json(r);
    } catch (e) { handleError(res, e); }
  });

  // Chain multiple tool calls in one MCP round-trip (see MCP `compose`).
  router.post('/compose', async (req: Request, res: Response) => {
    const { steps, on_error } = req.body as { steps?: unknown; on_error?: string };
    if (!Array.isArray(steps) || steps.length === 0) {
      res.status(400).json({ type: 'about:blank', title: 'Bad Request', status: 400, detail: 'steps[] is required' });
      return;
    }
    try {
      const r = await withMcp(req, (c) => c.call('compose', { steps, ...(on_error ? { on_error } : {}) }));
      res.json(r.data);
    } catch (e) { handleError(res, e); }
  });

  // ── Typed, UI-shaped endpoints ──────────────────────────────────────────────

  // Service Catalog
  router.get('/services', async (req: Request, res: Response) => {
    const { kind, name, limit, cursor } = req.query as Record<string, string>;
    try {
      const r = await withMcp(req, (c) => c.call('service.list', {
        ...(kind ? { kind } : {}),
        ...(name ? { name } : {}),
        ...(limit ? { limit: Number(limit) } : {}),
        ...(cursor ? { cursor } : {}),
      }));
      res.json({ ...(r.data as object), freshness: r.freshness });
    } catch (e) { handleError(res, e); }
  });

  router.get('/services/:name', async (req: Request, res: Response) => {
    try {
      const r = await withMcp(req, (c) => c.call('service.describe', { name: req.params.name }));
      res.json({ ...(r.data as object), freshness: r.freshness });
    } catch (e) { handleError(res, e); }
  });

  router.get('/services/:name/dependencies', async (req: Request, res: Response) => {
    try {
      const r = await withMcp(req, (c) => c.call('service.dependencies', { service: req.params.name }));
      res.json({ ...(r.data as object), freshness: r.freshness });
    } catch (e) { handleError(res, e); }
  });

  router.get('/services/:name/health', async (req: Request, res: Response) => {
    try {
      const r = await withMcp(req, (c) => c.call('obs.service_health', { service: req.params.name }));
      res.json({ ...(r.data as object), freshness: r.freshness });
    } catch (e) { handleError(res, e); }
  });

  // Deployments
  router.get('/deployments', async (req: Request, res: Response) => {
    const { hours, service } = req.query as Record<string, string>;
    try {
      const r = await withMcp(req, (c) => c.call('deploy.recent', {
        ...(hours ? { hours: Number(hours) } : { hours: 24 }),
        ...(service ? { service } : {}),
      }));
      res.json({ ...(r.data as object), freshness: r.freshness });
    } catch (e) { handleError(res, e); }
  });

  return router;
}
