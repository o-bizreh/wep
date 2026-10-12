/**
 * Washmen MCP client for the WEP API.
 *
 * Ported from the washmen-mcp repo's published client (src/client/index.ts).
 * Speaks JSON-RPC over HTTPS to the MCP's Streamable-HTTP endpoint and signs
 * every request with SigV4 (service: execute-api) using the AWS credentials of
 * the calling WEP user — taken from their server-side session.
 *
 * The MCP authorises callers by their resolved IAM identity, so each WEP user's
 * session credentials become their identity against the MCP. No separate OAuth.
 *
 * Tool names are advertised with underscores ("service_list") but documented
 * with dots ("service.list"); call() accepts either and normalises.
 */

import { SignatureV4 } from '@smithy/signature-v4';
import { Hash } from '@smithy/hash-node';
import type { AwsCredentialIdentity } from '@smithy/types';

export interface McpToolResult<T = unknown> {
  data: T;
  freshness?: { source: string; as_of: string };
  meta?: { latency_ms: number; cache_hit: boolean; output_bytes: number };
  warning?: string;
}

export interface WashmenMcpClientOptions {
  /** MCP endpoint base (without the trailing /mcp). */
  endpoint: string;
  /** AWS region for SigV4 signing. */
  region: string;
  /** The calling user's AWS credentials (from their WEP session). */
  credentials: AwsCredentialIdentity;
  /** Request timeout (ms). Defaults to 30000. */
  timeoutMs?: number;
}

export class McpError extends Error {
  constructor(message: string, public readonly status?: number, public readonly tool?: string) {
    super(message);
    this.name = 'McpError';
  }
}

export class WashmenMcpClient {
  private readonly endpoint: string;
  private readonly region: string;
  private readonly credentials: AwsCredentialIdentity;
  private readonly timeoutMs: number;
  private sessionId: string | null = null;
  private requestId = 0;

  constructor(opts: WashmenMcpClientOptions) {
    this.endpoint = opts.endpoint.replace(/\/$/, '');
    this.region = opts.region;
    this.credentials = opts.credentials;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  /** Call a tool by name. Accepts dot- or underscore-named tools. */
  async call<T = unknown>(toolName: string, args: Record<string, unknown> = {}): Promise<McpToolResult<T>> {
    await this.ensureSession();
    const result = await this.rpc('tools/call', {
      name: toolName.replace(/\./g, '_'),
      arguments: args,
    });
    if (result['isError']) {
      const msg = (result['content'] as Array<{ type: string; text: string }>)?.[0]?.text ?? 'tool error';
      throw new McpError(msg, undefined, toolName);
    }
    const text = (result['content'] as Array<{ type: string; text: string }>)?.[0]?.text ?? '{}';
    return JSON.parse(text) as McpToolResult<T>;
  }

  /** List every tool the MCP advertises (name + description). */
  async listTools(): Promise<Array<{ name: string; description: string; inputSchema?: unknown }>> {
    await this.ensureSession();
    const result = await this.rpc('tools/list', {});
    return (result['tools'] ?? []) as Array<{ name: string; description: string; inputSchema?: unknown }>;
  }

  /** Release the MCP session. Best-effort. */
  async close(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await this.signedRequest('DELETE', '/mcp', null, this.sessionId);
    } catch { /* best effort */ }
    this.sessionId = null;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private async ensureSession(): Promise<void> {
    if (this.sessionId) return;
    const res = await this.signedRequest('POST', '/mcp', {
      jsonrpc: '2.0',
      id: ++this.requestId,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'wep-api', version: '1.0.0' },
        capabilities: {},
      },
    }, null);
    this.sessionId = res.headers.get('mcp-session-id');
    if (!this.sessionId) throw new McpError('MCP server did not return a session ID on initialize');
  }

  private async rpc(method: string, params: unknown): Promise<Record<string, unknown>> {
    const body = { jsonrpc: '2.0', id: ++this.requestId, method, params };
    const res = await this.signedRequest('POST', '/mcp', body, this.sessionId);
    const json = await res.json() as { result?: Record<string, unknown>; error?: { message: string } };
    if (json.error) throw new McpError(json.error.message);
    return json.result ?? {};
  }

  private async signedRequest(
    method: string,
    path: string,
    body: unknown,
    sessionId: string | null,
  ): Promise<Response> {
    const url = `${this.endpoint}${path}`;
    const bodyStr = body !== null ? JSON.stringify(body) : undefined;
    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    };
    if (sessionId) baseHeaders['mcp-session-id'] = sessionId;

    const signer = new SignatureV4({
      credentials: this.credentials,
      region: this.region,
      service: 'execute-api',
      sha256: Hash.bind(null, 'sha256'),
    });

    const parsedUrl = new URL(url);
    const signed = await signer.sign({
      method,
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      protocol: 'https:',
      headers: {
        ...baseHeaders,
        host: parsedUrl.hostname,
        ...(bodyStr ? { 'content-length': String(Buffer.byteLength(bodyStr)) } : {}),
      },
      body: bodyStr ?? '',
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: signed.headers as Record<string, string>,
        body: bodyStr,
        signal: controller.signal,
      });
      if (!response.ok && response.status !== 404) {
        const text = await response.text().catch(() => '');
        throw new McpError(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 200)}`, response.status);
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }
}
