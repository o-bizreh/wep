import {
  RedshiftClient,
  GetClusterCredentialsCommand,
  DescribeClustersCommand,
  STSClient,
  AssumeRoleCommand,
  credentialStore,
} from '@wep/aws-clients';
import { type Result, success, failure, type DomainError, domainError } from '@wep/domain-types';
import type { JitResource } from '../../domain/entities/jit-resource.js';
import type { ServiceRequest } from '../../domain/entities/service-request.js';
import type { DbCredentials } from './postgres-credential-issuer.js';

const HARD_MAX_DURATION_MINUTES = 60;        // Redshift caps GetClusterCredentials at 1h
const DEFAULT_DURATION_MINUTES = 60;

/**
 * Issues short-lived Redshift credentials via redshift:GetClusterCredentials.
 * The platform first AssumeRoles into the JitResource's iamRoleArn (a role
 * pre-configured with the GetClusterCredentials permission for the cluster)
 * and then mints credentials for the requested DB user (AutoCreate=true).
 */
export class RedshiftCredentialIssuer {
  async issue(
    resource: JitResource,
    request: ServiceRequest,
    dbUser: string,
  ): Promise<Result<DbCredentials, DomainError>> {
    if (resource.type !== 'redshift') {
      return failure(domainError('WRONG_RESOURCE_TYPE', `Expected redshift, got ${resource.type}`));
    }
    if (!resource.clusterIdentifier || !resource.iamRoleArn || !resource.dbName || !resource.region) {
      return failure(domainError('RESOURCE_INCOMPLETE',
        'Redshift JitResource must have clusterIdentifier, iamRoleArn, dbName, and region',
      ));
    }
    if (resource.allowedDbUsers && !resource.allowedDbUsers.includes(dbUser)) {
      return failure(domainError('USER_NOT_ALLOWED', `DB user '${dbUser}' is not in the resource's allowedDbUsers`));
    }

    const durationMinutes = clampDuration(request.durationMinutes ?? DEFAULT_DURATION_MINUTES, resource.maxDurationMinutes ?? HARD_MAX_DURATION_MINUTES);

    // 1. AssumeRole into the cluster's role so the issuer call has the right perms.
    const sts = new STSClient({ region: resource.region, credentials: credentialStore.getProvider() });
    let assumed;
    try {
      assumed = await sts.send(new AssumeRoleCommand({
        RoleArn: resource.iamRoleArn,
        RoleSessionName: `wep-redshift-${request.requestId.slice(0, 16)}`,
        DurationSeconds: 900,                                 // 15 min — only need it long enough to mint
      }));
    } catch (e) {
      return failure(domainError('STS_ASSUME_ROLE_FAILED', e instanceof Error ? e.message : String(e)));
    }
    const ac = assumed.Credentials;
    if (!ac?.AccessKeyId || !ac.SecretAccessKey || !ac.SessionToken) {
      return failure(domainError('STS_INCOMPLETE', 'AssumeRole missing credentials for Redshift issuer'));
    }

    // 2. Use the assumed creds to call GetClusterCredentials.
    const redshift = new RedshiftClient({
      region: resource.region,
      credentials: { accessKeyId: ac.AccessKeyId, secretAccessKey: ac.SecretAccessKey, sessionToken: ac.SessionToken },
    });
    let creds;
    try {
      creds = await redshift.send(new GetClusterCredentialsCommand({
        ClusterIdentifier: resource.clusterIdentifier,
        DbUser: dbUser,
        DbName: resource.dbName,
        DurationSeconds: durationMinutes * 60,
        AutoCreate: true,
      }));
    } catch (e) {
      return failure(domainError('REDSHIFT_GET_CREDS_FAILED', e instanceof Error ? e.message : String(e)));
    }
    if (!creds.DbUser || !creds.DbPassword || !creds.Expiration) {
      return failure(domainError('REDSHIFT_INCOMPLETE', 'GetClusterCredentials response missing fields'));
    }

    // 3. Need the cluster endpoint for the connection string.
    let host = resource.host;
    let port = resource.port ?? 5439;
    if (!host) {
      try {
        const cluster = await redshift.send(new DescribeClustersCommand({
          ClusterIdentifier: resource.clusterIdentifier,
        }));
        const ep = cluster.Clusters?.[0]?.Endpoint;
        if (ep?.Address) host = ep.Address;
        if (ep?.Port) port = ep.Port;
      } catch {
        // best-effort; if it fails the requester can grab the host from the console
      }
    }
    if (!host) {
      return failure(domainError('REDSHIFT_HOST_UNKNOWN', 'Could not resolve cluster endpoint'));
    }

    return success({
      type: 'redshift',
      host,
      port,
      database: resource.dbName,
      username: creds.DbUser,
      password: creds.DbPassword,
      expiresAt: creds.Expiration.toISOString(),
      connectionString: `postgresql://${encodeURIComponent(creds.DbUser)}:${encodeURIComponent(creds.DbPassword)}@${host}:${port}/${resource.dbName}?sslmode=require`,
    });
  }
}

function clampDuration(requested: number, max: number): number {
  const upper = Math.min(max, HARD_MAX_DURATION_MINUTES);
  if (!Number.isFinite(requested) || requested < 1) return Math.min(DEFAULT_DURATION_MINUTES, upper);
  return Math.min(requested, upper);
}
