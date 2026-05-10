# 07 — Postgres + Redshift credential issuers

STATUS: done

## Notes
- Postgres `iam-token` strategy is stubbed (returns NOT_IMPLEMENTED). Temp-user is the v1 path.
- Redshift cluster endpoint resolved via `DescribeClusters` if not already on the JitResource.
- Cleanup of Postgres temp users left for a follow-up Lambda; `VALID UNTIL` enforces auth failure at the DB regardless.

## Scope

Two services that issue short-lived database credentials.

## Files

- `domains/self-service/src/application/services/postgres-credential-issuer.ts` (new)
- `domains/self-service/src/application/services/redshift-credential-issuer.ts` (new)
- `packages/shared/aws-clients/src/index.ts` — re-export `RedshiftClient` + `GetClusterCredentialsCommand` if not already present

## Postgres (temp-user strategy first)

```ts
class PostgresCredentialIssuer {
  async issue(jitResource: JitResource, request: ServiceRequest, role: string): Promise<DbCredentials> {
    if (jitResource.postgresAuth === 'iam-token') {
      // TODO future: rds:generate-db-auth-token. Stub with 501 for now.
      throw new Error('IAM-token auth not yet implemented');
    }
    // temp-user strategy:
    // 1. Fetch admin password from Secrets Manager (jitResource.adminSecretArn)
    // 2. Connect via `pg`
    // 3. Generate temp username `wep_<short-id>` + random password
    // 4. CREATE USER ... WITH PASSWORD '...' VALID UNTIL '<expiry>'
    // 5. GRANT <role> TO <tempUser>
    // 6. Disconnect, return { host, port, database, username, password, expiresAt }
  }
}
```

## Redshift (GetClusterCredentials)

```ts
class RedshiftCredentialIssuer {
  async issue(jitResource: JitResource, request: ServiceRequest, dbUser: string): Promise<DbCredentials> {
    // 1. Validate dbUser is in jitResource.allowedDbUsers
    // 2. STS AssumeRole into jitResource.iamRoleArn
    // 3. Create RedshiftClient with assumed creds
    // 4. GetClusterCredentials({ ClusterIdentifier, DbUser, DbName, DurationSeconds, AutoCreate: true })
    // 5. Return { host, port, database, username (DbUser), password (DBPassword), expiresAt }
  }
}
```

## Acceptance

- Both issuers compile and pass typecheck.
- Postgres temp-user generates valid SQL (proper quoting, parameterised values where safe — note: CREATE USER doesn't accept parameters so we hand-quote the username; password too).
- Sanitize generated identifiers strictly (`[a-z0-9_]{20,32}`).
- `pnpm --filter @wep/self-service typecheck` + `pnpm --filter @wep/aws-clients build` pass.

## Notes

- `pg` package: add to `domains/self-service/package.json` if not present.
- The Redshift client uses an AssumeRole because the platform's main role likely shouldn't have `redshift:GetClusterCredentials` directly; the per-cluster role has it.
- Cleanup of expired temp users: leave for a follow-up Lambda. `VALID UNTIL` makes auth fail at the DB level even if the user lingers.
