import {
  type Result,
  success,
  failure,
  domainError,
  DeploymentErrorCode,
  type DomainError,
  type PaginatedRequest,
  type PaginatedResponse,
} from '@wep/domain-types';
import { type DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } from '@wep/aws-clients';
import type { Deployment } from '../../domain/entities/deployment.js';
import type { EnvironmentSnapshot } from '../../domain/entities/environment-snapshot.js';
import type { DeploymentRepository, DeploymentFilters } from '../../domain/ports/deployment-repository.js';

export class DynamoDBDeploymentRepository implements DeploymentRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async save(deployment: Deployment): Promise<Result<void, DomainError<DeploymentErrorCode>>> {
    try {
      const timestamp = deployment.startedAt;
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            PK: `SERVICE#${deployment.serviceId}`,
            SK: `DEPLOY#${timestamp}#${deployment.deploymentId}`,
            GSI1PK: `ENV#${deployment.environment}`,
            GSI1SK: `${timestamp}#${deployment.deploymentId}`,
            deployId: deployment.deploymentId,
            deployPK: `DEPLOY#${deployment.deploymentId}`,
            deploySK: 'METADATA',
            ...deployment,
          },
        }),
      );

      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            PK: `DEPLOY#${deployment.deploymentId}`,
            SK: 'METADATA',
            ...deployment,
          },
        }),
      );

      return success(undefined);
    } catch (error) {
      return failure(domainError(DeploymentErrorCode.INVALID_INPUT, 'Failed to save deployment', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async findById(deploymentId: string): Promise<Result<Deployment | null, DomainError<DeploymentErrorCode>>> {
    try {
      const result = await this.client.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { PK: `DEPLOY#${deploymentId}`, SK: 'METADATA' },
        }),
      );
      if (!result.Item) return success(null);
      return success(result.Item as unknown as Deployment);
    } catch (error) {
      return failure(domainError(DeploymentErrorCode.INVALID_INPUT, 'Failed to fetch deployment', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async findByService(serviceId: string, pagination: PaginatedRequest): Promise<Result<PaginatedResponse<Deployment>, DomainError<DeploymentErrorCode>>> {
    return this.queryByPK(`SERVICE#${serviceId}`, 'DEPLOY#', pagination, true);
  }

  async findByEnvironment(environment: string, pagination: PaginatedRequest): Promise<Result<PaginatedResponse<Deployment>, DomainError<DeploymentErrorCode>>> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :pk',
          ExpressionAttributeValues: { ':pk': `ENV#${environment}` },
          ScanIndexForward: false,
          Limit: pagination.limit,
          ...(pagination.cursor ? { ExclusiveStartKey: JSON.parse(Buffer.from(pagination.cursor, 'base64').toString()) } : {}),
        }),
      );

      const items = (result.Items ?? []) as unknown as Deployment[];
      const nextCursor = result.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
        : undefined;
      return success({ items, nextCursor });
    } catch (error) {
      return failure(domainError(DeploymentErrorCode.INVALID_INPUT, 'Query failed', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async findRecent(filters: DeploymentFilters, pagination: PaginatedRequest): Promise<Result<PaginatedResponse<Deployment>, DomainError<DeploymentErrorCode>>> {
    if (filters.environment) {
      return this.findByEnvironment(filters.environment, pagination);
    }
    if (filters.serviceId) {
      return this.findByService(filters.serviceId, pagination);
    }
    return success({ items: [] });
  }

  async findDuplicate(serviceId: string, environment: string, sha: string, withinHours: number): Promise<Result<Deployment | null, DomainError<DeploymentErrorCode>>> {
    const cutoff = new Date(Date.now() - withinHours * 60 * 60 * 1000).toISOString();
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND SK > :sk',
          FilterExpression: 'sha = :sha AND environment = :env',
          ExpressionAttributeValues: {
            ':pk': `SERVICE#${serviceId}`,
            ':sk': `DEPLOY#${cutoff}`,
            ':sha': sha,
            ':env': environment,
          },
          Limit: 1,
        }),
      );

      if (result.Items && result.Items.length > 0) {
        return success(result.Items[0] as unknown as Deployment);
      }
      return success(null);
    } catch (error) {
      return failure(domainError(DeploymentErrorCode.INVALID_INPUT, 'Duplicate check failed', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async saveSnapshot(snapshot: EnvironmentSnapshot): Promise<Result<void, DomainError<DeploymentErrorCode>>> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            PK: `SERVICE#${snapshot.serviceId}`,
            SK: `CURRENT#${snapshot.environment}`,
            ...snapshot,
          },
        }),
      );
      return success(undefined);
    } catch (error) {
      return failure(domainError(DeploymentErrorCode.INVALID_INPUT, 'Failed to save snapshot', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async getSnapshot(serviceId: string, environment: string): Promise<Result<EnvironmentSnapshot | null, DomainError<DeploymentErrorCode>>> {
    try {
      const result = await this.client.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { PK: `SERVICE#${serviceId}`, SK: `CURRENT#${environment}` },
        }),
      );
      if (!result.Item) return success(null);
      return success(result.Item as unknown as EnvironmentSnapshot);
    } catch (error) {
      return failure(domainError(DeploymentErrorCode.INVALID_INPUT, 'Failed to get snapshot', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async getAllSnapshots(serviceId: string): Promise<Result<EnvironmentSnapshot[], DomainError<DeploymentErrorCode>>> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: { ':pk': `SERVICE#${serviceId}`, ':sk': 'CURRENT#' },
        }),
      );
      return success((result.Items ?? []) as unknown as EnvironmentSnapshot[]);
    } catch (error) {
      return failure(domainError(DeploymentErrorCode.INVALID_INPUT, 'Failed to list snapshots', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  private async queryByPK(pk: string, skPrefix: string, pagination: PaginatedRequest, reverse: boolean = false): Promise<Result<PaginatedResponse<Deployment>, DomainError<DeploymentErrorCode>>> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: { ':pk': pk, ':sk': skPrefix },
          ScanIndexForward: !reverse,
          Limit: pagination.limit,
          ...(pagination.cursor ? { ExclusiveStartKey: JSON.parse(Buffer.from(pagination.cursor, 'base64').toString()) } : {}),
        }),
      );

      const items = (result.Items ?? []) as unknown as Deployment[];
      const nextCursor = result.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
        : undefined;
      return success({ items, nextCursor });
    } catch (error) {
      return failure(domainError(DeploymentErrorCode.INVALID_INPUT, 'Query failed', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }
}
