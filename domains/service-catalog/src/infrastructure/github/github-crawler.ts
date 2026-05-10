import {
  type Result,
  success,
  failure,
  domainError,
  CatalogErrorCode,
  type DomainError,
  Domain,
} from '@wep/domain-types';
import { GitHubClient } from '@wep/github-client';
import type {
  GitHubCrawler,
  GitHubCrawlResult,
  DiscoveredRepo,
  DiscoveredTeam,
} from '../../domain/ports/github-crawler.js';

/** Maps the domain suffix in a topic (e.g. "domain", "customer") to the Domain enum value. */
const DOMAIN_SUFFIX_MAP: Record<string, Domain> = {
  domain: Domain.DEVOPS,   // generic "-domain" suffix used across Washmen repos
  customer: Domain.CUSTOMER,
  payment: Domain.PAYMENT,
  payments: Domain.PAYMENT,
  data: Domain.DATA,
  devops: Domain.DEVOPS,
  platform: Domain.DEVOPS,
};

/**
 * Parses a GitHub topic with the format `teamName-domain`.
 * Returns { teamName, domain } or null if the topic doesn't match.
 *
 * Examples:
 *   "payments-customer"  → { teamName: "Payments", domain: "CustomerDomain" }
 *   "platform-devops"    → { teamName: "Platform", domain: "DevOps" }
 */
function parseOwnerTopic(topics: string[]): { teamName: string; domain: Domain } | null {
  for (const topic of topics) {
    const lastDash = topic.lastIndexOf('-');
    if (lastDash === -1) continue;

    const suffix = topic.slice(lastDash + 1).toLowerCase();
    const domain = DOMAIN_SUFFIX_MAP[suffix];
    if (!domain) continue;

    const teamName = topic.slice(0, lastDash); // e.g. "payments" from "payments-customer"
    return { teamName, domain };
  }
  return null;
}

export class GitHubOrgCrawler implements GitHubCrawler {
  constructor(private readonly client: GitHubClient = new GitHubClient()) {}

  async crawl(org: string): Promise<Result<GitHubCrawlResult, DomainError<CatalogErrorCode>>> {
    const reposResult = await this.client.listOrgRepos(org);
    if (!reposResult.ok) {
      return failure(domainError(CatalogErrorCode.SYNC_FAILED, 'Failed to crawl repos', {
        cause: reposResult.error.message,
      }));
    }

    const teamsResult = await this.client.listOrgTeams(org);
    if (!teamsResult.ok) {
      return failure(domainError(CatalogErrorCode.SYNC_FAILED, 'Failed to crawl teams', {
        cause: teamsResult.error.message,
      }));
    }

    const discoveredTeams: DiscoveredTeam[] = [];
    for (const team of teamsResult.value) {
      if (this.client.getRateLimitRemaining() < 100) break;

      const membersResult = await this.client.getTeamMembers(org, team.slug);
      discoveredTeams.push({
        slug: team.slug,
        name: team.name,
        members: membersResult.ok
          ? membersResult.value.map((m) => ({ login: m.login, role: m.role }))
          : [],
      });
    }

    const discoveredRepos: DiscoveredRepo[] = reposResult.value.filter((repo) => {
      // Skip npm packages (sails-* are Sails.js framework packages, not deployable services)
      if (repo.name.startsWith('sails-')) return false;
      return true;
    }).map((repo) => {
      const owner = parseOwnerTopic(repo.topics);
      return {
        ...repo,
        ownerTeamSlug: owner?.teamName ?? null,
        ownerTeamName: owner?.teamName ?? null,
        ownerDomain: owner?.domain ?? null,
        internalDependencies: [],
      };
    });

    return success({
      repositories: discoveredRepos,
      teams: discoveredTeams,
      crawledAt: new Date().toISOString(),
    });
  }
}
