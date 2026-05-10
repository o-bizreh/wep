import {
  type Result,
  success,
  failure,
  domainError,
  CatalogErrorCode,
  type DomainError,
} from '@wep/domain-types';
import { type DynamoDBDocumentClient, PutCommand, QueryCommand, DeleteCommand } from '@wep/aws-clients';
import type { Dependency } from '../../domain/entities/dependency.js';
import type { DependencyRepository, DependencyGraph, DependencyGraphNode } from '../../domain/ports/dependency-repository.js';

export class DynamoDBDependencyRepository implements DependencyRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async save(dep: Dependency): Promise<Result<void, DomainError<CatalogErrorCode>>> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            PK: `SERVICE#${dep.sourceServiceId}`,
            SK: `DEPENDS_ON#${dep.targetServiceId}`,
            GSI1PK: `SERVICE#${dep.targetServiceId}`,
            GSI1SK: `DEPENDED_BY#${dep.sourceServiceId}`,
            ...dep,
          },
        }),
      );
      return success(undefined);
    } catch (error) {
      return failure(domainError(CatalogErrorCode.SYNC_FAILED, 'Failed to save dependency', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async findDependencies(
    serviceId: string,
    depth: number,
  ): Promise<Result<DependencyGraph, DomainError<CatalogErrorCode>>> {
    return this.traverseGraph(serviceId, depth, 'outbound');
  }

  async findDependents(
    serviceId: string,
    depth: number,
  ): Promise<Result<DependencyGraph, DomainError<CatalogErrorCode>>> {
    return this.traverseGraph(serviceId, depth, 'inbound');
  }

  async delete(
    sourceServiceId: string,
    targetServiceId: string,
  ): Promise<Result<void, DomainError<CatalogErrorCode>>> {
    try {
      await this.client.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: {
            PK: `SERVICE#${sourceServiceId}`,
            SK: `DEPENDS_ON#${targetServiceId}`,
          },
        }),
      );
      return success(undefined);
    } catch (error) {
      return failure(domainError(CatalogErrorCode.SYNC_FAILED, 'Failed to delete dependency', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  private async traverseGraph(
    serviceId: string,
    depth: number,
    direction: 'outbound' | 'inbound',
  ): Promise<Result<DependencyGraph, DomainError<CatalogErrorCode>>> {
    const nodes = new Map<string, DependencyGraphNode>();
    const edges: Dependency[] = [];
    const visited = new Set<string>();

    const queue: Array<{ id: string; currentDepth: number }> = [{ id: serviceId, currentDepth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.id) || current.currentDepth >= depth) continue;
      visited.add(current.id);

      nodes.set(current.id, { serviceId: current.id, serviceName: current.id, healthStatus: 'unknown' });

      try {
        const isOutbound = direction === 'outbound';
        const result = await this.client.send(
          new QueryCommand({
            TableName: this.tableName,
            ...(isOutbound
              ? {
                  KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
                  ExpressionAttributeValues: {
                    ':pk': `SERVICE#${current.id}`,
                    ':sk': 'DEPENDS_ON#',
                  },
                }
              : {
                  IndexName: 'GSI1',
                  KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
                  ExpressionAttributeValues: {
                    ':pk': `SERVICE#${current.id}`,
                    ':sk': 'DEPENDED_BY#',
                  },
                }),
          }),
        );

        for (const item of result.Items ?? []) {
          const dep: Dependency = {
            sourceServiceId: item['sourceServiceId'] as string,
            targetServiceId: item['targetServiceId'] as string,
            dependencyType: item['dependencyType'] as Dependency['dependencyType'],
            discoveredAt: item['discoveredAt'] as string,
            discoveredBy: item['discoveredBy'] as string,
            confidence: item['confidence'] as Dependency['confidence'],
          };
          edges.push(dep);

          const nextId = isOutbound ? dep.targetServiceId : dep.sourceServiceId;
          if (!visited.has(nextId)) {
            queue.push({ id: nextId, currentDepth: current.currentDepth + 1 });
          }
        }
      } catch (error) {
        return failure(domainError(CatalogErrorCode.SYNC_FAILED, 'Graph traversal failed', {
          cause: error instanceof Error ? error.message : String(error),
        }));
      }
    }

    return success({ nodes: Array.from(nodes.values()), edges });
  }
}
