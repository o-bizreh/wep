export type JitSessionStatus = 'active' | 'expired' | 'revoked';
export type JitSessionType = 'db' | 'aws-console';

export interface JitSession {
  sessionId: string;
  requestId: string;
  requesterId: string;
  requesterEmail: string | null;
  resourceId: string;
  resourceType: string;
  resourceName: string;
  /** 'db' for RDS/EC2 sessions, 'aws-console' for federation-based console sessions */
  sessionType: JitSessionType;
  /** The ephemeral DB username created for this session (db sessions only) */
  dbUsername?: string;
  /** AWS service name: 'lambda' | 'sns' | 'sqs' | 'dynamodb' (aws-console sessions only) */
  awsService?: string;
  /** The exact resource ARN the session policy is scoped to */
  awsResourceArn?: string;
  /** The IAM action that was granted, e.g. 'lambda:InvokeFunction' */
  awsAction?: string;
  /** Secrets Manager secret name holding the STS credentials for URL regeneration */
  credentialsSecretId?: string;
  /** ISO8601 — when the session was granted */
  grantedAt: string;
  /** ISO8601 — when the session auto-expires */
  expiresAt: string;
  status: JitSessionStatus;
  revokedAt: string | null;
  /** 'scheduler' | userId */
  revokedBy: string | null;
}
