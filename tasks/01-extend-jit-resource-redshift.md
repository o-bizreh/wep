# 01 — Extend JitResource with Redshift type

STATUS: done

## Scope

Add `redshift` to `JitResourceType`. Add Redshift-specific fields to the `JitResource` entity so DevOps can register a Redshift cluster in the allowlist with the data needed for `redshift:GetClusterCredentials` later.

Also add a `postgresAuth: 'temp-user' | 'iam-token'` discriminator to Postgres resources so the credential issuer can pick the strategy at runtime (default `temp-user`).

## Files

- `domains/self-service/src/domain/entities/jit-resource.ts` — extend type union + interface
- `domains/self-service/src/infrastructure/dynamodb/jit-resource-repository.ts` — extend serialize/deserialize for new fields
- `domains/self-service/src/interfaces/api/routes.ts` — extend the JIT resource Zod schema if present

## Acceptance

- `JitResourceType` includes `'redshift'` alongside existing values.
- A Redshift `JitResource` has `clusterIdentifier`, `databaseName`, `region`, `iamRoleArn` (for the platform to AssumeRole), `allowedDbUsers[]`, `maxDurationMinutes`.
- A Postgres `JitResource` has `postgresAuth`, `host`, `port`, `databaseName`, `adminSecretArn` (for temp-user strategy), `allowedRoles[]`, `maxDurationMinutes`.
- `pnpm --filter @wep/self-service typecheck` passes.

## Notes

- Don't break existing `rds-postgres`/`ec2-ssh` rows. Default missing fields gracefully on deserialize.
- `iamRoleArn` for Redshift is the role *the platform* uses to call `GetClusterCredentials` — not the role the user assumes.
