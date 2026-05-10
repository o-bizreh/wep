import {
  type Result,
  success,
  failure,
  domainError,
  CatalogErrorCode,
  type DomainError,
  type PaginatedRequest,
  type PaginatedResponse,
  type Environment,
  type TeamReference,
} from '@wep/domain-types';
import {
  type DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  ScanCommand,
  DeleteCommand,
} from '@wep/aws-clients';
import type { Service } from '../../domain/entities/service.js';
import type { ServiceRepository } from '../../domain/ports/service-repository.js';
import type { HealthStatus } from '../../domain/value-objects/health-status.js';

export class DynamoDBServiceRepository implements ServiceRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async save(service: Service): Promise<Result<void, DomainError<CatalogErrorCode>>> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            PK: `SERVICE#${service.serviceId}`,
            SK: 'METADATA',
            GSI1PK: `TEAM#${service.ownerTeam.teamId}`,
            GSI1SK: `SERVICE#${service.serviceName}`,
            ...this.serializeService(service),
          },
        }),
      );
      return success(undefined);
    } catch (error) {
      return failure(domainError(CatalogErrorCode.SYNC_FAILED, 'Failed to save service', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async findById(serviceId: string): Promise<Result<Service | null, DomainError<CatalogErrorCode>>> {
    try {
      const result = await this.client.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { PK: `SERVICE#${serviceId}`, SK: 'METADATA' },
        }),
      );
      if (!result.Item) return success(null);
      return success(this.deserializeService(result.Item));
    } catch (error) {
      return failure(domainError(CatalogErrorCode.SYNC_FAILED, 'Failed to fetch service', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async findByTeam(
    teamId: string,
    pagination: PaginatedRequest,
  ): Promise<Result<PaginatedResponse<Service>, DomainError<CatalogErrorCode>>> {
    return this.queryGSI1(`TEAM#${teamId}`, 'SERVICE#', pagination);
  }

  async findByEnvironment(
    environment: Environment,
    pagination: PaginatedRequest,
  ): Promise<Result<PaginatedResponse<Service>, DomainError<CatalogErrorCode>>> {
    return this.queryGSI1(`ENV#${environment}`, 'SERVICE#', pagination);
  }

  async searchByName(
    query: string,
    pagination: PaginatedRequest,
  ): Promise<Result<PaginatedResponse<Service>, DomainError<CatalogErrorCode>>> {
    // DynamoDB has no full-text index — scan with contains() filter.
    // Same multi-chunk loop as findAll to avoid the Limit-before-filter trap.
    try {
      const lower = query.toLowerCase();
      const collected: Service[] = [];
      let lastKey: Record<string, unknown> | undefined = pagination.cursor
        ? JSON.parse(Buffer.from(pagination.cursor, 'base64').toString())
        : undefined;

      while (collected.length < pagination.limit) {
        const result = await this.client.send(
          new ScanCommand({
            TableName: this.tableName,
            FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk AND contains(#name, :q)',
            ExpressionAttributeNames: { '#name': 'serviceName' },
            ExpressionAttributeValues: {
              ':prefix': 'SERVICE#',
              ':sk': 'METADATA',
              ':q': lower,
            },
            Limit: 200,
            ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
          }),
        );

        for (const item of result.Items ?? []) {
          // DynamoDB contains() is case-sensitive; do a JS toLowerCase guard too
          const name = (item['serviceName'] as string | undefined ?? '').toLowerCase();
          if (name.includes(lower)) {
            collected.push(this.deserializeService(item));
            if (collected.length >= pagination.limit) break;
          }
        }

        lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
        if (!lastKey) break;
      }

      const nextCursor = lastKey
        ? Buffer.from(JSON.stringify(lastKey)).toString('base64')
        : undefined;

      return success({ items: collected, nextCursor });
    } catch (error) {
      return failure(domainError(CatalogErrorCode.SYNC_FAILED, 'Search failed', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async findAll(
    pagination: PaginatedRequest,
  ): Promise<Result<PaginatedResponse<Service>, DomainError<CatalogErrorCode>>> {
    // DynamoDB Scan's `Limit` is a page-read limit, not a result limit — it stops
    // scanning after N items regardless of how many pass the FilterExpression.
    // We must keep paginating until we have enough matched items or the table is exhausted.
    try {
      const collected: Service[] = [];
      let lastKey: Record<string, unknown> | undefined = pagination.cursor
        ? JSON.parse(Buffer.from(pagination.cursor, 'base64').toString())
        : undefined;

      while (collected.length < pagination.limit) {
        const result = await this.client.send(
          new ScanCommand({
            TableName: this.tableName,
            FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
            ExpressionAttributeValues: { ':prefix': 'SERVICE#', ':sk': 'METADATA' },
            // Read in chunks of 200 to bound each request's RCU cost
            Limit: 200,
            ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
          }),
        );

        for (const item of result.Items ?? []) {
          collected.push(this.deserializeService(item));
          if (collected.length >= pagination.limit) break;
        }

        lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
        if (!lastKey) break; // table exhausted
      }

      console.log(`[serviceRepo.findAll] returned ${collected.length} services`);
      const nextCursor = lastKey
        ? Buffer.from(JSON.stringify(lastKey)).toString('base64')
        : undefined;

      return success({ items: collected, nextCursor });
    } catch (error) {
      console.error(`[serviceRepo.findAll] error: ${error instanceof Error ? error.message : String(error)}`);
      return failure(domainError(CatalogErrorCode.SYNC_FAILED, 'Failed to list services', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async delete(serviceId: string): Promise<Result<void, DomainError<CatalogErrorCode>>> {
    try {
      await this.client.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { PK: `SERVICE#${serviceId}`, SK: 'METADATA' },
        }),
      );
      return success(undefined);
    } catch (error) {
      return failure(domainError(CatalogErrorCode.SYNC_FAILED, 'Failed to delete service', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  private async queryGSI1(
    pk: string,
    skPrefix: string,
    pagination: PaginatedRequest,
  ): Promise<Result<PaginatedResponse<Service>, DomainError<CatalogErrorCode>>> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
          ExpressionAttributeValues: { ':pk': pk, ':sk': skPrefix },
          Limit: pagination.limit,
          ...(pagination.cursor
            ? { ExclusiveStartKey: JSON.parse(Buffer.from(pagination.cursor, 'base64').toString()) }
            : {}),
        }),
      );

      const items = (result.Items ?? []).map((item) => this.deserializeService(item));
      const nextCursor = result.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
        : undefined;

      return success({ items, nextCursor });
    } catch (error) {
      return failure(domainError(CatalogErrorCode.SYNC_FAILED, 'Query failed', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  private serializeService(service: Service): Record<string, unknown> {
    return {
      serviceId: service.serviceId,
      serviceName: service.serviceName,
      repositoryUrl: service.repositoryUrl,
      runtimeType: service.runtimeType,
      ownerTeam: service.ownerTeam,
      environments: service.environments,
      awsResources: service.awsResources,
      healthStatus: service.healthStatus,
      discoveryMethod: service.discoveryMethod,
      lastSyncedAt: service.lastSyncedAt,
      metadata: service.metadata,
      isActive: service.isActive,
      awsEnriched: service.awsEnriched,
    };
  }

  private deserializeService(item: Record<string, unknown>): Service {
    return {
      serviceId: item['serviceId'] as string,
      serviceName: item['serviceName'] as string,
      repositoryUrl: item['repositoryUrl'] as string,
      runtimeType: item['runtimeType'] as Service['runtimeType'],
      ownerTeam: item['ownerTeam'] as TeamReference,
      environments: (item['environments'] as Service['environments']) ?? [],
      awsResources: (item['awsResources'] as Service['awsResources']) ?? {},
      healthStatus: (item['healthStatus'] as HealthStatus) ?? { status: 'unknown', signals: [] },
      discoveryMethod: (item['discoveryMethod'] as Service['discoveryMethod']) ?? 'automated',
      lastSyncedAt: item['lastSyncedAt'] as string,
      metadata: (item['metadata'] as Record<string, string>) ?? {},
      isActive: (item['isActive'] as boolean) ?? true,
      awsEnriched: (item['awsEnriched'] as boolean) ?? false,
    };
  }
}
