/**
 * Builds a per-request WashmenMcpClient authenticated as the calling WEP user.
 *
 * The MCP endpoint base is taken from WASHMEN_MCP_ENDPOINT (e.g.
 * https://mcp.washmen.com). Credentials come from the user's session via
 * credentialsFromRequest — so MCP calls carry the logged-in user's identity.
 */

import type { Request } from 'express';
import { credentialsFromRequest } from '../plugins/identity.js';
import { WashmenMcpClient, McpError } from './client.js';

const MCP_ENDPOINT = process.env['WASHMEN_MCP_ENDPOINT'] ?? 'https://mcp.washmen.com';
const MCP_REGION = process.env['WASHMEN_MCP_REGION'] ?? process.env['AWS_REGION'] ?? 'eu-west-1';

export class McpAuthRequiredError extends Error {
  constructor() {
    super('AWS session required to call the Washmen MCP');
    this.name = 'McpAuthRequiredError';
  }
}

/** Create an MCP client for this request, or throw McpAuthRequiredError if unauthenticated. */
export function mcpClientForRequest(req: Request): WashmenMcpClient {
  const creds = credentialsFromRequest(req);
  if (!creds) throw new McpAuthRequiredError();
  return new WashmenMcpClient({
    endpoint: MCP_ENDPOINT,
    region: MCP_REGION,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      ...(creds.sessionToken ? { sessionToken: creds.sessionToken } : {}),
    },
  });
}

/**
 * Run a function with an MCP client and guarantee the session is released.
 * Reusing one client across multiple tool calls in a single request avoids
 * paying the initialize round-trip more than once.
 */
export async function withMcp<T>(req: Request, fn: (client: WashmenMcpClient) => Promise<T>): Promise<T> {
  const client = mcpClientForRequest(req);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

export { McpError };
