import { type Result, success, failure, type DomainError, domainError } from '@wep/domain-types';
import type { Operation } from '../../domain/entities/operation.js';
import type { ServiceRequest } from '../../domain/entities/service-request.js';
import type { JitResource } from '../../domain/entities/jit-resource.js';
import type { PortalRepository } from '../../domain/ports/portal-repository.js';
import { AwsActionCredentialIssuer, type AwsActionCredentials } from './aws-action-credential-issuer.js';
import { PostgresCredentialIssuer, type DbCredentials } from './postgres-credential-issuer.js';
import { RedshiftCredentialIssuer } from './redshift-credential-issuer.js';

export type IssuedCredentials = AwsActionCredentials | DbCredentials;

/**
 * Routes a request to the right credential issuer based on the operation's kind.
 * The dispatcher knows nothing about Slack — it's a pure issuance pipeline.
 */
export class CredentialDispatcher {
  constructor(
    private readonly portalRepo: PortalRepository,
    private readonly aws: AwsActionCredentialIssuer = new AwsActionCredentialIssuer(),
    private readonly postgres: PostgresCredentialIssuer = new PostgresCredentialIssuer(),
    private readonly redshift: RedshiftCredentialIssuer = new RedshiftCredentialIssuer(),
  ) {}

  async issue(operation: Operation, request: ServiceRequest): Promise<Result<IssuedCredentials, DomainError>> {
    if (operation.kind === 'aws-action') {
      return this.aws.issue(operation, request);
    }
    if (operation.kind === 'db-credentials') {
      const cfg = operation.dbCredentials;
      if (!cfg) return failure(domainError('CONFIG_MISSING', 'Operation marked db-credentials has no dbCredentials config'));
      // jitResourceId may be blank in the operation template when the user picks
      // the database at request time via a jitResourceSelector parameter.
      const jitResourceId = cfg.jitResourceId || request.parameters['jitResourceId'] || '';
      if (!jitResourceId) return failure(domainError('JIT_RESOURCE_NOT_FOUND', 'No jitResourceId in operation config or request parameters'));
      const resourceResult = await this.portalRepo.getJitResource(jitResourceId);
      if (!resourceResult.ok) return resourceResult;
      if (!resourceResult.value) return failure(domainError('JIT_RESOURCE_NOT_FOUND', `Resource ${jitResourceId} not found`));
      const resource: JitResource = resourceResult.value;
      const role = pickAllowedRole(cfg.allowedRoles, request);
      if (!role) return failure(domainError('ROLE_NOT_SELECTED', 'Request did not select an allowed role'));

      if (resource.type === 'rds-postgres') return this.postgres.issue(resource, request, role);
      if (resource.type === 'redshift') return this.redshift.issue(resource, request, role);
      return failure(domainError('UNSUPPORTED_RESOURCE', `JitResource type ${resource.type} not supported for db-credentials`));
    }
    return failure(domainError('UNSUPPORTED_KIND', `Operation kind '${operation.kind}' has no credential issuer`));
  }
}

/**
 * The operation's `dbCredentials.allowedRoles` lists roles the requester may be granted.
 * The request itself selects one via parameter `role` (or `dbUser` for Redshift). If the
 * selected value isn't on the allowlist, return null so the caller fails cleanly.
 */
const ROLE_ALIASES: Record<string, string> = {
  readonly:  'read_only',
  readwrite: 'read_write',
  read_only: 'read_only',
  read_write: 'read_write',
};

function pickAllowedRole(allowed: string[], request: ServiceRequest): string | null {
  const raw = request.parameters['role'] ?? request.parameters['dbUser'] ?? request.parameters['accessLevel'];
  if (!raw) return allowed[0] ?? null;
  const normalized = ROLE_ALIASES[raw] ?? raw;
  return allowed.includes(normalized) ? normalized : null;
}
