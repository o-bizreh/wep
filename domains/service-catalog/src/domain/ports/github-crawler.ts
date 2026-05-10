import type { Result, DomainError, CatalogErrorCode, Domain } from '@wep/domain-types';

export interface DiscoveredRepo {
  name: string;
  fullName: string;
  defaultBranch: string;
  language: string | null;
  archived: boolean;
  topics: string[];
  htmlUrl: string;
  ownerTeamSlug: string | null;
  /** Human-readable team name parsed from the repo topic (format: teamName-domain) */
  ownerTeamName: string | null;
  /** Domain parsed from the repo topic suffix */
  ownerDomain: Domain | null;
  internalDependencies: string[];
}

export interface DiscoveredTeam {
  slug: string;
  name: string;
  members: Array<{ login: string; role: 'maintainer' | 'member' }>;
}

export interface GitHubCrawlResult {
  repositories: DiscoveredRepo[];
  teams: DiscoveredTeam[];
  crawledAt: string;
}

export interface GitHubCrawler {
  crawl(org: string): Promise<Result<GitHubCrawlResult, DomainError<CatalogErrorCode>>>;
}
