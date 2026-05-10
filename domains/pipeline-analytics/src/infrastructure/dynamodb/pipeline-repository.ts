import {
  type Result, success, failure, domainError, type DomainError,
  type PaginatedRequest, type PaginatedResponse,
} from '@wep/domain-types';
import { type DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } from '@wep/aws-clients';
import type { PipelineRun } from '../../domain/entities/pipeline-run.js';
import type { PipelineCostSummary } from '../../domain/entities/pipeline-cost-summary.js';
import type { FailurePattern } from '../../domain/value-objects/failure-pattern.js';
import type { PipelineRepository, PipelineRunFilters } from '../../domain/ports/pipeline-repository.js';

export class DynamoDBPipelineRepository implements PipelineRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async saveRun(run: PipelineRun): Promise<Result<void, DomainError>> {
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `RUN#${run.runId}`,
          SK: 'METADATA',
          GSI1PK: run.serviceId ? `SERVICE#${run.serviceId}` : 'SERVICE#unlinked',
          GSI1SK: `RUN#${run.startedAt}#${run.runId}`,
          ...run,
        },
      }));
      return success(undefined);
    } catch (error) {
      return failure(domainError('SAVE_FAILED', 'Failed to save run', { cause: error instanceof Error ? error.message : String(error) }));
    }
  }

  async findRunById(runId: number): Promise<Result<PipelineRun | null, DomainError>> {
    try {
      const result = await this.client.send(new GetCommand({
        TableName: this.tableName, Key: { PK: `RUN#${runId}`, SK: 'METADATA' },
      }));
      return success(result.Item ? result.Item as unknown as PipelineRun : null);
    } catch (error) {
      return failure(domainError('FETCH_FAILED', 'Failed to fetch run', { cause: error instanceof Error ? error.message : String(error) }));
    }
  }

  async findRuns(filters: PipelineRunFilters, pagination: PaginatedRequest): Promise<Result<PaginatedResponse<PipelineRun>, DomainError>> {
    if (filters.serviceId) return this.findRunsByService(filters.serviceId, pagination);
    return success({ items: [] });
  }

  async findRunsByService(serviceId: string, pagination: PaginatedRequest): Promise<Result<PaginatedResponse<PipelineRun>, DomainError>> {
    try {
      const result = await this.client.send(new QueryCommand({
        TableName: this.tableName, IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `SERVICE#${serviceId}` },
        ScanIndexForward: false, Limit: pagination.limit,
        ...(pagination.cursor ? { ExclusiveStartKey: JSON.parse(Buffer.from(pagination.cursor, 'base64').toString()) } : {}),
      }));
      const items = (result.Items ?? []) as unknown as PipelineRun[];
      const nextCursor = result.LastEvaluatedKey ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64') : undefined;
      return success({ items, nextCursor });
    } catch (error) {
      return failure(domainError('QUERY_FAILED', 'Failed to query runs', { cause: error instanceof Error ? error.message : String(error) }));
    }
  }

  async saveCostSummary(summary: PipelineCostSummary): Promise<Result<void, DomainError>> {
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: { PK: `COST#${summary.billingPeriod}`, SK: `TEAM#${summary.entityId}`, ...summary },
      }));
      return success(undefined);
    } catch (error) {
      return failure(domainError('SAVE_FAILED', 'Failed to save cost summary', { cause: error instanceof Error ? error.message : String(error) }));
    }
  }

  async getCostSummary(entityId: string, billingPeriod: string): Promise<Result<PipelineCostSummary | null, DomainError>> {
    try {
      const result = await this.client.send(new GetCommand({
        TableName: this.tableName, Key: { PK: `COST#${billingPeriod}`, SK: `TEAM#${entityId}` },
      }));
      return success(result.Item ? result.Item as unknown as PipelineCostSummary : null);
    } catch (error) {
      return failure(domainError('FETCH_FAILED', 'Failed to fetch cost summary', { cause: error instanceof Error ? error.message : String(error) }));
    }
  }

  async savePattern(pattern: FailurePattern): Promise<Result<void, DomainError>> {
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: { PK: 'PATTERN', SK: `PATTERN#${pattern.patternId}`, ...pattern },
      }));
      return success(undefined);
    } catch (error) {
      return failure(domainError('SAVE_FAILED', 'Failed to save pattern', { cause: error instanceof Error ? error.message : String(error) }));
    }
  }

  async getPatterns(): Promise<Result<FailurePattern[], DomainError>> {
    try {
      const result = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': 'PATTERN' },
      }));
      return success((result.Items ?? []) as unknown as FailurePattern[]);
    } catch (error) {
      return failure(domainError('QUERY_FAILED', 'Failed to get patterns', { cause: error instanceof Error ? error.message : String(error) }));
    }
  }

  async getLastPollTimestamp(repoFullName: string): Promise<Result<string | null, DomainError>> {
    try {
      const result = await this.client.send(new GetCommand({
        TableName: this.tableName, Key: { PK: 'POLL', SK: `REPO#${repoFullName}` },
      }));
      return success(result.Item ? (result.Item as Record<string, unknown>)['lastPollAt'] as string : null);
    } catch (error) {
      return failure(domainError('FETCH_FAILED', 'Failed to get poll timestamp', { cause: error instanceof Error ? error.message : String(error) }));
    }
  }

  async saveLastPollTimestamp(repoFullName: string, timestamp: string): Promise<Result<void, DomainError>> {
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: { PK: 'POLL', SK: `REPO#${repoFullName}`, lastPollAt: timestamp },
      }));
      return success(undefined);
    } catch (error) {
      return failure(domainError('SAVE_FAILED', 'Failed to save poll timestamp', { cause: error instanceof Error ? error.message : String(error) }));
    }
  }
}
