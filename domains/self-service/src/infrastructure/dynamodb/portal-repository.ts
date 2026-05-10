import { type Result, success, failure, domainError, type DomainError, type PaginatedRequest, type PaginatedResponse } from '@wep/domain-types';
import { type DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, ScanCommand, DeleteCommand } from '@wep/aws-clients';
import type { Operation } from '../../domain/entities/operation.js';
import type { ServiceRequest, RequestStatus } from '../../domain/entities/service-request.js';
import type { ApprovalRule } from '../../domain/entities/approval-rule.js';
import type { JitResource } from '../../domain/entities/jit-resource.js';
import type { JitSession } from '../../domain/entities/jit-session.js';
import type { WepUserProfile } from '../../domain/entities/user-profile.js';
import type { PortalRepository } from '../../domain/ports/portal-repository.js';

export class DynamoDBPortalRepository implements PortalRepository {
  constructor(private readonly client: DynamoDBDocumentClient, private readonly tableName: string) {}

  async getOperation(operationId: string): Promise<Result<Operation | null, DomainError>> {
    try {
      const r = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { PK: 'CATALOG', SK: `OP#${operationId}` } }));
      return success(r.Item ? normalizeOperation(r.Item as Record<string, unknown>) : null);
    } catch (e) { return failure(domainError('FETCH_FAILED', (e as Error).message)); }
  }

  async listOperations(): Promise<Result<Operation[], DomainError>> {
    try {
      const r = await this.client.send(new QueryCommand({
        TableName: this.tableName, KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': 'CATALOG' },
      }));
      return success((r.Items ?? []).map((it) => normalizeOperation(it as Record<string, unknown>)));
    } catch (e) { return failure(domainError('QUERY_FAILED', (e as Error).message)); }
  }

  async saveOperation(operation: Operation): Promise<Result<void, DomainError>> {
    try {
      await this.client.send(new PutCommand({ TableName: this.tableName, Item: { PK: 'CATALOG', SK: `OP#${operation.operationId}`, ...operation } }));
      return success(undefined);
    } catch (e) { return failure(domainError('SAVE_FAILED', (e as Error).message)); }
  }

  async deleteOperation(operationId: string): Promise<Result<void, DomainError>> {
    try {
      await this.client.send(new DeleteCommand({ TableName: this.tableName, Key: { PK: 'CATALOG', SK: `OP#${operationId}` } }));
      return success(undefined);
    } catch (e) { return failure(domainError('DELETE_FAILED', (e as Error).message)); }
  }

  async saveRequest(request: ServiceRequest): Promise<Result<void, DomainError>> {
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `REQUEST#${request.requestId}`, SK: 'METADATA',
          GSI1PK: `USER#${request.requesterId}`, GSI1SK: `REQUEST#${request.submittedAt}#${request.requestId}`,
          ...request,
        },
      }));
      return success(undefined);
    } catch (e) { return failure(domainError('SAVE_FAILED', (e as Error).message)); }
  }

  async getRequest(requestId: string): Promise<Result<ServiceRequest | null, DomainError>> {
    try {
      const r = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { PK: `REQUEST#${requestId}`, SK: 'METADATA' } }));
      return success(r.Item ? r.Item as unknown as ServiceRequest : null);
    } catch (e) { return failure(domainError('FETCH_FAILED', (e as Error).message)); }
  }

  async listRequests(filters: { requesterId?: string; teamId?: string; status?: RequestStatus }, pagination: PaginatedRequest): Promise<Result<PaginatedResponse<ServiceRequest>, DomainError>> {
    if (filters.requesterId) {
      try {
        const r = await this.client.send(new QueryCommand({
          TableName: this.tableName, IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :pk',
          ExpressionAttributeValues: { ':pk': `USER#${filters.requesterId}` },
          ScanIndexForward: false, Limit: pagination.limit,
        }));
        return success({ items: (r.Items ?? []) as unknown as ServiceRequest[] });
      } catch (e) { return failure(domainError('QUERY_FAILED', (e as Error).message)); }
    }
    return success({ items: [] });
  }

  async getPendingApprovals(approverId: string): Promise<Result<ServiceRequest[], DomainError>> {
    return success([]);
  }

  async listAllRequests(pagination: PaginatedRequest): Promise<Result<PaginatedResponse<ServiceRequest>, DomainError>> {
    try {
      const r = await this.client.send(new ScanCommand({
        TableName: this.tableName,
        FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
        ExpressionAttributeValues: { ':prefix': 'REQUEST#', ':sk': 'METADATA' },
        Limit: pagination.limit ?? 50,
      }));
      return success({ items: (r.Items ?? []) as unknown as ServiceRequest[] });
    } catch (e) { return failure(domainError('QUERY_FAILED', (e as Error).message)); }
  }

  async getApprovalRules(tier: string, scopeId?: string): Promise<Result<ApprovalRule[], DomainError>> {
    return success([]);
  }

  async saveApprovalRule(rule: ApprovalRule): Promise<Result<void, DomainError>> {
    try {
      await this.client.send(new PutCommand({ TableName: this.tableName, Item: { PK: `RULE#${rule.tier}`, SK: `${rule.scope}#${rule.scopeId}`, ...rule } }));
      return success(undefined);
    } catch (e) { return failure(domainError('SAVE_FAILED', (e as Error).message)); }
  }

  // ── JIT Resources ─────────────────────────────────────────────────────────────

  async listJitResources(): Promise<Result<JitResource[], DomainError>> {
    try {
      const r = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': 'JIT_RESOURCES' },
      }));
      return success((r.Items ?? []) as unknown as JitResource[]);
    } catch (e) { return failure(domainError('QUERY_FAILED', (e as Error).message)); }
  }

  async getJitResource(resourceId: string): Promise<Result<JitResource | null, DomainError>> {
    try {
      const r = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { PK: 'JIT_RESOURCES', SK: `RESOURCE#${resourceId}` } }));
      return success(r.Item ? r.Item as unknown as JitResource : null);
    } catch (e) { return failure(domainError('FETCH_FAILED', (e as Error).message)); }
  }

  async saveJitResource(resource: JitResource): Promise<Result<void, DomainError>> {
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: { PK: 'JIT_RESOURCES', SK: `RESOURCE#${resource.resourceId}`, ...resource },
      }));
      return success(undefined);
    } catch (e) { return failure(domainError('SAVE_FAILED', (e as Error).message)); }
  }

  async deleteJitResource(resourceId: string): Promise<Result<void, DomainError>> {
    try {
      await this.client.send(new DeleteCommand({ TableName: this.tableName, Key: { PK: 'JIT_RESOURCES', SK: `RESOURCE#${resourceId}` } }));
      return success(undefined);
    } catch (e) { return failure(domainError('DELETE_FAILED', (e as Error).message)); }
  }

  // ── JIT Sessions ──────────────────────────────────────────────────────────────

  async saveJitSession(session: JitSession): Promise<Result<void, DomainError>> {
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `JIT_SESSION#${session.sessionId}`,
          SK: 'METADATA',
          // GSI1: look up by requester
          GSI1PK: `USER#${session.requesterId}`,
          GSI1SK: `JIT_SESSION#${session.grantedAt}#${session.sessionId}`,
          ...session,
        },
      }));
      return success(undefined);
    } catch (e) { return failure(domainError('SAVE_FAILED', (e as Error).message)); }
  }

  async getJitSession(sessionId: string): Promise<Result<JitSession | null, DomainError>> {
    try {
      const r = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { PK: `JIT_SESSION#${sessionId}`, SK: 'METADATA' } }));
      return success(r.Item ? r.Item as unknown as JitSession : null);
    } catch (e) { return failure(domainError('FETCH_FAILED', (e as Error).message)); }
  }

  async listJitSessionsByRequester(requesterId: string): Promise<Result<JitSession[], DomainError>> {
    try {
      const r = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `USER#${requesterId}`, ':prefix': 'JIT_SESSION#' },
        ScanIndexForward: false,
        Limit: 50,
      }));
      return success((r.Items ?? []) as unknown as JitSession[]);
    } catch (e) { return failure(domainError('QUERY_FAILED', (e as Error).message)); }
  }

  async listExpiredActiveSessions(): Promise<Result<JitSession[], DomainError>> {
    // Scan the table for active sessions whose expiresAt is in the past.
    // JIT sessions are a low-volume dataset so a full scan is acceptable.
    // This avoids requiring a GSI2 on the table.
    try {
      const now = new Date().toISOString();
      const expired: JitSession[] = [];
      let lastKey: Record<string, unknown> | undefined;

      do {
        const r = await this.client.send(new ScanCommand({
          TableName: this.tableName,
          FilterExpression: 'begins_with(PK, :prefix) AND #status = :active AND expiresAt <= :now',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':prefix': 'JIT_SESSION#', ':active': 'active', ':now': now },
          ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
        }));
        for (const item of r.Items ?? []) expired.push(item as unknown as JitSession);
        lastKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastKey);

      return success(expired);
    } catch (e) { return failure(domainError('QUERY_FAILED', (e as Error).message)); }
  }

  async getUserProfile(email: string): Promise<Result<WepUserProfile | null, DomainError>> {
    try {
      const r = await this.client.send(new GetCommand({
        TableName: this.tableName,
        Key: { PK: `USER#${email.toLowerCase()}`, SK: 'PROFILE' },
      }));
      return success(r.Item ? (r.Item as unknown as WepUserProfile) : null);
    } catch (e) { return failure(domainError('FETCH_FAILED', (e as Error).message)); }
  }

  async saveUserProfile(profile: WepUserProfile): Promise<Result<void, DomainError>> {
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: { PK: `USER#${profile.email.toLowerCase()}`, SK: 'PROFILE', ...profile },
      }));
      return success(undefined);
    } catch (e) { return failure(domainError('SAVE_FAILED', (e as Error).message)); }
  }
}

/**
 * Apply forward-compatible defaults when reading an Operation row written before
 * the kind/awsAction/dbCredentials/autoApproval fields existed. Existing rows are
 * treated as runbook-kind so they keep working unchanged.
 */
function normalizeOperation(item: Record<string, unknown>): Operation {
  const op = item as unknown as Operation & { kind?: Operation['kind'] };
  return {
    ...op,
    kind: op.kind ?? 'runbook',
  };
}
