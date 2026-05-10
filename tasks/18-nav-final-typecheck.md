# 18 — Nav updates + final type-check

STATUS: done

## Outcome
- All 5 packages compile green: `@wep/aws-clients`, `@wep/slack-notifier`, `@wep/self-service`, `@wep/api`, `@wep/web`.
- Nav under Act now reads:
  - Action Catalog → /portal
  - My Requests → /portal/requests
  - Database Allowlist → /portal/jit-resources
  - Active Credentials → /portal/jit-sessions
  - Manage Operations → /portal/operations/manage
  - Runbook Studio → /portal/runbooks
- New route mounted: `/portal/approve/:requestId` → PortalApprovePage.
- New API mounts: `/api/v1/slack/interactions` (signature-verified, stub).

## Scope

Final pass: nav labels, route checks, full type-check across all packages, smoke that nothing regressed.

## Files

- `packages/ui/constants/navigation.tsx`
- `apps/web/src/App.tsx`

## Changes

- Act → Operations section keeps its existing entries, plus:
  - **Action Catalog** → `/portal` (existing)
  - **My Requests** → `/portal/requests` (existing)
  - **Approvals** → `/portal/approvals` (filtered list of pending — optional convenience; can be a query param of My Requests)
  - **Manage Operations** → `/portal/operations/manage` (existing, DevOps-only)
  - **Database Allowlist** → `/portal/jit-resources` (rename label from "JIT Resources")
  - **Active Credentials** → `/portal/jit-sessions` (rename label)
  - **Runbook Studio** → `/portal/runbooks` (existing — separate concern, untouched)

## Acceptance

- `pnpm --filter @wep/api typecheck` passes.
- `pnpm --filter @wep/self-service typecheck` passes (or its equivalent build).
- `pnpm --filter @wep/web typecheck` passes.
- `pnpm --filter @wep/slack-notifier build` passes.
- `pnpm --filter @wep/aws-clients build` passes.

## Done definition

- All other tasks marked `STATUS: done`.
- README updated with any deviations from plan.
