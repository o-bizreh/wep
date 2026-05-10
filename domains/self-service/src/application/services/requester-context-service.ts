import { type Result, success, type DomainError } from '@wep/domain-types';
import type { PortalRepository } from '../../domain/ports/portal-repository.js';

/**
 * Resolved context for a requester at the time they submit a request.
 * Auto-approval rules check this against their `match` clauses.
 */
export interface RequesterContext {
  requesterArn: string;
  email: string | null;
  /** From WepUserProfile (set by user in Settings). */
  department: string | null;
  /** From WepUserProfile (set by user in Settings). */
  userType: string | null;
  /** AWS-side username — supplied by the requester for AWS-action ops. */
  awsUsername: string | null;
  // Legacy fields kept for back-compat with existing rules.
  teamIds: string[];
  domain: string | null;
}

export interface RequesterContextResolver {
  resolve(input: { requesterArn: string; email: string | null; awsUsername?: string | null }): Promise<Result<RequesterContext, DomainError>>;
}

/**
 * Default resolver — reads the requester's profile (department + userType)
 * from the DynamoDB-backed `WepUserProfile` set by the user in Settings.
 *
 * Legacy `domain` / `teamIds` are derived from the same profile when
 * possible, or left empty. Old auto-approval rules using `requesterDomain`
 * still work if `profile.department` lower-cases to a known domain key.
 */
export class RequesterContextService implements RequesterContextResolver {
  constructor(private readonly portalRepo: PortalRepository) {}

  async resolve(input: { requesterArn: string; email: string | null; awsUsername?: string | null }): Promise<Result<RequesterContext, DomainError>> {
    let department: string | null = null;
    let userType: string | null = null;
    let storedAwsUsername: string | null = null;
    if (input.email) {
      const profileResult = await this.portalRepo.getUserProfile(input.email);
      if (profileResult.ok && profileResult.value) {
        department = profileResult.value.department ?? null;
        userType = profileResult.value.userType ?? null;
        storedAwsUsername = profileResult.value.awsUsername ?? null;
      }
    }
    return success({
      requesterArn: input.requesterArn,
      email: input.email,
      department,
      userType,
      awsUsername: input.awsUsername ?? storedAwsUsername,
      teamIds: [],
      domain: department ? department.toLowerCase() : null,
    });
  }
}
