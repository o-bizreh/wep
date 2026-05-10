import {
  type Result,
  success,
  failure,
  domainError,
  CatalogErrorCode,
  type DomainError,
  type Domain,
} from '@wep/domain-types';
import { type DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } from '@wep/aws-clients';
import type { Team } from '../../domain/entities/team.js';
import type { TeamRepository } from '../../domain/ports/team-repository.js';

export class DynamoDBTeamRepository implements TeamRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async save(team: Team): Promise<Result<void, DomainError<CatalogErrorCode>>> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            PK: `TEAM#${team.teamId}`,
            SK: 'METADATA',
            GSI1PK: `DOMAIN#${team.domain}`,
            GSI1SK: `TEAM#${team.teamName}`,
            ...team,
          },
        }),
      );
      return success(undefined);
    } catch (error) {
      return failure(domainError(CatalogErrorCode.SYNC_FAILED, 'Failed to save team', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async findById(teamId: string): Promise<Result<Team | null, DomainError<CatalogErrorCode>>> {
    try {
      const result = await this.client.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { PK: `TEAM#${teamId}`, SK: 'METADATA' },
        }),
      );
      if (!result.Item) return success(null);
      return success(this.deserialize(result.Item));
    } catch (error) {
      return failure(domainError(CatalogErrorCode.SYNC_FAILED, 'Failed to fetch team', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async findByDomain(domain: Domain): Promise<Result<Team[], DomainError<CatalogErrorCode>>> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :pk',
          ExpressionAttributeValues: { ':pk': `DOMAIN#${domain}` },
        }),
      );
      return success((result.Items ?? []).map((item) => this.deserialize(item)));
    } catch (error) {
      return failure(domainError(CatalogErrorCode.SYNC_FAILED, 'Failed to query teams', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async findAll(): Promise<Result<Team[], DomainError<CatalogErrorCode>>> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'GSI1',
          KeyConditionExpression: 'begins_with(GSI1PK, :prefix)',
          ExpressionAttributeValues: { ':prefix': 'DOMAIN#' },
        }),
      );
      return success((result.Items ?? []).map((item) => this.deserialize(item)));
    } catch (error) {
      return failure(domainError(CatalogErrorCode.SYNC_FAILED, 'Failed to list teams', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  private deserialize(item: Record<string, unknown>): Team {
    return {
      teamId: item['teamId'] as string,
      teamName: item['teamName'] as string,
      domain: item['domain'] as Domain,
      githubTeamSlug: item['githubTeamSlug'] as string,
      slackChannelId: (item['slackChannelId'] as string) ?? '',
      members: (item['members'] as Team['members']) ?? [],
      serviceIds: (item['serviceIds'] as string[]) ?? [],
    };
  }
}
