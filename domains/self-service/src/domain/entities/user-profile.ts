/**
 * Per-user platform profile. Set by the user in Settings (one-time) and used
 * by auto-approval rules that match on `requesterDepartment` / `requesterUserType`.
 *
 * Source-of-truth lives in this DynamoDB entity for v1. A future enhancement
 * is to verify these against IAM Identity Center on read (DescribeUser returns
 * UserType reliably; Department comes from the SCIM enterprise extension and
 * isn't always exposed via the API).
 */
export interface WepUserProfile {
  /** Platform login email — primary key. */
  email: string;
  /** Display name. Optional, for audit logs. */
  displayName?: string;
  /**
   * Domain / business unit. Examples: 'Customer', 'Payment', 'Data', 'DevOps'.
   * Free-form so it can match arbitrary `Owner` tag values on AWS resources.
   */
  department?: string;
  /**
   * Role classification. Examples: 'DomainLead', 'Engineer', 'SeniorEngineer', 'PrincipalEngineer'.
   * Free-form to give DevOps flexibility in rule authoring.
   */
  userType?: string;
  /** SSO username — used as STS RoleSessionName for AWS-action operations. */
  awsUsername?: string;
  /** Source of the data — `manual` for self-declared, `identitystore` for verified. */
  source: 'manual' | 'identitystore';
  updatedAt: string;
  /** Who last edited it (their email). For audit. */
  updatedBy: string;
}
