import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  type DynamoDBDocumentClient,
  GetCommand, PutCommand, QueryCommand, DeleteCommand,
  SSOAdminClient, ListInstancesCommand, IdentitystoreClient, ListUsersCommand,
} from '@wep/aws-clients';
import { credentialsFromRequest, resolveCallerIdentity, resolveUserAttributes, deriveRole } from '../plugins/identity.js';

// ── helpers ──────────────────────────────────────────────────────────────────

async function resolveUser(req: Request, dynamoClient: DynamoDBDocumentClient, teamsTable: string) {
  const identity = await resolveCallerIdentity(req);
  if (!identity) return null;
  const { userType, department } = await resolveUserAttributes(req, identity.username);
  const role = deriveRole(userType, department);
  let teamId: string | null = null;
  try {
    const r = await dynamoClient.send(new GetCommand({ TableName: teamsTable, Key: { PK: `USER#${identity.username}`, SK: '#TEAM' } }));
    teamId = (r as any).Item?.teamId ?? null;
  } catch { /* best-effort */ }
  return { ...identity, role, teamId };
}

function forbidden(res: Response, msg = 'Forbidden') { return res.status(403).json({ error: msg }); }
function notFound(res: Response, msg = 'Not found')   { return res.status(404).json({ error: msg }); }

// ── router ───────────────────────────────────────────────────────────────────

