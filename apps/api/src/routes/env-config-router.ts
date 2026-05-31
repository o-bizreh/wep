import { Router, Request, Response } from 'express';
import {
  type DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  DeleteCommand,
  GetCommand,
} from '@wep/aws-clients';
import { getTableName } from '@wep/aws-clients';

// ─── Domain Types ─────────────────────────────────────────────────────────────

type Environment = 'development' | 'staging' | 'production';

const ENVIRONMENTS: Environment[] = ['development', 'staging', 'production'];

interface EnvKey {
  name: string;
  isSecret: boolean;
  isRequired: boolean;
  description?: string;
  source?: 'parameter-store' | 'secrets-manager' | 'env-file' | 'injected';
  presentInEnv: boolean;
}

interface EnvConfig {
  serviceName: string;
  environment: Environment;
  keys: EnvKey[];
  updatedAt: string;
  updatedBy: string;
}

interface EnvConfigItem {
  PK: string; // SERVICE#<serviceName>
  SK: string; // ENV#<environment>
  GSI1PK: string; // ALL_SERVICES
  GSI1SK: string; // SERVICE#<serviceName>#ENV#<environment>
  serviceName: string;
  environment: Environment;
  keys: EnvKey[];
  updatedAt: string;
  updatedBy: string;
}

// ─── Request body shapes ──────────────────────────────────────────────────────

interface UpsertBody {
  keys: EnvKey[];
  updatedBy: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function problemDetails(status: number, title: string, detail: string) {
  return { type: 'about:blank', title, status, detail };
}

function isEnvironment(value: unknown): value is Environment {
  return value === 'development' || value === 'staging' || value === 'production';
}

function makeItem(serviceName: string, environment: Environment, keys: EnvKey[], updatedBy: string): EnvConfigItem {
  return {
    PK: `SERVICE#${serviceName}`,
    SK: `ENV#${environment}`,
    GSI1PK: 'ALL_SERVICES',
    GSI1SK: `SERVICE#${serviceName}#ENV#${environment}`,
    serviceName,
    environment,
    keys,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

function toEnvConfig(item: EnvConfigItem): EnvConfig {
  return {
    serviceName: item.serviceName,
    environment: item.environment,
    keys: item.keys ?? [],
    updatedAt: item.updatedAt,
    updatedBy: item.updatedBy,
  };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export function createEnvConfigRouter(dynamoClient: DynamoDBDocumentClient): Router {
  const router = Router();
  const tableName = getTableName('env-config');

  // GET /services — list all unique service names
  router.get('/services', async (_req: Request, res: Response) => {
    const allItems: EnvConfigItem[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :pk',
          ExpressionAttributeValues: { ':pk': 'ALL_SERVICES' },
          ExclusiveStartKey: lastKey,
        }),
      );
      for (const item of (result.Items ?? []) as EnvConfigItem[]) {
        allItems.push(item);
      }
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    const serviceNames = [...new Set(allItems.map((i) => i.serviceName))].sort();
    res.json({ services: serviceNames });
  });

  // GET /services/:serviceName — get all environments for a service
  router.get('/services/:serviceName', async (req: Request<{ serviceName: string }>, res: Response) => {
    const serviceName = decodeURIComponent(req.params.serviceName ?? '');

    if (!serviceName) {
      res.status(400).json(problemDetails(400, 'Bad Request', 'serviceName is required'));
      return;
    }

    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `SERVICE#${serviceName}`,
          ':sk': 'ENV#',
        },
      }),
    );

