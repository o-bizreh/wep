import {
  type Result,
  success,
  failure,
  type DomainError,
  domainError,
  CatalogErrorCode,
  type Domain,
} from '@wep/domain-types';

export interface TeamMember {
  userId: string;
  role: 'lead' | 'member';
}

export interface Team {
  teamId: string;
  teamName: string;
  domain: Domain;
  githubTeamSlug: string;
  slackChannelId: string;
  members: TeamMember[];
  serviceIds: string[];
}

export interface CreateTeamInput {
  teamName: string;
  domain: Domain;
  githubTeamSlug: string;
  slackChannelId: string;
  members?: TeamMember[];
}

export function generateTeamId(githubTeamSlug: string): string {
  return `team_${githubTeamSlug}`;
}

export function createTeam(input: CreateTeamInput): Result<Team, DomainError<CatalogErrorCode>> {
  if (!input.teamName.trim()) {
    return failure(domainError(CatalogErrorCode.INVALID_INPUT, 'Team name cannot be empty'));
  }

  if (!input.githubTeamSlug.trim()) {
    return failure(domainError(CatalogErrorCode.INVALID_INPUT, 'GitHub team slug cannot be empty'));
  }

  return success({
    teamId: generateTeamId(input.githubTeamSlug),
    teamName: input.teamName,
    domain: input.domain,
    githubTeamSlug: input.githubTeamSlug,
    slackChannelId: input.slackChannelId,
    members: input.members ?? [],
    serviceIds: [],
  });
}
