export type RequestStatus = 'submitted' | 'pending-approval' | 'approved' | 'executing' | 'completed' | 'failed' | 'rejected' | 'cancelled';

/** How a request transitioned out of pending-approval (or whether it skipped that state entirely). */
export type RequestApprovalMode = 'manual' | 'auto';

/** Audit-trail event types. Append-only — every state change adds an entry to `audit`. */
export type RequestAuditEventType =
  | 'submitted'
  | 'auto-approved'
  | 'approved'
  | 'denied'
  | 'fulfilled'
  | 'failed'
  | 'revoked'
  | 'expired';

export interface RequestAuditEvent {
  /** ISO-8601 UTC timestamp. */
  at: string;
  /** ARN, email, or `'system'` for platform-driven events. */
  actor: string;
  type: RequestAuditEventType;
  /** Optional freeform context — rule description, denial reason, error message. */
  detail?: string;
}

export interface ServiceRequest {
  requestId: string;
  operationType: string;
  operationName: string;
  requesterId: string;
  requesterName: string;
  requesterEmail: string | null;
  requesterTeamId: string;
  serviceId: string | null;
  parameters: Record<string, string>;
  tier: string;
  status: RequestStatus;
  submittedAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  executedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  executionLog: string[];
  metadata: Record<string, unknown>;

  // ── Act-overhaul fields (v2) ────────────────────────────────────────
  /** Recorded once a decision happens. */
  approvalMode?: RequestApprovalMode;
  /** Description of the AutoApprovalRule that matched (when approvalMode === 'auto'). */
  autoApprovalRuleDescription?: string;
  /** AWS username supplied by the requester for AWS-action operations. Used as STS RoleSessionName. */
  requesterAwsUsername?: string;
  /** Full IAM ARN of the requester, e.g. arn:aws:sts::123:assumed-role/Role/username. Scopes dynamic IAM role trust policies. */
  requesterAwsArn?: string;
  /** Duration the requester asked for, in minutes. Defaults from operation.maxDurationMinutes. */
  durationMinutes?: number;
  /** ISO-8601 expiry of the issued credentials (mirror, not the source of truth — creds carry their own). */
  expiresAt?: string;
  /** Slack channel `ts` of the approval-request post — used to edit the message on outcome. */
  slackApprovalMessageTs?: string;
  /** Append-only audit timeline. Every state transition adds an entry. */
  audit?: RequestAuditEvent[];
}
