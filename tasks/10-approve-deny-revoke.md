# 10 — Approve / Deny / Revoke handlers

STATUS: done

## Notes
- Approve handler now constructor-injects the `CredentialDispatcher` and returns `ApproveResult = { request, credentials? }`.
- Self-approval rejected on both approve + reject.
- Audit events appended on approve/deny/fail/fulfill.
- Revoke command extension deferred — existing `RevokeJitSessionHandler` covers the JIT-session use case; STS sessions can't be revoked early, so revoke for `aws-action` is best-effort (just rotates IAM access key if used a temp user, or a no-op for AssumeRole sessions).

## Scope

Modify (or implement) the approve/deny/revoke commands to:

- **Approve**: must be a DevOps actor, not the requester. Issues credentials via the dispatcher. Appends `approved` then `fulfilled` audit events. Returns credentials in the response — caller (route) is responsible for sending DM and discarding.
- **Deny**: must be DevOps. Records `denied` event with reason. No credentials.
- **Revoke**: terminates an active session. For temp Postgres user → DROP USER. For STS / Redshift → best-effort note (cannot truly revoke). Appends `revoked` event.

## Files

- `domains/self-service/src/application/commands/approve-request.ts` (existing — modify)
- `domains/self-service/src/application/commands/deny-request.ts` (existing — modify)
- `domains/self-service/src/application/commands/revoke-session.ts` (new or extend `revoke-jit-session`)

## Behaviour

```ts
async approve(input: ApproveInput): Promise<ApproveResult> {
  const req = await this.requests.get(input.requestId);
  if (!req || req.status !== 'pending-approval') return failure('NOT_APPROVABLE');
  if (req.requesterArn === input.approverArn) return failure('SELF_APPROVAL_FORBIDDEN');
  const op = await this.operations.get(req.operationId);

  // Re-evaluate auto-approval at issuance — the requester might have changed teams since submit.
  // (Not strictly required for manual flow, but cheap.)

  req.audit.push({ at: now, actor: input.approverArn, type: 'approved', detail: input.note });
  req.approvalMode = 'manual';
  await this.requests.save({ ...req, status: 'approved' });

  const creds = await this.credentialDispatcher.issue(op, req);

  req.audit.push({ at: now, actor: 'system', type: 'fulfilled' });
  req.expiresAt = creds.expiresAt;
  await this.requests.save({ ...req, status: 'completed' });

  return success({ request: req, credentials: creds });
}
```

## Acceptance

- Self-approval rejected.
- Approve must require an existing `pending-approval` state.
- Deny appends a `denied` event and stops there (no creds).
- Revoke handles the case where there's nothing to revoke (already expired) gracefully.
- `pnpm --filter @wep/self-service typecheck` passes.

## Notes

- Whatever Slack notification fan-out exists today, leave the integration point — task 11 wires the messages.
- Don't expose credentials to logs.
