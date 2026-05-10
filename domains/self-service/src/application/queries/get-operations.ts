import type { Result, DomainError } from '@wep/domain-types';
import type { Operation } from '../../domain/entities/operation.js';
import type { PortalRepository } from '../../domain/ports/portal-repository.js';

export class GetOperationCatalogHandler {
  constructor(private readonly portalRepo: PortalRepository) {}

  async execute(): Promise<Result<Operation[], DomainError>> {
    return this.portalRepo.listOperations();
  }
}
