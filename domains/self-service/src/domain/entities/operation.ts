export type OperationTier = 'self-serve' | 'peer-approved' | 'devops-approved';
/** Subject-area classification (what kind of concern). Existing field; preserved. */
export type OperationCategory = 'access' | 'infrastructure' | 'development' | 'configuration';
/**
 * Dispatch kind — drives credential issuance.
 *  - aws-action     → STS AssumeRole into a pre-provisioned role with a session policy
 *  - db-credentials → temp DB user (Postgres) or GetClusterCredentials (Redshift)
 *  - runbook        → existing runbook execution path (no creds issued by this domain)
 */
export type OperationKind = 'aws-action' | 'db-credentials' | 'runbook';

export type ParameterType =
  | 'string'
  | 'select'
  | 'boolean'
  | 'serviceSelector'
  | 'environmentSelector'
  | 'teamSelector'
  | 'jitResourceSelector'
  | 'awsResourceSelector'
  /** GitHub repository selector — implementation planned, not yet active */
  | 'githubRepoSelector';

export interface ParameterDefinition {
  name: string;
  label: string;
  type: ParameterType;
  required: boolean;
  defaultValue?: string;
  helpText?: string;
  options?: Array<{ label: string; value: string }>;
  validationRegex?: string;
}

export interface AwsActionConfig {
  /**
   * IAM actions this operation grants, e.g. ["dynamodb:PutItem", "dynamodb:GetItem"].
   * The platform creates a purpose-built IAM role per approval scoped to exactly these actions.
   */
  actions: string[];
  /**
   * Fixed AWS resource ARN this operation targets, e.g. "arn:aws:dynamodb:eu-west-1:123:table/orders".
   * Use this when the resource is the same for every request.
   * Mutually exclusive with resourceArnParameter.
   */
  resourceArn?: string;
  /**
   * Name of the request parameter that holds the target resource ARN when the requester
   * picks the resource at submission time. Mutually exclusive with resourceArn.
   */
  resourceArnParameter?: string;
  /** Maximum session duration in minutes. Hard-capped at 720 (12h). Default 60. */
  maxDurationMinutes: number;
  /** If true, the DM also includes a console federation URL for one-click AWS Console access. */
  issueConsoleLink?: boolean;
}

export interface DbCredentialsConfig {
  /** Reference to a JitResource on the allowlist. */
  jitResourceId: string;
  /**
   * Subset of the JitResource's allowedRoles / allowedDbUsers this operation can grant.
   * For Postgres: maps to roles. For Redshift: maps to DB users.
   */
  allowedRoles: string[];
  maxDurationMinutes: number;
}

export type { AutoApprovalRule, AutoApprovalConfig } from '../value-objects/auto-approval-rule.js';
import type { AutoApprovalConfig } from '../value-objects/auto-approval-rule.js';

export interface Operation {
  operationId: string;
  name: string;
  description: string;
  category: OperationCategory;
  /** Dispatch kind. Existing rows default to 'runbook' on read. */
  kind: OperationKind;
  tier: OperationTier;
  parameters: ParameterDefinition[];
  executor: string;
  requiredPermissions: 'any-engineer' | 'team-member-of-service-owner' | 'domain-lead' | 'devops';
  estimatedDuration: string;
  isEnabled: boolean;

  /** AWS-action config — present iff kind === 'aws-action'. */
  awsAction?: AwsActionConfig;
  /** DB credentials config — present iff kind === 'db-credentials'. */
  dbCredentials?: DbCredentialsConfig;
  /** Auto-approval policy. Optional. Defaults to manual approval only. */
  autoApproval?: AutoApprovalConfig;
}
