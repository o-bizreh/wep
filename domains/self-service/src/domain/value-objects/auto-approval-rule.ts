/**
 * A rule that, when matched against a ServiceRequest + RequesterContext, allows
 * the platform to skip manual approval and issue credentials immediately.
 *
 * Match conditions are AND'd at the top level. Within each list field,
 * any value matches (OR). All conditions must satisfy for the rule to match.
 */
export interface AutoApprovalRule {
  /** Human-readable label — shown in audit posts, request detail UI, admin form. */
  description: string;

  match: {
    /** Match if requester's resolved domain is in this list. (legacy — derived from team membership) */
    requesterDomain?: string[];
    /** Match if any of requester's team IDs is in this list. (legacy) */
    requesterTeamId?: string[];
    /** Match if requester's profile.department is in this list. */
    requesterDepartment?: string[];
    /** Match if requester's profile.userType is in this list. */
    requesterUserType?: string[];
    /**
     * Each parameter listed here must equal one of the listed values.
     * If a parameter has a single value (string), the request's parameter must match exactly.
     * If a parameter has an array, the request's value must be in the array.
     */
    parameterEquals?: Record<string, string | string[]>;
    /**
     * Match against the target AWS resource's `Owner` tag (or another configured tag).
     * Two forms:
     *   - literal string: tag must equal that exact value (e.g. `"Customer"`)
     *   - sentinel `"$requesterDepartment"`: tag must equal the requester's department.
     *     This lets a single rule cover all domains — "domain leads can self-serve their
     *     own data" — without writing a per-domain rule.
     */
    resourceOwnerTagEquals?: string;
    /** Tag key to inspect — defaults to 'Owner'. */
    resourceOwnerTagKey?: string;
  };

  constraints?: {
    /** Reject auto-approval if requested duration exceeds this. */
    maxDurationMinutes?: number;
    /** Reject auto-approval outside business hours (UTC 09:00–18:00, Mon–Fri). */
    workingHoursOnly?: boolean;
    /** Reject if requester already has N or more active sessions for this operation. */
    maxConcurrentSessionsForRequester?: number;
    /** Block-list — even if other matches pass, this requester ARN is excluded. */
    excludeRequesterIds?: string[];
  };
}

export interface AutoApprovalConfig {
  /** Master toggle. When false, all rules are inert and every request goes through manual approval. */
  enabled: boolean;
  /** Rules evaluated in declaration order. First match wins. */
  rules: AutoApprovalRule[];
}