    const configs = ((result.Items ?? []) as EnvConfigItem[]).map(toEnvConfig);
    res.json(configs);
  });

  // POST /services/:serviceName/:environment — upsert env config
  router.post(
    '/services/:serviceName/:environment',
    async (req: Request<{ serviceName: string; environment: string }>, res: Response) => {
      const serviceName = decodeURIComponent(req.params.serviceName ?? '');
      const environment = req.params.environment as string;

      if (!serviceName) {
        res.status(400).json(problemDetails(400, 'Bad Request', 'serviceName is required'));
        return;
      }

      if (!isEnvironment(environment)) {
        res.status(400).json(problemDetails(400, 'Bad Request', 'environment must be development, staging, or production'));
        return;
      }

      const body = req.body as Partial<UpsertBody>;

      if (!body.updatedBy || typeof body.updatedBy !== 'string') {
        res.status(400).json(problemDetails(400, 'Bad Request', 'updatedBy is required'));
        return;
      }

      if (!Array.isArray(body.keys)) {
        res.status(400).json(problemDetails(400, 'Bad Request', 'keys must be an array'));
        return;
      }

      const item = makeItem(serviceName, environment, body.keys, body.updatedBy);
      await dynamoClient.send(new PutCommand({ TableName: tableName, Item: item }));
      res.status(201).json(toEnvConfig(item));
    },
  );

  // DELETE /services/:serviceName/:environment — remove env config
  router.delete(
    '/services/:serviceName/:environment',
    async (req: Request<{ serviceName: string; environment: string }>, res: Response) => {
      const serviceName = decodeURIComponent(req.params.serviceName ?? '');
      const environment = req.params.environment as string;

      if (!serviceName) {
        res.status(400).json(problemDetails(400, 'Bad Request', 'serviceName is required'));
        return;
      }

      if (!isEnvironment(environment)) {
        res.status(400).json(problemDetails(400, 'Bad Request', 'environment must be development, staging, or production'));
        return;
      }

      const existing = await dynamoClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: `SERVICE#${serviceName}`, SK: `ENV#${environment}` },
        }),
      );

      if (!existing.Item) {
        res.status(404).json(problemDetails(404, 'Not Found', `No config found for ${serviceName}/${environment}`));
        return;
      }

      await dynamoClient.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { PK: `SERVICE#${serviceName}`, SK: `ENV#${environment}` },
        }),
      );

      res.status(204).send();
    },
  );

  // GET /services/:serviceName/diff — compare keys across environments
  router.get('/services/:serviceName/diff', async (req: Request<{ serviceName: string }>, res: Response) => {
    const serviceName = decodeURIComponent(req.params.serviceName ?? '');

    if (!serviceName) {
      res.status(400).json(problemDetails(400, 'Bad Request', 'serviceName is required'));
      return;
    }

    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `SERVICE#${serviceName}`,
          ':sk': 'ENV#',
        },
      }),
    );

    const configs = (result.Items ?? []) as EnvConfigItem[];

    // Build a map of env -> set of key names
    const keysByEnv: Record<string, Set<string>> = {};
    for (const config of configs) {
      keysByEnv[config.environment] = new Set(config.keys.map((k) => k.name));
    }

    // Collect all unique key names
    const allKeys = new Set<string>();
    for (const keySet of Object.values(keysByEnv)) {
      for (const k of keySet) {
        allKeys.add(k);
      }
    }

    const configuredEnvs = configs.map((c) => c.environment);
    const consistent: string[] = [];
    const missing: Record<string, string[]> = {};
    const extra: Record<string, string[]> = {};

    for (const keyName of allKeys) {
      const presentIn = configuredEnvs.filter((e) => keysByEnv[e]?.has(keyName));
      const absentIn = configuredEnvs.filter((e) => !keysByEnv[e]?.has(keyName));

      if (absentIn.length === 0) {
        consistent.push(keyName);
      } else {
        // key is present in some envs but not others
        for (const env of absentIn) {
          if (!missing[env]) missing[env] = [];
          missing[env].push(keyName);
        }
        // keys only in this env (not in at least one other configured env)
        for (const env of presentIn) {
          if (absentIn.length > 0) {
            if (!extra[env]) extra[env] = [];
            extra[env].push(keyName);
          }
        }
      }
    }

    res.json({ missing, extra, consistent });
  });

  // GET /summary — aggregate stats
  router.get('/summary', async (_req: Request, res: Response) => {
    const allItems: EnvConfigItem[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :pk',
          ExpressionAttributeValues: { ':pk': 'ALL_SERVICES' },
          ExclusiveStartKey: lastKey,
        }),
      );
      for (const item of (result.Items ?? []) as EnvConfigItem[]) {
        allItems.push(item);
      }
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    const serviceNames = [...new Set(allItems.map((i) => i.serviceName))];
    const totalKeys = allItems.reduce((sum, i) => sum + (i.keys?.length ?? 0), 0);

    // Per-service mismatch count
    const mismatchByService: Record<string, number> = {};
    for (const serviceName of serviceNames) {
      const serviceItems = allItems.filter((i) => i.serviceName === serviceName);
      const keysByEnv: Record<string, Set<string>> = {};
      for (const item of serviceItems) {
        keysByEnv[item.environment] = new Set(item.keys.map((k) => k.name));
      }
      const envList = Object.keys(keysByEnv);
      const allKeyNames = new Set<string>();
      for (const s of Object.values(keysByEnv)) for (const k of s) allKeyNames.add(k);

      let mismatches = 0;
      for (const keyName of allKeyNames) {
        const absentCount = envList.filter((e) => !keysByEnv[e]?.has(keyName)).length;
        if (absentCount > 0) mismatches += absentCount;
      }
      mismatchByService[serviceName] = mismatches;
    }

    const totalMismatches = Object.values(mismatchByService).reduce((s, v) => s + v, 0);
    const servicesWithMismatches = serviceNames.filter((s) => (mismatchByService[s] ?? 0) > 0).length;

    const configuredEnvs = [...new Set(allItems.map((i) => i.environment))];

    const topMismatchServices = serviceNames
      .filter((s) => (mismatchByService[s] ?? 0) > 0)
      .sort((a, b) => (mismatchByService[b] ?? 0) - (mismatchByService[a] ?? 0))
      .slice(0, 10)
      .map((s) => ({ serviceName: s, mismatches: mismatchByService[s] ?? 0 }));

    res.json({
      totalServices: serviceNames.length,
      totalKeys,
      totalMismatches,
      servicesWithMismatches,
      configuredEnvironments: configuredEnvs,
      topMismatchServices,
    });
  });

  return router;
}
