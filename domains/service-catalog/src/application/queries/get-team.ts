import {
  type Result,
  failure,
  domainError,
  CatalogErrorCode,
  type DomainError,
  type Domain,
} from '@wep/domain-types';
import type { Team } from '../../domain/entities/team.js';
import type { TeamRepository } from '../../domain/ports/team-repository.js';

export class GetTeamHandler {
  constructor(private readonly teamRepo: TeamRepository) {}

  async execute(teamId: string): Promise<Result<Team, DomainError<CatalogErrorCode>>> {
    const result = await this.teamRepo.findById(teamId);
    if (!result.ok) return result;
    if (!result.value) {
      return failure(domainError(CatalogErrorCode.TEAM_NOT_FOUND, `Team ${teamId} not found`));
    }
    return { ok: true, value: result.value };
  }
}

export class ListTeamsHandler {
  constructor(private readonly teamRepo: TeamRepository) {}

  async execute(domain?: Domain): Promise<Result<Team[], DomainError<CatalogErrorCode>>> {
    if (domain) {
      return this.teamRepo.findByDomain(domain);
    }
    return this.teamRepo.findAll();
  }
}
