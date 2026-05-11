import type { Request } from 'express';
import {
  STSClient, GetCallerIdentityCommand,
  SSOAdminClient, ListInstancesCommand,
  IdentitystoreClient, GetUserIdCommand, DescribeUserCommand,
} from '@wep/aws-clients';

export interface CallerIdentity {
  username: string;
  email: string;
  roleName: string;
  isDevOps: boolean;
  arn: string;
}

export type SystemRole = 'manager' | 'team_lead' | 'engineer';

export interface ResolvedUser extends CallerIdentity {
  role: SystemRole;
  userType: string | null;
  department: string | null;
}

const identityCache = new Map<string, { value: CallerIdentity; cachedAt: number }>();
const icCache       = new Map<string, { userType: string | null; department: string | null; cachedAt: number }>();
const CACHE_TTL_MS  = 5 * 60_000;

export function credentialsFromRequest(req: Request): { accessKeyId: string; secretAccessKey: string; sessionToken?: string } | null {
  const accessKeyId     = req.headers['x-aws-access-key-id'] as string | undefined;
  const secretAccessKey = req.headers['x-aws-secret-access-key'] as string | undefined;
  const sessionToken    = req.headers['x-aws-session-token'] as string | undefined;
  if (!accessKeyId || !secretAccessKey) return null;
  return { accessKeyId, secretAccessKey, sessionToken };
}

export async function resolveCallerIdentity(req: Request): Promise<CallerIdentity | null> {
  const creds = credentialsFromRequest(req);
  if (!creds) return null;

  const cached = identityCache.get(creds.accessKeyId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.value;

  try {
    const sts = new STSClient({
      region: process.env['AWS_REGION'] ?? 'eu-west-1',
      credentials: creds,
    });
    const resp = await sts.send(new GetCallerIdentityCommand({}));
    const arn  = resp.Arn ?? '';

    const roleMatch = /assumed-role\/([^/]+)\/(.+)$/.exec(arn);
    const userMatch = /user\/(.+)$/.exec(arn);
    const username  = roleMatch?.[2] ?? userMatch?.[1] ?? arn.split(':').pop() ?? 'unknown';
    const roleName  = roleMatch?.[1] ?? 'iam-user';

    const emailDomain = process.env['WEP_EMAIL_DOMAIN'] ?? 'washmen.com';
    const email       = `${username}@${emailDomain}`;
    const devopsPattern = process.env['DEVOPS_ROLE_PATTERN'] ?? 'DevOpsDomainOwner';
    const isDevOps    = roleName.includes(devopsPattern);

    const value: CallerIdentity = { username, email, roleName, isDevOps, arn };
    identityCache.set(creds.accessKeyId, { value, cachedAt: Date.now() });
    return value;
  } catch {
    return null;
  }
}

export async function resolveUserAttributes(
  req: Request,
  username: string,
): Promise<{ userType: string | null; department: string | null }> {
  const creds = credentialsFromRequest(req);
  if (!creds) return { userType: null, department: null };

  const cached = icCache.get(username);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return { userType: cached.userType, department: cached.department };
  }

  const region = process.env['SSO_REGION'] ?? process.env['AWS_REGION'] ?? 'eu-west-1';
  try {
    const ssoAdmin = new SSOAdminClient({ region, credentials: creds });
    const ids      = new IdentitystoreClient({ region, credentials: creds });

    const instances = await ssoAdmin.send(new ListInstancesCommand({}));
    const identityStoreId = instances.Instances?.[0]?.IdentityStoreId;
    if (!identityStoreId) return { userType: null, department: null };

    let userId: string | undefined;
    const emailDomain = process.env['WEP_EMAIL_DOMAIN'] ?? 'washmen.com';
    for (const candidate of [username, `${username}@${emailDomain}`]) {
      try {
        const r = await ids.send(new GetUserIdCommand({
          IdentityStoreId: identityStoreId,
          AlternateIdentifier: { UniqueAttribute: { AttributePath: 'userName', AttributeValue: candidate } },
        }));
        if (r.UserId) { userId = r.UserId; break; }
      } catch { /* try next */ }
    }
    if (!userId) return { userType: null, department: null };

    const user = await ids.send(new DescribeUserCommand({ IdentityStoreId: identityStoreId, UserId: userId }));

    const userType   = user.UserType ?? null;
    const department = (user.Addresses ?? []).length === 0
      ? extractCustomAttr(user, 'department')
      : null;

    // Department may be in Addresses[0].Region or as a custom attribute — try both
    const dept = department
      ?? extractCustomAttr(user, 'department')
      ?? (user as any)?.EnterpriseUser?.department
      ?? null;

    const result = { userType, department: dept };
    icCache.set(username, { ...result, cachedAt: Date.now() });
    return result;
  } catch {
    return { userType: null, department: null };
  }
}

function extractCustomAttr(user: any, key: string): string | null {
  const attrs: any[] = user?.CustomAttributes ?? user?.Attributes ?? [];
  const match = attrs.find((a: any) => a?.Key === key || a?.key === key);
  return match?.Value ?? match?.value ?? null;
}

export function deriveRole(userType: string | null, department: string | null): SystemRole {
  if (userType === 'Administrator' && department === 'Management') return 'manager';
  if (userType === 'DomainLead') return 'team_lead';
  return 'engineer';
}
