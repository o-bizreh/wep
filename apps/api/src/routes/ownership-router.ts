import { Router, Request, Response } from 'express';
import {
  type DynamoDBDocumentClient,
  QueryCommand,
} from '@wep/aws-clients';
import { getTableName } from '@wep/aws-clients';

// ─── Domain Types ─────────────────────────────────────────────────────────────

interface ServiceStub {
  name: string;
  type: string;
  language: string;
  repositoryUrl: string;
}

interface TeamStat {
  teamId: string;
  teamName: string;
  serviceCount: number;
  services: ServiceStub[];
  languages: string[];
  types: string[];
  healthScore?: number;
}

interface OwnershipSummary {
  totalServices: number;
  teamsWithServices: number;
  unownedServices: number;
  sharedServices: number;
  teamBreakdown: TeamStat[];
  unownedList: ServiceStub[];
  largestTeams: TeamStat[];
}

interface RawServiceItem {
  PK: string;
  SK: string;
  name?: string;
  serviceName?: string;
  ownerTeam?: string | string[] | { teamId?: string; teamName?: string } | Array<{ teamId?: string; teamName?: string }>;
  type?: string;
  runtimeType?: string;
  language?: string;
  repositoryUrl?: string;
  [key: string]: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function problemDetails(status: number, title: string, detail: string) {
  return { type: 'about:blank', title, status, detail };
}

function normalizeOwnerTeamId(ownerTeam: RawServiceItem['ownerTeam']): string[] {
  if (!ownerTeam) return [];
  if (typeof ownerTeam === 'string') {
    return ownerTeam.trim() ? [ownerTeam.trim()] : [];
  }
  if (Array.isArray(ownerTeam)) {
    return ownerTeam
      .map((entry) => {
        if (typeof entry === 'string') return entry.trim();
        if (typeof entry === 'object' && entry !== null) {
          return (entry.teamId ?? entry.teamName ?? '').trim();
        }
        return '';
      })
      .filter(Boolean);
  }
  if (typeof ownerTeam === 'object' && ownerTeam !== null) {
    const id = (ownerTeam.teamId ?? ownerTeam.teamName ?? '').trim();
    return id ? [id] : [];
  }
  return [];
}

function toServiceStub(item: RawServiceItem): ServiceStub {
  return {
    name: item.name ?? item.serviceName ?? item.SK ?? 'Unknown',
    type: item.type ?? item.runtimeType ?? 'Other',
    language: item.language ?? 'Unknown',
    repositoryUrl: item.repositoryUrl ?? '',
  };
}

async function fetchAllServices(
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
): Promise<RawServiceItem[]> {
  const items: RawServiceItem[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': 'SERVICE' },
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of (result.Items ?? []) as RawServiceItem[]) {
      items.push(item);
    }
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return items;
}

function computeSummary(services: RawServiceItem[]): OwnershipSummary {
  const teamMap = new Map<string, { teamId: string; teamName: string; services: ServiceStub[] }>();
  const unownedList: ServiceStub[] = [];
  let sharedServices = 0;

  for (const item of services) {
    const stub = toServiceStub(item);
    const ownerIds = normalizeOwnerTeamId(item.ownerTeam);

    if (ownerIds.length === 0) {
      unownedList.push(stub);
      continue;
    }

    if (ownerIds.length > 1) {
      sharedServices++;
    }

    // Group by first owner (primary)
    const primaryId = ownerIds[0]!;
    const existing = teamMap.get(primaryId);
    if (existing) {
      existing.services.push(stub);
    } else {
      teamMap.set(primaryId, { teamId: primaryId, teamName: primaryId, services: [stub] });
    }
  }

  const teamBreakdown: TeamStat[] = Array.from(teamMap.values()).map(({ teamId, teamName, services }) => ({
    teamId,
    teamName,
    serviceCount: services.length,
    services,
    languages: [...new Set(services.map((s) => s.language).filter((l) => l && l !== 'Unknown'))],
    types: [...new Set(services.map((s) => s.type))],
  }));

  teamBreakdown.sort((a, b) => b.serviceCount - a.serviceCount);

  return {
    totalServices: services.length,
    teamsWithServices: teamMap.size,
    unownedServices: unownedList.length,
    sharedServices,
    teamBreakdown,
    unownedList,
    largestTeams: teamBreakdown.slice(0, 5),
  };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export function createOwnershipRouter(dynamoClient: DynamoDBDocumentClient): Router {
  const router = Router();
  const catalogTable = getTableName('service-catalog');

  // GET /summary
  router.get('/summary', async (_req: Request, res: Response) => {
    try {
      const services = await fetchAllServices(dynamoClient, catalogTable);
      const summary = computeSummary(services);
      res.json(summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json(problemDetails(500, 'Internal Server Error', message));
    }
  });

  // GET /teams/:teamId
  router.get('/teams/:teamId', async (req: Request<{ teamId: string }>, res: Response) => {
    const { teamId } = req.params;
    if (!teamId) {
      res.status(400).json(problemDetails(400, 'Bad Request', 'teamId is required'));
      return;
    }

    try {
      const services = await fetchAllServices(dynamoClient, catalogTable);
      const teamServices = services.filter((item) => {
        const ownerIds = normalizeOwnerTeamId(item.ownerTeam);
        return ownerIds.includes(teamId);
      });

      if (teamServices.length === 0) {
        res.status(404).json(problemDetails(404, 'Not Found', `Team ${teamId} not found or has no services`));
        return;
      }

      const stubs = teamServices.map(toServiceStub);
      const stat: TeamStat = {
        teamId,
        teamName: teamId,
        serviceCount: stubs.length,
        services: stubs,
        languages: [...new Set(stubs.map((s) => s.language).filter((l) => l && l !== 'Unknown'))],
        types: [...new Set(stubs.map((s) => s.type))],
      };

      res.json(stat);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json(problemDetails(500, 'Internal Server Error', message));
    }
  });

  // GET /unowned
  router.get('/unowned', async (_req: Request, res: Response) => {
    try {
      const services = await fetchAllServices(dynamoClient, catalogTable);
      const unowned = services
        .filter((item) => normalizeOwnerTeamId(item.ownerTeam).length === 0)
        .map(toServiceStub);
      res.json(unowned);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json(problemDetails(500, 'Internal Server Error', message));
    }
  });

  return router;
}
