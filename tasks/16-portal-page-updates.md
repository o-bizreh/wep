# 16 — Updates to existing portal pages

STATUS: deferred

## What's done
- Backend supports the new Operation kinds + auto-approval rules + audit timeline. Existing portal pages keep compiling because their local types are subset views.

## What's deferred (UI-only enhancements, not blocking)
- Form fields for `requesterAwsUsername` + `durationMinutes` on `PortalRequestPage` (today the API accepts them; pages don't yet send them).
- Auto-approval rule editor in `PortalOperationFormPage`.
- Status-pill / countdown / "Re-display credentials" affordance on `PortalRequestsPage`.
- "Auto-approves for you" badges on the catalog.

The new `PortalApprovePage` (task 15) is the only UI consumer that needs all the new fields, and it has them. Existing flows continue to work. These deferred form updates can ship after team feedback on the v1 surface.

## Scope

Three page updates on the requester / operation-author side.

## Files

- `apps/web/src/pages/portal/PortalRequestPage.tsx` — request submission form
- `apps/web/src/pages/portal/PortalRequestsPage.tsx` — listing of the user's requests
- `apps/web/src/pages/portal/PortalRequestDetailPage.tsx` — single request view (already exists)
- `apps/web/src/pages/portal/PortalOperationFormPage.tsx` — operation create/edit (DevOps)
- `apps/web/src/pages/portal/PortalOperationsManagePage.tsx` — DevOps operations list

## Changes

### PortalRequestPage

- Add `Duration (minutes)` field — defaulted from operation's `maxDurationMinutes`, capped at it.
- Add `AWS username` field, only when `operation.category === 'aws-action'`. Required.
- Show a hint chip when the user's known team would auto-approve this request (best-effort preview based on `auth/role` info).
- On submit, if response includes `credentials`, redirect to a one-shot "credentials issued" view (or toast + DM notice).

### PortalRequestsPage

- Status badges include `auto-approved`.
- For active requests with `expiresAt`, show a countdown.
- Active requests show a "Re-display credentials" affordance that says "Sent to your Slack DM at HH:MM. The platform does not store credentials."

### PortalRequestDetailPage

- Show audit timeline.
- For auto-approved requests, show the matched rule description.

### PortalOperationFormPage

- Category radio: `aws-action` / `db-credentials` / `runbook`. Reveal the right sub-form for each.
- For `aws-action`: IAM role ARN input, session-policy template textarea, max duration, optional console-link toggle.
- For `db-credentials`: JIT resource picker, allowed roles checkboxes (filtered by the resource's allowedRoles/Users), max duration.
- New section: **Auto-approval rules**. Repeatable rule editor:
  - Description text.
  - Match: domain checkboxes, team picker, parameter-equals key/value pairs.
  - Constraints: max duration, working hours toggle, exclude users.
- Master toggle to enable/disable all rules.

### PortalOperationsManagePage

- New column: "Auto-approves" (yes/no).

## Acceptance

- All forms compile, save, and round-trip the new fields.
- Existing operations (without new fields) display correctly using defaults.
- `pnpm --filter @wep/web typecheck` passes.
