import { Router, type Request, type Response } from 'express';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { IAMClient, ListAccountAliasesCommand } from '@aws-sdk/client-iam';
import { problemDetails } from '@wep/domain-types';
import { credentialStore, type CredentialOverride, regionStore } from '@wep/aws-clients';
import { setGitHubTokenOverride } from '@wep/github-client';

const REQUIRED_TABLES = [
  'wep-service-catalog',
  'wep-deployment-tracker',
  'wep-velocity-metrics',
  'wep-pipeline-analytics',
  'wep-cost-intelligence',
  'wep-self-service',
];

/** Check which DynamoDB tables exist by describing each one directly.
 *  Avoids ListTables pagination issues in accounts with many tables. */
async function checkDynamoTables(): Promise<Record<string, { exists: boolean; tableName: string }>> {
  const env = process.env['WEP_ENVIRONMENT'] ?? 'development';
  const endpoint = process.env['AWS_ENDPOINT_URL'];
  const region = process.env['AWS_REGION'] ?? 'me-south-1';

  const client = new DynamoDBClient({
    region,
    ...(endpoint ? { endpoint } : { credentials: credentialStore.getProvider() }),
  });

  const results = await Promise.all(
    REQUIRED_TABLES.map(async (base) => {
      const tableName = `${base}-${env}`;
      try {
        const response = await client.send(new DescribeTableCommand({ TableName: tableName }));
        const status = response.Table?.TableStatus;
        // ACTIVE or UPDATING means it's usable; CREATING/DELETING means in transition
        const exists = status === 'ACTIVE' || status === 'UPDATING';
        return [base, { exists, tableName }] as const;
      } catch {
        // ResourceNotFoundException or any other error → table doesn't exist
        return [base, { exists: false, tableName }] as const;
      }
    }),
  );

  return Object.fromEntries(results);
}

interface CallerIdentity {
  arn: string;
  account: string;
  userId: string;
  /** Human-friendly label: "username" for IAM users, "role/session" for assumed roles */
  displayName: string;
  /** "iam-user" | "assumed-role" | "federated" */
  principalType: string;
  /** IAM account alias, e.g. "washmen-production" — null when not set or unavailable */
  accountAlias: string | null;
}

function parseDisplayName(arn: string): { displayName: string; principalType: string } {
  // arn:aws:iam::123:user/john.doe  →  john.doe
  // arn:aws:sts::123:assumed-role/MyRole/session  →  MyRole / session
  // arn:aws:iam::123:root  →  root
  const userMatch = arn.match(/user\/(.+)$/);
  if (userMatch) return { displayName: userMatch[1]!, principalType: 'iam-user' };

  const roleMatch = arn.match(/assumed-role\/([^/]+)\/(.+)$/);
  if (roleMatch) return { displayName: `${roleMatch[1]} / ${roleMatch[2]}`, principalType: 'assumed-role' };

  const federatedMatch = arn.match(/federated-user\/(.+)$/);
  if (federatedMatch) return { displayName: federatedMatch[1]!, principalType: 'federated' };

  return { displayName: arn.split(':').pop() ?? arn, principalType: 'unknown' };
}

/**
 * Validates current credentials by calling STS GetCallerIdentity.
 * Distinguishes between "no credentials" (valid=false, expired=false) and
 * "credentials present but expired" (valid=false, expired=true) so the UI can
 * show a targeted banner.
 */
async function validateCredentials(): Promise<{ valid: boolean; expired: boolean; reason: string }> {
  const endpoint = process.env['AWS_ENDPOINT_URL'];
  const region = process.env['AWS_REGION'] ?? 'me-south-1';

  if (endpoint?.includes('localhost') || endpoint?.includes('127.0.0.1')) {
    return { valid: true, expired: false, reason: 'local' };
  }

  const source = credentialStore.getSource();
  if (!source) {
    return { valid: false, expired: false, reason: 'No credentials configured' };
  }

  try {
    const credentials = credentialStore.getProvider();
    const stsClient = new STSClient({ region, credentials });
    await stsClient.send(new GetCallerIdentityCommand({}));
    return { valid: true, expired: false, reason: '' };
  } catch (err: unknown) {
    const name = (err as { name?: string }).name ?? '';
    const message = (err as { message?: string }).message ?? '';
    const isExpired =
      name === 'ExpiredTokenException' ||
      name === 'InvalidClientTokenId' ||
      message.toLowerCase().includes('expired') ||
      message.toLowerCase().includes('security token');
    return {
      valid: false,
      expired: isExpired,
      reason: isExpired ? 'AWS session token has expired' : message,
    };
  }
}

