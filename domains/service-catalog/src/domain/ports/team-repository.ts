import type { Result, DomainError, CatalogErrorCode, Domain } from '@wep/domain-types';
import type { Team } from '../entities/team.js';

export interface TeamRepository {
  save(team: Team): Promise<Result<void, DomainError<CatalogErrorCode>>>;
  findById(teamId: string): Promise<Result<Team | null, DomainError<CatalogErrorCode>>>;
  findByDomain(domain: Domain): Promise<Result<Team[], DomainError<CatalogErrorCode>>>;
  findAll(): Promise<Result<Team[], DomainError<CatalogErrorCode>>>;
}