export function createTeamsRouter(dynamoClient: DynamoDBDocumentClient, teamsTable: string): Router {
  const router = Router();

  // GET /teams/users — list IC users for member picker (registered before /:id to avoid collision)
  router.get('/users', async (req: Request, res: Response) => {
    const creds = credentialsFromRequest(req);
    if (!creds) return res.json({ users: [] });

    const region = process.env['SSO_REGION'] ?? process.env['AWS_REGION'] ?? 'eu-west-1';
    try {
      const ssoAdmin = new SSOAdminClient({ region, credentials: creds });
      const ids      = new IdentitystoreClient({ region, credentials: creds });

      const instances = await ssoAdmin.send(new ListInstancesCommand({}));
      const identityStoreId = (instances as any).Instances?.[0]?.IdentityStoreId as string | undefined;
      if (!identityStoreId) return res.json({ users: [] });

      const users: { username: string; displayName: string | null; department: string | null }[] = [];
      let nextToken: string | undefined;
      do {
        const page = await ids.send(new ListUsersCommand({
          IdentityStoreId: identityStoreId,
          MaxResults: 100,
          ...(nextToken ? { NextToken: nextToken } : {}),
        })) as any;
        for (const u of page.Users ?? []) {
          if (!u.UserName) continue;
          users.push({ username: u.UserName, displayName: u.DisplayName ?? null, department: extractDept(u) });
        }
        nextToken = page.NextToken;
      } while (nextToken);

      return res.json({ users: users.sort((a, b) => a.username.localeCompare(b.username)) });
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to list users' });
    }
  });

  // GET /teams
  router.get('/', async (req: Request, res: Response) => {
    try {
      const user = await resolveUser(req, dynamoClient, teamsTable);
      const isAdmin = user?.isDevOps || user?.role === 'manager';

      const allTeamsResp = await dynamoClient.send(new QueryCommand({
        TableName: teamsTable,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': 'TEAMS' },
      }));
      const allTeamIds: string[] = ((allTeamsResp as any).Items ?? []).map((i: any) => i.teamId as string);

      if (!isAdmin) {
        if (!user?.teamId) return res.json({ teams: [] });
        const own = allTeamIds.filter(id => id === user.teamId);
        const teams = await Promise.all(own.map(id => fetchTeam(dynamoClient, teamsTable, id)));
        return res.json({ teams: teams.filter(Boolean) });
      }

      const teams = await Promise.all(allTeamIds.map(id => fetchTeam(dynamoClient, teamsTable, id)));
      return res.json({ teams: teams.filter(Boolean) });
    } catch {
      return res.json({ teams: [] });
    }
  });

  // POST /teams
  router.post('/', async (req: Request, res: Response) => {
    const user = await resolveUser(req, dynamoClient, teamsTable);
    if (!user?.isDevOps && user?.role !== 'manager') return forbidden(res);

    const { name } = req.body as { name?: string };
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

    const teamId = randomUUID();
    const now = new Date().toISOString();

    await Promise.all([
      dynamoClient.send(new PutCommand({
        TableName: teamsTable,
        Item: { PK: `TEAM#${teamId}`, SK: '#META', teamId, name: name.trim(), createdAt: now, createdBy: user.username },
      })),
      dynamoClient.send(new PutCommand({
        TableName: teamsTable,
        Item: { PK: 'TEAMS', SK: `TEAM#${teamId}`, teamId, name: name.trim(), createdAt: now },
      })),
    ]);

    return res.status(201).json({ teamId, name: name.trim(), createdAt: now, members: [] });
  });

  // DELETE /teams/:id
  router.delete('/:id', async (req: Request, res: Response) => {
    const user = await resolveUser(req, dynamoClient, teamsTable);
    if (!user?.isDevOps && user?.role !== 'manager') return forbidden(res);

    const teamId = req.params['id']!;
    const membersResp = await dynamoClient.send(new QueryCommand({
      TableName: teamsTable,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `TEAM#${teamId}`, ':prefix': 'MEMBER#' },
    }));
    await Promise.all(((membersResp as any).Items ?? []).map((m: any) =>
      Promise.all([
        dynamoClient.send(new DeleteCommand({ TableName: teamsTable, Key: { PK: `USER#${m.username}`, SK: '#TEAM' } })),
        dynamoClient.send(new DeleteCommand({ TableName: teamsTable, Key: { PK: `TEAM#${teamId}`, SK: `MEMBER#${m.username}` } })),
      ]),
    ));
    await Promise.all([
      dynamoClient.send(new DeleteCommand({ TableName: teamsTable, Key: { PK: `TEAM#${teamId}`, SK: '#META' } })),
      dynamoClient.send(new DeleteCommand({ TableName: teamsTable, Key: { PK: 'TEAMS', SK: `TEAM#${teamId}` } })),
    ]);

    return res.status(204).send();
  });

  // POST /teams/:id/members
  router.post('/:id/members', async (req: Request, res: Response) => {
    const user    = await resolveUser(req, dynamoClient, teamsTable);
    const teamId  = req.params['id']!;
    const isAdmin = user?.isDevOps || user?.role === 'manager';
    const isLead  = user?.role === 'team_lead' && user?.teamId === teamId;
    if (!isAdmin && !isLead) return forbidden(res);

    const { username, department } = req.body as { username?: string; department?: string };
    if (!username?.trim()) return res.status(400).json({ error: 'username is required' });

    const meta = await dynamoClient.send(new GetCommand({ TableName: teamsTable, Key: { PK: `TEAM#${teamId}`, SK: '#META' } }));
    if (!(meta as any).Item) return notFound(res, 'Team not found');

    const now = new Date().toISOString();
    await Promise.all([
      dynamoClient.send(new PutCommand({
        TableName: teamsTable,
        Item: { PK: `TEAM#${teamId}`, SK: `MEMBER#${username.trim()}`, username: username.trim(), department: department ?? null, addedAt: now, addedBy: user!.username },
      })),
      dynamoClient.send(new PutCommand({
        TableName: teamsTable,
        Item: { PK: `USER#${username.trim()}`, SK: '#TEAM', teamId },
      })),
    ]);

    return res.status(201).json({ username: username.trim(), department: department ?? null, addedAt: now });
  });

  // DELETE /teams/:id/members/:username
  router.delete('/:id/members/:username', async (req: Request, res: Response) => {
    const user     = await resolveUser(req, dynamoClient, teamsTable);
    const teamId   = req.params['id']!;
    const username = req.params['username']!;
    const isAdmin  = user?.isDevOps || user?.role === 'manager';
    const isLead   = user?.role === 'team_lead' && user?.teamId === teamId;
    if (!isAdmin && !isLead) return forbidden(res);

    await Promise.all([
      dynamoClient.send(new DeleteCommand({ TableName: teamsTable, Key: { PK: `TEAM#${teamId}`, SK: `MEMBER#${username}` } })),
      dynamoClient.send(new DeleteCommand({ TableName: teamsTable, Key: { PK: `USER#${username}`, SK: '#TEAM' } })),
    ]);

    return res.status(204).send();
  });

  return router;
}

async function fetchTeam(dynamoClient: DynamoDBDocumentClient, teamsTable: string, teamId: string) {
  const [meta, membersResp] = await Promise.all([
    dynamoClient.send(new GetCommand({ TableName: teamsTable, Key: { PK: `TEAM#${teamId}`, SK: '#META' } })),
    dynamoClient.send(new QueryCommand({
      TableName: teamsTable,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `TEAM#${teamId}`, ':prefix': 'MEMBER#' },
    })),
  ]);
  if (!(meta as any).Item) return null;
  return { ...(meta as any).Item, members: (membersResp as any).Items ?? [] };
}

function extractDept(user: any): string | null {
  const attrs: any[] = user?.CustomAttributes ?? user?.Attributes ?? [];
  const match = attrs.find((a: any) => a?.Key === 'department' || a?.key === 'department');
  return match?.Value ?? match?.value ?? null;
}
