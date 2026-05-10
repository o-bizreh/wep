# 11 — Slack notification builders

STATUS: done

## Notes
- Added `awsActionCredentialDM` and `dbCredentialsDM` block-kit templates to `@wep/slack-notifier`.
- DM delivery wired into the routes (`deliverCredentialsDm`) — fires after submit (auto-approve case) or approve (manual case).
- Uses existing `SlackNotifier.resolveUserIdByEmail` + `sendDM`.
- Existing `portalRequestNotification` and `portalApprovalNotification` reused for channel posts.
- An auto-approval-specific outcome message variant could be added later — for now the DM itself communicates "auto-approved" via its header.

## Scope

Three message templates, all built on the existing `@wep/slack-notifier`:

1. **Channel approval request** — Block Kit message posted to the operation's `approvalChannelId` (or global default). Has summary fields and a "View Request" link button to `/portal/approve/:id`.
2. **Channel auto-approval / outcome notification** — posted to the operation's `auditChannelId`. Visually distinct (✅ vs 🔧). For auto-approvals: includes the matched rule description.
3. **Direct message — credential delivery** — sent to the requester's Slack user (need email→slackUserId lookup). Wrapped credentials in a code block with a strong "expires at X / do not share" header.

## Files

- `packages/shared/slack-notifier/src/templates/act-approval-request.ts` (new)
- `packages/shared/slack-notifier/src/templates/act-outcome.ts` (new)
- `packages/shared/slack-notifier/src/templates/act-credentials-dm.ts` (new)
- `packages/shared/slack-notifier/src/index.ts` — export new functions

## Behaviour

```ts
buildApprovalRequestMessage(req, op, baseUrl): KnownBlock[]
buildOutcomeMessage(req, op, kind: 'auto-approved' | 'approved' | 'denied' | 'revoked'): KnownBlock[]
buildCredentialDmMessage(creds, op, req): KnownBlock[]
```

Add helpers to send to a channel and to DM a user (via `chat.postMessage` / `conversations.open` + `chat.postMessage`).

## Acceptance

- Templates compile under TS strict.
- Functions accept domain types, not raw strings, so they're hard to misuse.
- Wired into approve/deny/submit handlers (or the route that calls them) — when a request enters a state, the right message goes out.
- Sensitive fields never in channel posts; DM only.
- `pnpm --filter @wep/slack-notifier build` passes.

## Notes

- The Slack user ID lookup may need a separate service; for v1, store `slackUserId` on the user when they log in (best path) or look up by email via Slack API.
- Save the channel `ts` of the approval-request message on `ServiceRequest.slackApprovalMessageTs` so we can edit it on outcome (turn green/red) — see task 12 for the edit path.
