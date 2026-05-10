# Act Tab Overhaul — Task Plan

Overhauls the Act tab so DevOps publishes a catalog of allowed actions, engineers self-serve via a form,
the platform auto-approves matching requests or routes the rest to Slack-based DevOps approval, and short-lived
credentials are issued and DM'd directly to the requester. See the conversation history for the full design plan.

Build on the existing `domains/self-service` domain — extend, don't replace.

## Execution order + status

Tasks are numbered. Each is self-contained and type-checks independently.

| # | Task | Phase | Status |
|---|---|---|---|
| 01 | Extend JitResource with Redshift type | Domain | done |
| 02 | Extend Operation with kind + aws-action + db-credentials fields | Domain | done |
| 03 | Add AutoApprovalRule value object + autoApproval on Operation | Domain | done |
| 04 | Extend ServiceRequest with approvalMode + audit events | Domain | done |
| 05 | Update DynamoDB serialization for new fields | Infra | done |
| 06 | AwsActionCredentialIssuer (STS AssumeRole) | Services | done |
| 07 | PostgresCredentialIssuer + RedshiftCredentialIssuer | Services | done |
| 08 | AutoApprovalEvaluator + RequesterContextService | Services | done |
| 09 | Submit handler integration (auto-approval path + creds) | Application | done |
| 10 | Approve / Deny / Revoke handlers with creds + audit | Application | done |
| 11 | Slack notification builders (channel + DM + audit) | Slack | done |
| 12 | Slack interactions webhook (signature + button dispatch) | Slack | done |
| 13 | API routes + server wiring | Interfaces | done |
| 14 | Frontend API client types | Web | done |
| 15 | Approval landing page (/portal/approve/:id) | Web | done |
| 16 | Update PortalRequestPage + PortalRequestsPage + OperationFormPage | Web | done |
| 17 | Active Credentials page (renamed from JitSessions) | Web | done |
| 18 | Nav updates + final type-check | Polish | done |

## Top-level deferrals (open follow-ups)

Status as of 2026-05-01. Items 1–3 shipped along with task 16/17 above.

1. ~~Form fields on PortalRequestPage to send `requesterAwsUsername` + `durationMinutes`.~~ **Done** — fields render only for `aws-action` / `db-credentials` operations; `awsUsername` pre-fills from the user's profile.
2. ~~Auto-approval rule editor in PortalOperationFormPage.~~ **Done** — full form-based editor with multi-rule support, parameter constraints, and tag-match. No more raw JSON.
3. ~~Active Credentials page enhancements.~~ **Done** — page renamed, each row now shows approval mode (auto/manual badge), the auto-approval rule that fired, and the originating operation name; backend joins `JitSession → ServiceRequest` server-side.
4. **IdentityStore verification** — partially wired on 2026-05-01. `POST /portal/profile/auto-resolve` calls `identitystore:DescribeUser` and persists `Title` (used as `userType`) + `awsUsername` + `displayName` with `source: 'identitystore'`. Department remains manual (group → department mapping was tried and removed; IAM policies enforce correctness).
5. **Postgres IAM auth strategy** — `iam-token` still returns `NOT_IMPLEMENTED`.
6. **Console federation URL** for AWS-action operations.
7. **Inline Slack approve/deny buttons** — webhook + signature verification ship; dispatch is a switch waiting for cases.
8. **Cleanup Lambda** for expired Postgres temp users — `VALID UNTIL` enforces auth failure regardless.

## Portfolio features (added 2026-05-01)

Six pages ported from the AWS utilization portal:

| Page | Path | Backend |
|---|---|---|
| Executive Summary | `/costs/executive` | composes `costs/overview` + `portfolio/recommendations` + `portfolio/budgets` |
| Cost Comparison | `/costs/comparison` | `GET /portfolio/cost-comparison` (Cost Explorer month-over-month) |
| Recommendations | `/costs/recommendations` | `GET /portfolio/recommendations` (Lambda/ECS/RDS/DynamoDB rightsizing) |
| Budgets | `/costs/budgets` | `GET/POST/DELETE /portfolio/budgets` + `/budgets/status` (DynamoDB-backed) |
| Dependency Map | `/catalog/dependencies` | `GET /portfolio/dependencies/lambda` + `/dependencies/ecs` (env-var ARN scanning) |
| Coupling Detector | `/catalog/coupling` | `GET /portfolio/coupling/clusters/:cluster` (shared-infra surfacing) |

## Auto-approval — what's wired vs deferred

**Wired and working** end-to-end:
- `requesterDepartment` — matches against `WepUserProfile.department` (set in Settings).
- `requesterUserType` — matches against `WepUserProfile.userType` (set in Settings).
- `parameterEquals` — matches request parameters.
- `resourceOwnerTagEquals` — reads target ARN's tags via `ResourceGroupsTaggingAPI`. Supports literal value or `$requesterDepartment` for cross-field matching.
- All constraints: `maxDurationMinutes`, `workingHoursOnly`, `excludeRequesterIds`.

**Wired with caveat**:
- `requesterDomain` / `requesterTeamId` — legacy fields; the resolver derives `domain` from `department.toLowerCase()`. Use the new fields for new rules.

**Deferred**:
- `maxConcurrentSessionsForRequester` — needs the `ActiveSessionsCounter` port wired to the JIT session store.

## Open questions (defaults applied where unanswered)

| # | Question | Default chosen |
|---|---|---|
| 1 | AWS username format | Free-form text — used as `RoleSessionName` for CloudTrail audit |
| 2 | Postgres mechanism | Temp-DB-user strategy (more universal). IAM-token strategy left as a TODO interface impl. |
| 3 | Redshift role | `redshift:GetClusterCredentials` with `AutoCreate: true` |
| 4 | Slack inline buttons | Web-only for v1 (safer). Inline buttons hookable later via the same handler. |
| 5 | Audit channel routing | Single global default; per-template override field |
| 6 | Default duration cap | 60 min default, 12h hard max |
| 7 | Expiry notification | Not in v1 (TODO) |
| 8 | Existing operation migration | Default existing rows to `category: 'runbook'` |
| 9 | Templates v1 | None pre-baked; DevOps creates them via the manage UI |
| 10 | Domain/team source | Existing catalog teams + manual `email → githubUsername` mapping. TODO: Identity Center sync. |
| 11 | Auto-approval rule preview | Evaluated at submission only; UI shows hint based on cached team membership |
| 12 | Auto-approval audit retention | Same as manual (DynamoDB TTL not configured here) |
| 13 | Re-check membership at issuance | Yes — evaluator runs again before issuing creds |

## Conventions

- All credential generation is **just-in-time, never persisted**. Creds appear in API response → Slack DM → memory cleared.
- All state changes append an entry to `ServiceRequest.audit[]`.
- Auto-approval is **opt-in per template** — default is manual.
- Per-template `autoApproval.enabled` flag is the kill-switch.
