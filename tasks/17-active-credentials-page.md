# 17 — Active Credentials page (renamed from JitSessions)

STATUS: partial

## What's done
- Nav label updated: "JIT Sessions" → "Active Credentials".
- Existing `JitSessionsPage` still mounted at `/portal/jit-sessions` (unchanged behaviour — lists active JIT DB sessions, supports revoke).

## What's deferred
- Showing aws-action sessions alongside DB sessions. Today the page only lists DB-style sessions tracked in `JitSession` records. AWS-action `STS AssumeRole` sessions don't create JitSession rows (STS sessions can't be revoked via the AWS API), so they're audit-only via the request history.
- Approval mode chip + auto-approval rule tooltip per row.

The renamed nav entry covers the most-visible piece. Page-level enhancements can ship after team feedback.

## Scope

Rename / reframe the existing JitSessions admin page into "Active Credentials" — shows currently-valid sessions across the org and lets DevOps revoke early.

## Files

- `apps/web/src/pages/portal/JitSessionsPage.tsx` — rename internally to `ActiveCredentialsPage` (keep file path; just update display + behaviour)
- `apps/web/src/App.tsx` — keep route at `/portal/jit-sessions` for compatibility (or add `/portal/credentials` alongside)
- `packages/ui/constants/navigation.tsx` — update label to "Active Credentials"

## Page contents

- Filter pills: all / aws-action / db-credentials.
- Table:
  - Operation name
  - Requester
  - Issued at
  - Expires at (countdown)
  - Approval mode (manual / auto + rule description tooltip)
  - Revoke button
- On revoke: confirms, calls `POST /portal/sessions/:id/revoke`, then refreshes.

## Acceptance

- Page lists active sessions only (status `active` or equivalent).
- Revoke action drops the session from the list and updates the audit trail behind the scenes.
- `pnpm --filter @wep/web typecheck` passes.
