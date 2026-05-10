# 08 — AutoApprovalEvaluator + RequesterContextService

STATUS: done

## Scope

Two services:

1. **`RequesterContextService`** — given a platform login (email/ARN), returns `{ teamIds: string[]; domain: Domain | null; awsArn: string }`. Pulls team membership from the catalog teams + a manual `email → githubUsername` mapping (start with a hard-coded map, leave room for IdC later).

2. **`AutoApprovalEvaluator`** — given an `Operation` (with `autoApproval`), the `ServiceRequest`, and a `RequesterContext`, returns either `{ matched: AutoApprovalRule } | null`.

## Files

- `domains/self-service/src/application/services/requester-context-service.ts` (new)
- `domains/self-service/src/application/services/auto-approval-evaluator.ts` (new)

## Evaluator logic

```ts
function evaluate(op: Operation, req: ServiceRequest, ctx: RequesterContext): AutoApprovalRule | null {
  if (!op.autoApproval?.enabled) return null;
  for (const rule of op.autoApproval.rules) {
    if (!matchPasses(rule.match, req, ctx)) continue;
    if (!constraintsPass(rule.constraints, req, ctx)) continue;
    return rule;
  }
  return null;
}
```

Match logic:
- `requesterDomain` — any of the listed domains is in `ctx.domain` (single value match).
- `requesterTeamId` — set intersection with `ctx.teamIds` non-empty.
- `parameterEquals` — for every key in the rule, `req.parameters[key]` must equal one of the listed values.

Constraints:
- `maxDurationMinutes` — `req.durationMinutes <= constraint`.
- `workingHoursOnly` — UTC hour in 09–18 AND day not Sat/Sun.
- `excludeRequesterIds` — `req.requesterArn` not in list.
- `maxConcurrentSessionsForRequester` — needs `JitSessionRepository.countActiveByRequester` (use existing port if present, else inject a counter callback).

## Acceptance

- Evaluator is a pure function (no I/O); takes context and returns a decision.
- Constraint failures return `null` (not error) so the request falls through to manual approval.
- Unit-friendly — no AWS or DB calls inside.
- `pnpm --filter @wep/self-service typecheck` passes.

## Notes

- The evaluator never throws on missing optional fields; missing means "skip this match condition".
- `RequesterContextService` returns `domain: null` if the user can't be resolved — auto-approval rules that require a domain will then never match. Safe default.
