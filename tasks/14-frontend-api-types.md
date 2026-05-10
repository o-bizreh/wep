# 14 — Frontend API client types

STATUS: done

## Note
- Existing portal pages already use locally-typed `ServiceRequest`. They don't unwrap the new `{ request, credentials? }` response shape so they keep compiling. Pages that need the new fields will use the `Portal*` types added in this task.

## Scope

Mirror the backend type extensions on the frontend so the existing portal pages compile against the new shapes.

## Files

- `apps/web/src/lib/api.ts`

## Additions

```ts
export type OperationCategory = 'aws-action' | 'db-credentials' | 'runbook';
export type RequestApprovalMode = 'manual' | 'auto';
export type RequestAuditEventType = 'submitted' | 'auto-approved' | 'approved' | 'denied' | 'fulfilled' | 'failed' | 'revoked' | 'expired';

export interface AutoApprovalRule { /* ...from task 03 */ }

export interface AwsActionConfig { iamRoleArn: string; sessionPolicyTemplate: string; maxDurationMinutes: number; issueConsoleLink?: boolean }
export interface DbCredentialsConfig { jitResourceId: string; allowedRoles: string[]; maxDurationMinutes: number }

export interface Operation {
  // ...existing
  category: OperationCategory;
  awsAction?: AwsActionConfig;
  dbCredentials?: DbCredentialsConfig;
  autoApproval?: { enabled: boolean; rules: AutoApprovalRule[] };
}

export interface RequestAuditEvent { at: string; actor: string; type: RequestAuditEventType; detail?: string }

export interface ServiceRequest {
  // ...existing
  approvalMode?: RequestApprovalMode;
  autoApprovalRuleDescription?: string;
  requesterAwsUsername?: string;
  durationMinutes: number;
  expiresAt?: string;
  audit: RequestAuditEvent[];
}

export interface IssuedCredentials {
  type: 'aws-action' | 'postgres' | 'redshift';
  expiresAt: string;
  // AWS action:
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  consoleUrl?: string;
  // DB:
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
}

export interface SubmitRequestResponse {
  request: ServiceRequest;
  credentials?: IssuedCredentials;  // present only for auto-approved
}
```

Add corresponding API client methods if missing.

## Acceptance

- `pnpm --filter @wep/web typecheck` passes (existing pages may need defensive `?.` for newly-optional fields).