async function getCallerIdentity(): Promise<CallerIdentity | null> {
  const endpoint = process.env['AWS_ENDPOINT_URL'];
  const region = process.env['AWS_REGION'] ?? 'me-south-1';

  // STS isn't available in DynamoDB Local — skip for local dev
  if (endpoint?.includes('localhost') || endpoint?.includes('127.0.0.1')) {
    return {
      arn: 'local',
      account: 'local',
      userId: 'local',
      displayName: 'Local / DynamoDB Local',
      principalType: 'local',
      accountAlias: null,
    };
  }

  try {
    const credentials = credentialStore.getProvider();
    const stsClient = new STSClient({ region, credentials });
    const iamClient = new IAMClient({ region, credentials });

    const [stsResponse, aliasResponse] = await Promise.allSettled([
      stsClient.send(new GetCallerIdentityCommand({})),
      iamClient.send(new ListAccountAliasesCommand({})),
    ]);

    if (stsResponse.status === 'rejected') return null;

    const arn = stsResponse.value.Arn ?? '';
    const { displayName, principalType } = parseDisplayName(arn);
    const accountAlias =
      aliasResponse.status === 'fulfilled'
        ? (aliasResponse.value.AccountAliases?.[0] ?? null)
        : null;

    return {
      arn,
      account: stsResponse.value.Account ?? '',
      userId: stsResponse.value.UserId ?? '',
      displayName,
      principalType,
      accountAlias,
    };
  } catch {
    return null;
  }
}

export function createSettingsRouter(): Router {
  const router = Router();

  /**
   * GET /settings/status
   * Returns infrastructure health: DynamoDB table existence, credential source,
   * GitHub token availability.
   */
  router.get('/status', async (_req: Request, res: Response) => {
    const [dynamoTables] = await Promise.all([checkDynamoTables()]);

    const allTablesExist = Object.values(dynamoTables).every((t) => t.exists);
    const credSource = credentialStore.getSource();
    const githubTokenConfigured =
      Boolean(process.env['GITHUB_TOKEN']) || credSource === 'override';

    res.json({
      dynamodb: {
        allTablesExist,
        tables: dynamoTables,
      },
      credentials: {
        source: credSource,
      },
      region: {
        current: regionStore.get(),
        source: process.env['AWS_REGION'] ? 'environment' : 'default',
      },
      github: {
        tokenConfigured: githubTokenConfigured,
        // tokenSource: from header override vs env vs Secrets Manager
        tokenSource: process.env['GITHUB_TOKEN'] ? 'environment' : githubTokenConfigured ? 'override' : 'none',
      },
    });
  });

  /**
   * GET /settings/identity
   * Calls STS GetCallerIdentity and returns the current AWS principal.
   * Returns null body (204) when running against DynamoDB Local with no real AWS.
   */
  router.get('/identity', async (_req: Request, res: Response) => {
    const identity = await getCallerIdentity();
    if (!identity) {
      res.status(204).send();
      return;
    }
    res.json(identity);
  });

  /**
   * GET /settings/credentials/validate
   * Lightweight STS check — returns { valid, expired, reason }.
   * Used by the frontend banner to detect expired SSO session tokens.
   */
  router.get('/credentials/validate', async (_req: Request, res: Response) => {
    const result = await validateCredentials();
    res.json(result);
  });

  /**
   * POST /settings/credentials
   * Accepts AWS credential override (SSO temp creds).
   * Body: { accessKeyId, secretAccessKey, sessionToken? }
   * Pass body as {} or omit to clear the override (revert to IAM role / env).
   */
  router.post('/credentials', (req: Request, res: Response) => {
    const body = req.body as Partial<CredentialOverride>;

    if (!body.accessKeyId && !body.secretAccessKey) {
      credentialStore.clear();
      res.json({ credentialSource: credentialStore.getSource() });
      return;
    }

    if (!body.accessKeyId || !body.secretAccessKey) {
      res.status(400).json(problemDetails(400, 'Invalid Body', 'accessKeyId and secretAccessKey are both required'));
      return;
    }

    credentialStore.set({
      accessKeyId: body.accessKeyId,
      secretAccessKey: body.secretAccessKey,
      sessionToken: body.sessionToken,
    });

    res.json({ credentialSource: credentialStore.getSource() });
  });

  /**
   * DELETE /settings/credentials
   * Clears the credential override — falls back to env vars / IAM role.
   */
  router.delete('/credentials', (_req: Request, res: Response) => {
    credentialStore.clear();
    res.json({ credentialSource: credentialStore.getSource() });
  });

  /**
   * POST /settings/region
   * Body: { region: string } — sets the AWS region for all SDK clients at runtime.
   * Takes effect immediately on subsequent AWS API calls without restarting.
   */
  router.post('/region', (req: Request, res: Response) => {
    const { region } = req.body as { region?: string };
    if (!region || typeof region !== 'string' || !/^[a-z]{2}-[a-z]+-\d$/.test(region)) {
      res.status(400).json(problemDetails(400, 'Invalid Body', 'region must be a valid AWS region code, e.g. eu-west-1'));
      return;
    }
    regionStore.set(region);
    res.json({ region: regionStore.get() });
  });

  /**
   * DELETE /settings/region
   * Reverts to the AWS_REGION env var or the default (eu-west-1).
   */
  router.delete('/region', (_req: Request, res: Response) => {
    regionStore.clear();
    res.json({ region: regionStore.get() });
  });

  /**
   * POST /settings/github-token
   * Body: { token: string } — sets GitHub token override.
   * Body: {} — clears override.
   */
  router.post('/github-token', (req: Request, res: Response) => {
    const { token } = req.body as { token?: string };
    setGitHubTokenOverride(token ?? null);
    res.json({ tokenConfigured: Boolean(token || process.env['GITHUB_TOKEN']) });
  });

  return router;
}
