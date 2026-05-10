# 06 — AwsActionCredentialIssuer

STATUS: done

## Note
- Console federation URL is stubbed (returns undefined). Implementation deferred — needs the signin.aws.amazon.com/federation flow which is one extra fetch per issuance.

## Scope

Service that, given an `Operation` with `category='aws-action'` and an approved `ServiceRequest`, calls STS to mint short-lived credentials.

## Files

- `domains/self-service/src/application/services/aws-action-credential-issuer.ts` (new)
- `packages/shared/aws-clients/src/index.ts` — re-export `STSClient`/`AssumeRoleCommand` if not already present

## Behaviour

```ts
class AwsActionCredentialIssuer {
  async issue(operation: Operation, request: ServiceRequest): Promise<AwsActionCredentials> {
    // 1. Render session policy template, substituting ${param.foo} from request.parameters
    // 2. Call STS:AssumeRole with:
    //    - RoleArn: operation.awsAction.iamRoleArn
    //    - RoleSessionName: sanitize(request.requesterAwsUsername)
    //    - DurationSeconds: min(request.durationMinutes * 60, operation.awsAction.maxDurationMinutes * 60, 12*3600)
    //    - Policy: rendered session policy
    // 3. (Optional) If operation.awsAction.issueConsoleLink, build a federation URL via federation API
    // 4. Return { accessKeyId, secretAccessKey, sessionToken, expiresAt, consoleUrl? }
  }
}
```

## Acceptance

- Issuer throws clear errors on: missing role ARN, invalid session-policy JSON, STS failure.
- Session-policy templating uses a pure function (testable). Placeholder syntax `${param.foo}` substitutes from `request.parameters`.
- Sanitization on `RoleSessionName`: alphanum + `=,.@_-`, max 64 chars (STS limits).
- `pnpm --filter @wep/self-service typecheck` passes.

## Notes

- Console federation URL: optional v1.5. Skip if it complicates this task — comment the integration point.
- Don't log the credentials. Anywhere.
