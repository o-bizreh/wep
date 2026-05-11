import { Router, type Request, type Response } from 'express';
import { type DynamoDBDocumentClient, GetCommand } from '@wep/aws-clients';
import { resolveCallerIdentity, resolveUserAttributes, deriveRole } from '../plugins/identity.js';

export function createAuthRouter(dynamoClient: DynamoDBDocumentClient, teamsTable: string): Router {
  const router = Router();

  // GET /auth/me — resolve the current user's identity, role, and team membership.
  // Cached 5 min server-side via the identity helpers; safe to call on every app load.
  router.get('/me', async (req: Request, res: Response) => {
    const identity = await resolveCallerIdentity(req);
    if (!identity) {
      // No credentials configured — safe default, not an error
      return res.json({ username: null, isDevOps: false, role: 'engineer', teamId: null });
    }

    const { userType, department } = await resolveUserAttributes(req, identity.username);
    const role = deriveRole(userType, department);

    // Team membership lookup
    let teamId: string | null = null;
    try {
      const r = await dynamoClient.send(new GetCommand({
        TableName: teamsTable,
        Key: { PK: `USER#${identity.username}`, SK: '#TEAM' },
      }));
      teamId = (((r as any).Item))?.teamId ?? null;
    } catch { /* team lookup is best-effort */ }

    return res.json({
      username:   identity.username,
      email:      identity.email,
      isDevOps:   identity.isDevOps,
      role,
      userType,
      department,
      teamId,
    });
  });

  return router;
}
