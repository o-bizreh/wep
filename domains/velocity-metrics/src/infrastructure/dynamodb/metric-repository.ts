import {
  type Result,
  success,
  failure,
  domainError,
  VelocityErrorCode,
  type DomainError,
} from '@wep/domain-types';
import { type DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand } from '@wep/aws-clients';
import type { MetricSnapshot, Period } from '../../domain/entities/metric-snapshot.js';
import type { MetricAnomaly } from '../../domain/entities/metric-anomaly.js';
import type { MetricRepository } from '../../domain/ports/metric-repository.js';

export class DynamoDBMetricRepository implements MetricRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async saveSnapshot(snapshot: MetricSnapshot): Promise<Result<void, DomainError<VelocityErrorCode>>> {
    try {
      const pk = snapshot.entityType === 'team' ? `TEAM#${snapshot.entityId}` : `ORG#washmen`;
      const sk = snapshot.period === 'week'
        ? `WEEK#${snapshot.periodIdentifier}`
        : snapshot.period === 'month'
          ? `MONTH#${snapshot.periodIdentifier}`
          : `DAY#${snapshot.periodIdentifier}`;

      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: { PK: pk, SK: sk, ...snapshot },
      }));

      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: { PK: pk, SK: 'CURRENT', ...snapshot },
      }));

      return success(undefined);
    } catch (error) {
      return failure(domainError(VelocityErrorCode.CALCULATION_FAILED, 'Failed to save snapshot', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async getTeamCurrent(teamId: string): Promise<Result<MetricSnapshot | null, DomainError<VelocityErrorCode>>> {
    return this.getItem(`TEAM#${teamId}`, 'CURRENT');
  }

  async getTeamHistory(teamId: string, period: Period, count: number): Promise<Result<MetricSnapshot[], DomainError<VelocityErrorCode>>> {
    const prefix = period === 'week' ? 'WEEK#' : period === 'month' ? 'MONTH#' : 'DAY#';
    return this.queryHistory(`TEAM#${teamId}`, prefix, count);
  }

  async getOrgCurrent(): Promise<Result<MetricSnapshot | null, DomainError<VelocityErrorCode>>> {
    return this.getItem('ORG#washmen', 'CURRENT');
  }

  async getOrgHistory(period: Period, count: number): Promise<Result<MetricSnapshot[], DomainError<VelocityErrorCode>>> {
    const prefix = period === 'week' ? 'WEEK#' : period === 'month' ? 'MONTH#' : 'DAY#';
    return this.queryHistory('ORG#washmen', prefix, count);
  }

  async saveAnomaly(anomaly: MetricAnomaly): Promise<Result<void, DomainError<VelocityErrorCode>>> {
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `ANOMALY#${anomaly.teamId}`,
          SK: `${anomaly.detectedAt}#${anomaly.anomalyId}`,
          ...anomaly,
        },
      }));
      return success(undefined);
    } catch (error) {
      return failure(domainError(VelocityErrorCode.CALCULATION_FAILED, 'Failed to save anomaly', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async getAnomalies(teamId?: string, limit: number = 20): Promise<Result<MetricAnomaly[], DomainError<VelocityErrorCode>>> {
    try {
      if (teamId) {
        const result = await this.client.send(new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': `ANOMALY#${teamId}` },
          ScanIndexForward: false,
          Limit: limit,
        }));
        return success((result.Items ?? []) as unknown as MetricAnomaly[]);
      }
      return success([]);
    } catch (error) {
      return failure(domainError(VelocityErrorCode.CALCULATION_FAILED, 'Failed to get anomalies', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async acknowledgeAnomaly(anomalyId: string): Promise<Result<void, DomainError<VelocityErrorCode>>> {
    return success(undefined);
  }

  private async getItem(pk: string, sk: string): Promise<Result<MetricSnapshot | null, DomainError<VelocityErrorCode>>> {
    try {
      const result = await this.client.send(new GetCommand({
        TableName: this.tableName,
        Key: { PK: pk, SK: sk },
      }));
      if (!result.Item) return success(null);
      return success(result.Item as unknown as MetricSnapshot);
    } catch (error) {
      return failure(domainError(VelocityErrorCode.CALCULATION_FAILED, 'Failed to get item', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  private async queryHistory(pk: string, skPrefix: string, count: number): Promise<Result<MetricSnapshot[], DomainError<VelocityErrorCode>>> {
    try {
      const result = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': pk, ':sk': skPrefix },
        ScanIndexForward: false,
        Limit: count,
      }));
      return success((result.Items ?? []) as unknown as MetricSnapshot[]);
    } catch (error) {
      return failure(domainError(VelocityErrorCode.CALCULATION_FAILED, 'History query failed', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }
}
