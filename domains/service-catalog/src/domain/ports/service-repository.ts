import type {
  Result,
  DomainError,
  CatalogErrorCode,
  PaginatedRequest,
  PaginatedResponse,
  Environment,
} from '@wep/domain-types';
import type { Service } from '../entities/service.js';

export interface ServiceRepository {
  save(service: Service): Promise<Result<void, DomainError<CatalogErrorCode>>>;
  findById(serviceId: string): Promise<Result<Service | null, DomainError<CatalogErrorCode>>>;
  findByTeam(
    teamId: string,
    pagination: PaginatedRequest,
  ): Promise<Result<PaginatedResponse<Service>, DomainError<CatalogErrorCode>>>;
  findByEnvironment(
    environment: Environment,
    pagination: PaginatedRequest,
  ): Promise<Result<PaginatedResponse<Service>, DomainError<CatalogErrorCode>>>;
  searchByName(
    prefix: string,
    pagination: PaginatedRequest,
  ): Promise<Result<PaginatedResponse<Service>, DomainError<CatalogErrorCode>>>;
  findAll(
    pagination: PaginatedRequest,
  ): Promise<Result<PaginatedResponse<Service>, DomainError<CatalogErrorCode>>>;
  delete(serviceId: string): Promise<Result<void, DomainError<CatalogErrorCode>>>;
}
