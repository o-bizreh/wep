# 09 — Submit handler integration with auto-approval + creds

STATUS: done

## Changed return type
- `SubmitRequestHandler.execute` now returns `Result<SubmitRequestResult, DomainError>` where `SubmitRequestResult = { request, credentials? }`. Caller (route, task 13) unwraps the credentials and forwards to Slack DM, then drops them.

## Scope

Modify `SubmitRequestHandler` (or whatever the existing submit command is) to:

1. Look up the operation; reject if disabled or unknown.
2. Build `RequesterContext` for the submitter.
3. Run `AutoApprovalEvaluator`. If a rule matches:
   - Append `auto-approved` audit event with rule description.
   - Invoke the right credential issuer for the operation's category.
   - Append `fulfilled` audit event.
   - Return creds + the request (status: `approved`).
4. Else create `pending-approval` request with `submitted` audit event. Return without creds.

## Files

- `domains/self-service/src/application/commands/submit-request.ts` (likely existing — modify)
- `domains/self-service/src/application/services/credential-dispatcher.ts` (new — small router that picks the right issuer based on `operation.category`)

## Behaviour

```ts
async submit(input: SubmitRequestInput): Promise<SubmitRequestResult> {
  const op = await this.operations.get(input.operationId);
  if (!op || !op.enabled) return failure('OPERATION_NOT_AVAILABLE');

  const ctx = await this.requesterContext.resolve(input.requesterArn, input.requesterEmail);
  const request = createRequest({ ...input, audit: [{ at: now, actor: input.requesterArn, type: 'submitted' }] });

  const matched = this.evaluator.evaluate(op, request, ctx);
  if (matched) {
    request.approvalMode = 'auto';
    request.autoApprovalRuleDescription = matched.description;
    request.audit.push({ at: now, actor: 'system', type: 'auto-approved', detail: matched.description });
    await this.requests.save({ ...request, status: 'approved' });
    const creds = await this.credentialDispatcher.issue(op, request);
    request.audit.push({ at: now, actor: 'system', type: 'fulfilled' });
    request.expiresAt = creds.expiresAt;
    await this.requests.save({ ...request, status: 'completed' });
    return success({ request, credentials: creds });
  }

  await this.requests.save({ ...request, status: 'pending-approval' });
  return success({ request });
}
```

## Acceptance

- Auto-approval and manual paths covered. Both paths persist audit trail.
- Credential dispatcher routes by category to the right issuer.
- Existing tests (if any) for submission still pass.
- `pnpm --filter @wep/self-service typecheck` passes.

## Notes

- Don't return credentials in the response of a manual flow — only after approval.
- Slack notification is fired from this handler too (next task wires the message builder).
