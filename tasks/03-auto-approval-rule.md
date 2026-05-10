# 03 — AutoApprovalRule + autoApproval on Operation

STATUS: done

## Scope

Add the auto-approval rule type and the optional `autoApproval` field on `Operation`. Pure data shape — evaluator comes in task 08.

## Files

- `domains/self-service/src/domain/value-objects/auto-approval-rule.ts` (new)
- `domains/self-service/src/domain/entities/operation.ts` — extend
- `domains/self-service/src/infrastructure/dynamodb/operation-repository.ts` — serialize
- `domains/self-service/src/interfaces/api/routes.ts` — Zod schema

## Schema

```ts
export interface AutoApprovalRule {
  description: string;
  match: {
    requesterDomain?: string[];
    requesterTeamId?: string[];
    parameterEquals?: Record<string, string | string[]>;
  };
  constraints?: {
    maxDurationMinutes?: number;
    workingHoursOnly?: boolean;
    maxConcurrentSessionsForRequester?: number;
    excludeRequesterIds?: string[];
  };
}

// On Operation:
autoApproval?: {
  enabled: boolean;          // master toggle / kill-switch
  rules: AutoApprovalRule[];
};
```

## Acceptance

- New value object exported.
- Operation interface and Zod schema accept the new field.
- Existing operations without `autoApproval` continue to work (default `undefined` ⇒ manual approval only).
- `pnpm --filter @wep/self-service typecheck` passes.

## Notes

- Do not yet wire to the submit handler — that's task 09.
- Per-rule `description` is mandatory (used in audit logs).
