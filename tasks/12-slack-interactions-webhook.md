# 12 — Slack interactions webhook

STATUS: done

## Note
- Stub endpoint with full signature verification — accepts payloads but returns 200 for the only currently-handled action_id (`act:view_request`). Inline approve/deny buttons can be added later by extending the dispatcher.

## Scope

Endpoint that receives Slack interaction payloads (button clicks). Verifies the Slack signing secret, dispatches based on the action_id.

Even though v1 prefers web-based approval (safer), we need the endpoint live so the View Request button works as a "pre-auth deep link" rather than a button. Inline approve/deny remain a follow-up.

## Files

- `apps/api/src/routes/slack-interactions-router.ts` (new)
- `apps/api/src/server.ts` — wire route at `/api/v1/slack/interactions`

## Behaviour

- Express middleware to capture raw body for signature verification (Slack signs the raw body).
- Verify `X-Slack-Signature` and `X-Slack-Request-Timestamp` against the signing secret in env (`SLACK_SIGNING_SECRET`).
- Reject if timestamp is older than 5 min (replay protection).
- Parse the URL-encoded `payload`. Dispatch by `actions[0].action_id`:
  - `act:view_request` — no-op (the button already navigates the user); return 200.
  - (Future) `act:approve_inline` / `act:deny_inline` — check operation policy then approve/deny.
- Always respond 200 within 3s (Slack's deadline) — long-running work goes to a background async.

## Acceptance

- Endpoint compiles, type-checks, and 401s a request with a bad signature.
- A signed test payload (using a known signing secret) returns 200.
- `pnpm --filter @wep/api typecheck` passes.

## Notes

- The View Request button is a `link_button` so technically it doesn't even hit our webhook. The webhook is needed only when we add inline approve/deny. Wire the skeleton anyway.
- Don't log payload bodies.
