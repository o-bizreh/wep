# 02 — Extend Operation with category + aws-action + db-credentials fields

STATUS: done

## Deviation
- Used field name `kind` instead of `category` (existing `category` field is the subject classification — kept as-is to avoid breaking existing data and UI).

## Scope

Add a `category` discriminator to `Operation` and the per-category configuration fields. Existing rows default to `runbook`.

## Files

- `domains/self-service/src/domain/entities/operation.ts`
- `domains/self-service/src/infrastructure/dynamodb/operation-repository.ts`
- `domains/self-service/src/interfaces/api/routes.ts` — Zod schema for create/update

## Schema

```ts
export type OperationCategory = 'aws-action' | 'db-credentials' | 'runbook';

export interface Operation {
  // ...existing fields
  category: OperationCategory;
  // category === 'aws-action' uses these:
  awsAction?: {
    /** Pre-provisioned role the platform will AssumeRole into. */
    iamRoleArn: string;
    /** Inline IAM policy template with ${param.foo} placeholders. Rendered + applied as session policy. */
    sessionPolicyTemplate: string;
    /** STS session duration. Hard-capped at 12h, default 60 min. */
    maxDurationMinutes: number;
    /** Console federation link in addition to access keys (optional). */
    issueConsoleLink?: boolean;
  };
  // category === 'db-credentials' uses these:
  dbCredentials?: {
    /** Reference to a JitResource (allowlist entry). */
    jitResourceId: string;
    /** Subset of the JitResource's allowedRoles/allowedDbUsers that this operation can grant. */
    allowedRoles: string[];
    maxDurationMinutes: number;
  };
}
```

## Acceptance

- `Operation` carries `category` + the appropriate sub-shape.
- Repository deserializer fills in defaults: `category = 'runbook'` for any existing row that lacks the field.
- Zod schema validates the shape on create/update — rejects an `aws-action` operation without `awsAction`, etc.
- `pnpm --filter @wep/self-service typecheck` passes.

## Notes

- Don't enforce role-arn validity here — DevOps may be configuring before the role exists.
- 12h hard cap enforced on the schema (`max(720)`).
