# 04 — Extend ServiceRequest with approvalMode + audit events

STATUS: done

## Scope

Add fields to `ServiceRequest` for: how it was approved (manual vs auto), the rule that matched (when auto), the requester's stated AWS username (for STS RoleSessionName), the structured audit timeline.

## Files

- `domains/self-service/src/domain/entities/service-request.ts`
- `domains/self-service/src/infrastructure/dynamodb/service-request-repository.ts` — extend serialize/deserialize
- `domains/self-service/src/interfaces/api/routes.ts` — request-submission Zod schema

## Schema additions

```ts
export type RequestApprovalMode = 'manual' | 'auto';
export type RequestAuditEventType =
  | 'submitted' | 'auto-approved' | 'approved' | 'denied'
  | 'fulfilled' | 'failed' | 'revoked' | 'expired';

export interface RequestAuditEvent {
  at: string;                           // ISO
  actor: string;                        // ARN or 'system'
  type: RequestAuditEventType;
  detail?: string;                      // freeform — rule description, denial reason, error
}

// On ServiceRequest:
approvalMode?: RequestApprovalMode;     // present once decided
autoApprovalRuleDescription?: string;   // when approvalMode === 'auto'
requesterAwsUsername?: string;          // for AWS-action operations; required by Zod when category === 'aws-action'
durationMinutes: number;                // requested duration (defaulted from operation.maxDurationMinutes)
expiresAt?: string;                     // ISO; set once credentials issued
audit: RequestAuditEvent[];             // appended on every state change
```

## Acceptance

- ServiceRequest schema reflects the additions.
- Repository serializes/deserializes the new fields and back-fills `audit: []` for existing rows.
- Submission Zod schema requires `requesterAwsUsername` when the target operation has `category: 'aws-action'`.
- `pnpm --filter @wep/self-service typecheck` passes.

## Notes

- `audit` is intentionally append-only. No mutation of past events.
- `expiresAt` mirrors the credential expiry — it's how the UI shows countdowns without storing creds.
