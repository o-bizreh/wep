import { type Result, success, failure, domainError, type DomainError } from '@wep/domain-types';
import { type DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand } from '@wep/aws-clients';
import type { ServiceCostRecord } from '../../domain/entities/service-cost-record.js';
import type { TeamCostSummary } from '../../domain/entities/team-cost-summary.js';
import type { CostAnomaly, AnomalyStatus } from '../../domain/entities/cost-anomaly.js';
import type { OptimizationRecommendation, RecommendationStatus } from '../../domain/entities/optimization-recommendation.js';
import type { CostRepository } from '../../domain/ports/cost-repository.js';

export class DynamoDBCostRepository implements CostRepository {
  constructor(private readonly client: DynamoDBDocumentClient, private readonly tableName: string) {}

  async saveDailyCost(record: ServiceCostRecord): Promise<Result<void, DomainError>> {
    try {
      await this.client.send(new PutCommand({ TableName: this.tableName, Item: { PK: `SERVICE#${record.serviceId}`, SK: `DAY#${record.date}`, ...record } }));
      return success(undefined);
    } catch (e) { return failure(domainError('SAVE_FAILED', (e as Error).message)); }
  }

  async getDailyCost(serviceId: string, date: string): Promise<Result<ServiceCostRecord | null, DomainError>> {
    try {
      const r = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { PK: `SERVICE#${serviceId}`, SK: `DAY#${date}` } }));
      return success(r.Item ? r.Item as unknown as ServiceCostRecord : null);
    } catch (e) { return failure(domainError('FETCH_FAILED', (e as Error).message)); }
  }

  async getDailyCostRange(serviceId: string, startDate: string, endDate: string): Promise<Result<ServiceCostRecord[], DomainError>> {
    try {
      const r = await this.client.send(new QueryCommand({
        TableName: this.tableName, KeyConditionExpression: 'PK = :pk AND SK BETWEEN :start AND :end',
        ExpressionAttributeValues: { ':pk': `SERVICE#${serviceId}`, ':start': `DAY#${startDate}`, ':end': `DAY#${endDate}` },
      }));
      return success((r.Items ?? []) as unknown as ServiceCostRecord[]);
    } catch (e) { return failure(domainError('QUERY_FAILED', (e as Error).message)); }
  }

  async saveTeamSummary(summary: TeamCostSummary): Promise<Result<void, DomainError>> {
    try {
      await this.client.send(new PutCommand({ TableName: this.tableName, Item: { PK: `TEAM#${summary.teamId}`, SK: `MONTH#${summary.month}`, ...summary } }));
      return success(undefined);
    } catch (e) { return failure(domainError('SAVE_FAILED', (e as Error).message)); }
  }

  async getTeamSummary(teamId: string, month: string): Promise<Result<TeamCostSummary | null, DomainError>> {
    try {
      const r = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { PK: `TEAM#${teamId}`, SK: `MONTH#${month}` } }));
      return success(r.Item ? r.Item as unknown as TeamCostSummary : null);
    } catch (e) { return failure(domainError('FETCH_FAILED', (e as Error).message)); }
  }

  async saveAnomaly(anomaly: CostAnomaly): Promise<Result<void, DomainError>> {
    try {
      await this.client.send(new PutCommand({ TableName: this.tableName, Item: { PK: `ANOMALY#${anomaly.serviceId}`, SK: `${anomaly.date}#${anomaly.anomalyId}`, ...anomaly } }));
      return success(undefined);
    } catch (e) { return failure(domainError('SAVE_FAILED', (e as Error).message)); }
  }

  async getAnomalies(status?: AnomalyStatus): Promise<Result<CostAnomaly[], DomainError>> {
    return success([]);
  }

  async updateAnomalyStatus(anomalyId: string, status: AnomalyStatus, resolvedBy?: string, resolution?: string): Promise<Result<void, DomainError>> {
    return success(undefined);
  }

  async saveRecommendation(rec: OptimizationRecommendation): Promise<Result<void, DomainError>> {
    try {
      await this.client.send(new PutCommand({ TableName: this.tableName, Item: { PK: `SERVICE#${rec.serviceId}`, SK: `RECOMMENDATION#${rec.type}`, ...rec } }));
      return success(undefined);
    } catch (e) { return failure(domainError('SAVE_FAILED', (e as Error).message)); }
  }

  async getRecommendations(status?: RecommendationStatus): Promise<Result<OptimizationRecommendation[], DomainError>> {
    return success([]);
  }

  async updateRecommendationStatus(id: string, status: RecommendationStatus): Promise<Result<void, DomainError>> {
    return success(undefined);
  }

  async getUnattributedCost(date: string): Promise<Result<Record<string, number>, DomainError>> {
    try {
      const r = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { PK: 'UNATTRIBUTED', SK: `DAY#${date}` } }));
      return success(r.Item ? (r.Item as Record<string, unknown>)['breakdown'] as Record<string, number> ?? {} : {});
    } catch (e) { return failure(domainError('FETCH_FAILED', (e as Error).message)); }
  }

  async saveUnattributedCost(date: string, breakdown: Record<string, number>): Promise<Result<void, DomainError>> {
    try {
      await this.client.send(new PutCommand({ TableName: this.tableName, Item: { PK: 'UNATTRIBUTED', SK: `DAY#${date}`, breakdown } }));
      return success(undefined);
    } catch (e) { return failure(domainError('SAVE_FAILED', (e as Error).message)); }
  }
}
