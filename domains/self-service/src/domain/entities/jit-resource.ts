export type JitResourceType = 'rds-postgres' | 'redshift' | 'ec2-ssh';

/** Strategy for issuing Postgres temp credentials. */
export type PostgresAuthStrategy = 'temp-user' | 'iam-token';

export interface JitResource {
  resourceId: string;
  type: JitResourceType;
  /** Display label shown in the portal request form */
  name: string;
  environment: string;
  region: string;
  isEnabled: boolean;
  /** Human-readable notes shown to the requester on the form */
  notes?: string;
  createdAt: string;
  updatedAt: string;
  /** Hard cap on duration regardless of what the operation requests. */
  maxDurationMinutes?: number;

  // ── RDS Postgres fields ───────────────────────────────
  /** Hostname / endpoint of the RDS instance */
  host?: string;
  port?: number;
  /** Default database name the JIT user should connect to */
  dbName?: string;
  /**
   * Secrets Manager secret ID that holds the master connection URL.
   * Format expected: postgresql://user:password@host:port/db
   * Used by the temp-user strategy to provision per-request DB users.
   */
  masterSecretId?: string;
  /** Postgres auth strategy. Defaults to 'temp-user'. */
  postgresAuth?: PostgresAuthStrategy;
  /** Postgres roles the operation can grant to a temp user. */
  allowedPostgresRoles?: string[];

  // ── Redshift fields ───────────────────────────────────
  /** Redshift cluster identifier (the Cluster ID, not the endpoint). */
  clusterIdentifier?: string;
  /**
   * IAM role ARN the platform AssumeRoles into to call redshift:GetClusterCredentials.
   * Distinct from the IAM role the requester might receive — this one belongs to the platform.
   */
  iamRoleArn?: string;
  /** Whitelist of DB users the operation can request via GetClusterCredentials (AutoCreate=true). */
  allowedDbUsers?: string[];

  // ── EC2 SSH fields (future) ───────────────────────────
  instanceId?: string;
  bastionHost?: string;
}
