# 13 — API routes + server wiring

STATUS: done

## What shipped
- Server wires: CredentialDispatcher, AutoApprovalEvaluator, RequesterContextService.
- RequesterContextService is a stub (empty teams) — TODO wire to catalog teams + Identity-Center.
- Submit + Approve responses now include `credentials` when the operation issues them.
- Self-service domain re-exports the new services + types.

## Scope

Wire the new commands and services into the existing `self-service` router and the API entrypoint. Update the Zod schemas to accept the new fields. Add a route to fetch the active credentials for a request (rendered once on submit/approve, never queryable later — ensure the route refuses to return creds after first delivery).

## Files

- `domains/self-service/src/interfaces/api/routes.ts` — extend
- `apps/api/src/server.ts` — wire dispatcher + issuers + evaluator + RequesterContextService

## New / changed routes

```
POST /portal/requests             — submit (now may return credentials immediately on auto-approve)
POST /portal/requests/:id/approve — manual approve, returns credentials in response
POST /portal/requests/:id/deny    — unchanged behaviour, audit event added
POST /portal/sessions/:id/revoke  — extend to handle Postgres temp users + STS notes

GET  /portal/operations/:id       — include the new fields
GET  /portal/operations           — same
POST /portal/operations           — accept new shape via Zod
PUT  /portal/operations/:id       — same

GET  /portal/jit-resources        — include redshift type
POST /portal/jit-resources        — same
```

The submit + approve responses are the only places credentials cross the API boundary. They:

- Return them once.
- Also fan-out a Slack DM (server-side) so the client doesn't have to handle them.
- Are not stored.

## Acceptance

- Routes compile + typecheck.
- Submit response shape includes optional `credentials` for auto-approved or returns just the request for pending.
- Approve response shape includes `credentials`.
- All admin routes (operation create/update, jit-resource manage) keep using the existing `devopsOnly` middleware.
- `pnpm --filter @wep/api typecheck` passes.

## Notes

- Wire the Slack message functions to fire when relevant. Best path: handlers return a "side-effects" descriptor (request, credentials, notifyChannelIds) and the route is what actually calls Slack — keeps the domain pure.
