# 15 — Approval landing page

STATUS: done

## Scope

`/portal/approve/:requestId` — the page DevOps lands on after clicking "View Request" in Slack.

## Files

- `apps/web/src/pages/portal/PortalApprovePage.tsx` (new)
- `apps/web/src/App.tsx` — add route

## Page contents

- **Header**: Operation name + category chip, requester name + AWS username, submitted timestamp.
- **Status pill**: pending-approval / approved / denied / completed / revoked / expired.
- **Parameters table**: each form field the requester filled in, monospace values.
- **Justification**: requester's reason text.
- **Policy preview** (for `aws-action`): rendered session policy after `${param.foo}` substitution. Read-only JSON code block — gives DevOps confidence that auto-rendered policy matches expectations.
- **Audit timeline**: chronological list from `request.audit[]`.
- **Action bar** (visible only when `pending-approval` and the viewer is in DevOps group):
  - **Approve** primary button (large). Optional note field.
  - **Deny** danger button. Required reason field.
  - Both confirm with a modal — "this will issue credentials" / "this will reject and notify the requester".

## Acceptance

- Renders all fields without throwing on optional ones.
- Approve calls `POST /portal/requests/:id/approve` and shows a success toast — credentials are NOT shown on this page (they go to the requester's DM).
- Deny calls the corresponding endpoint.
- Page works for already-decided requests (read-only — show audit timeline, hide buttons).
- `pnpm --filter @wep/web typecheck` passes.

## Notes

- DevOps group check: server-side enforces it, but UI hides buttons if `auth/role` says you're not in the group, to avoid an awkward 403.
- Mobile-friendly is not required.
