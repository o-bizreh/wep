import type {
  Result,
  DomainError,
  CatalogErrorCode,
  PaginatedRequest,
  PaginatedResponse,
  Environment,
} from '@wep/domain-types';
import type { Service } from '../../domain/entities/service.js';
import type { ServiceRepository } from '../../domain/ports/service-repository.js';

export interface SearchServicesQuery {
  query?: string;
  teamId?: string;
  environment?: Environment;
  pagination: PaginatedRequest;
}

export class SearchServicesHandler {
  constructor(private readonly serviceRepo: ServiceRepository) {}

  async execute(
    query: SearchServicesQuery,
  ): Promise<Result<PaginatedResponse<Service>, DomainError<CatalogErrorCode>>> {
    if (query.teamId) {
      return this.serviceRepo.findByTeam(query.teamId, query.pagination);
    }

    if (query.environment) {
      return this.serviceRepo.findByEnvironment(query.environment, query.pagination);
    }

    if (query.query) {
      return this.serviceRepo.searchByName(query.query, query.pagination);
    }

    return this.serviceRepo.findAll(query.pagination);
  }
}
