# 05 — DynamoDB serialization for new fields

STATUS: done

## Outcome
- Operation reads now go through `normalizeOperation` which fills `kind: 'runbook'` for legacy rows.
- ServiceRequest, JitResource: all new fields are optional and round-trip through DynamoDB without further mapping.

## Scope

If the repository changes in tasks 01–04 weren't already complete, finish them here. Cross-cut: ensure all new optional fields serialize and deserialize with backward-compatible defaults so existing rows in DynamoDB don't break.

## Files

- `domains/self-service/src/infrastructure/dynamodb/operation-repository.ts`
- `domains/self-service/src/infrastructure/dynamodb/service-request-repository.ts`
- `domains/self-service/src/infrastructure/dynamodb/jit-resource-repository.ts`

## Acceptance

- Reading existing rows produces valid entities with sensible defaults for any missing fields.
- Writing new entities round-trips cleanly.
- `pnpm --filter @wep/self-service typecheck` passes.

## Notes

- DynamoDB has no migrations. Defaults must be applied at the deserialize boundary.
- Audit list defaults to `[]`. Category defaults to `'runbook'`. AutoApproval defaults to `undefined`.
