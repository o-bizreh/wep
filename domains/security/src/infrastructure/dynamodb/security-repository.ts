import {
  type DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  ScanCommand,
  DeleteCommand,
} from '@wep/aws-clients';
import { type Result, success, failure, domainError, type DomainError } from '@wep/domain-types';
import type { SecurityRepository } from '../../domain/ports/security-repository.js';
import type { PlatformUser } from '../../domain/entities/user.js';
import type { SecurityTeam } from '../../domain/entities/team.js';
import type { MonitoredRepo } from '../../domain/entities/monitored-repo.js';
import type { VulnPackage, CveEntry } from '../../domain/entities/vuln-package.js';
import type { GitLeaksReport, GitLeaksFinding } from '../../domain/entities/gitleaks-report.js';

export class DynamoDBSecurityRepository implements SecurityRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  // ── Users ─────────────────────────────────────────────────────────────────

  async upsertUser(user: PlatformUser): Promise<Result<void, DomainError>> {
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: { PK: `USER#${user.username}`, SK: 'METADATA', ...user },
      }));
      return success(undefined);
    } catch (e) { return failure(domainError('SAVE_FAILED', (e as Error).message)); }
  }

  async listUsers(): Promise<Result<PlatformUser[], DomainError>> {
    try {
      const items: PlatformUser[] = [];
      let lastKey: Record<string, unknown> | undefined;
      do {
        const r = await this.client.send(new ScanCommand({
          TableName: this.tableName,
          FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
          ExpressionAttributeValues: { ':prefix': 'USER#', ':sk': 'METADATA' },
          ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
        }));
        for (const item of r.Items ?? []) items.push(item as unknown as PlatformUser);
        lastKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastKey);
      return success(items);
    } catch (e) { return failure(domainError('QUERY_FAILED', (e as Error).message)); }
  }

  async getUser(username: string): Promise<Result<PlatformUser | null, DomainError>> {
    try {
      const r = await this.client.send(new GetCommand({
        TableName: this.tableName,
        Key: { PK: `USER#${username}`, SK: 'METADATA' },
      }));
      return success(r.Item ? r.Item as unknown as PlatformUser : null);
    } catch (e) { return failure(domainError('FETCH_FAILED', (e as Error).message)); }
  }

  // ── Teams ─────────────────────────────────────────────────────────────────

  async saveTeam(team: SecurityTeam): Promise<Result<void, DomainError>> {
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `TEAM#${team.teamId}`,
          SK: 'METADATA',
          GSI1PK: `OWNER#${team.ownerUsername}`,
          GSI1SK: `TEAM#${team.teamId}`,
          ...team,
        },
      }));
      return success(undefined);
    } catch (e) { return failure(domainError('SAVE_FAILED', (e as Error).message)); }
  }

  async getTeam(teamId: string): Promise<Result<SecurityTeam | null, DomainError>> {
    try {
      const r = await this.client.send(new GetCommand({
        TableName: this.tableName,
        Key: { PK: `TEAM#${teamId}`, SK: 'METADATA' },
      }));
      return success(r.Item ? r.Item as unknown as SecurityTeam : null);
    } catch (e) { return failure(domainError('FETCH_FAILED', (e as Error).message)); }
  }

  async listTeams(): Promise<Result<SecurityTeam[], DomainError>> {
    try {
      const items: SecurityTeam[] = [];
      let lastKey: Record<string, unknown> | undefined;
      do {
        const r = await this.client.send(new ScanCommand({
          TableName: this.tableName,
          FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
          ExpressionAttributeValues: { ':prefix': 'TEAM#', ':sk': 'METADATA' },
          ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
        }));
        for (const item of r.Items ?? []) items.push(item as unknown as SecurityTeam);
        lastKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastKey);
      return success(items);
    } catch (e) { return failure(domainError('QUERY_FAILED', (e as Error).message)); }
  }

  async getTeamByOwner(ownerUsername: string): Promise<Result<SecurityTeam | null, DomainError>> {
    try {
      const r = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `OWNER#${ownerUsername}` },
        Limit: 1,
      }));
      const item = r.Items?.[0];
      return success(item ? item as unknown as SecurityTeam : null);
    } catch (e) { return failure(domainError('QUERY_FAILED', (e as Error).message)); }
  }

  async deleteTeam(teamId: string): Promise<Result<void, DomainError>> {
    try {
      await this.client.send(new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: `TEAM#${teamId}`, SK: 'METADATA' },
      }));
      return success(undefined);
    } catch (e) { return failure(domainError('DELETE_FAILED', (e as Error).message)); }
  }

  // ── Monitored Repos ───────────────────────────────────────────────────────

  async saveMonitoredRepo(repo: MonitoredRepo): Promise<Result<void, DomainError>> {
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: { PK: `REPO#${repo.fullName}`, SK: 'METADATA', ...repo },
      }));
      return success(undefined);
    } catch (e) { return failure(domainError('SAVE_FAILED', (e as Error).message)); }
  }

  async getMonitoredRepo(fullName: string): Promise<Result<MonitoredRepo | null, DomainError>> {
    try {
      const r = await this.client.send(new GetCommand({
        TableName: this.tableName,
        Key: { PK: `REPO#${fullName}`, SK: 'METADATA' },
      }));
      return success(r.Item ? r.Item as unknown as MonitoredRepo : null);
    } catch (e) { return failure(domainError('FETCH_FAILED', (e as Error).message)); }
  }

  async listMonitoredRepos(): Promise<Result<MonitoredRepo[], DomainError>> {
    try {
      const items: MonitoredRepo[] = [];
      let lastKey: Record<string, unknown> | undefined;
      do {
        const r = await this.client.send(new ScanCommand({
          TableName: this.tableName,
          FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
          ExpressionAttributeValues: { ':prefix': 'REPO#', ':sk': 'METADATA' },
          ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
        }));
        for (const item of r.Items ?? []) items.push(item as unknown as MonitoredRepo);
        lastKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastKey);
      return success(items);
    } catch (e) { return failure(domainError('QUERY_FAILED', (e as Error).message)); }
  }

  async deleteMonitoredRepo(fullName: string): Promise<Result<void, DomainError>> {
    try {
      await this.client.send(new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: `REPO#${fullName}`, SK: 'METADATA' },
      }));
      return success(undefined);
    } catch (e) { return failure(domainError('DELETE_FAILED', (e as Error).message)); }
  }

  // ── Vuln Packages ─────────────────────────────────────────────────────────

  async saveVulnPackage(pkg: VulnPackage): Promise<Result<void, DomainError>> {
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: { PK: `PKG#${pkg.ecosystem}#${pkg.name}`, SK: 'METADATA', ...pkg },
      }));
      return success(undefined);
    } catch (e) { return failure(domainError('SAVE_FAILED', (e as Error).message)); }
  }

  async listVulnPackages(): Promise<Result<VulnPackage[], DomainError>> {
    try {
      const items: VulnPackage[] = [];
      let lastKey: Record<string, unknown> | undefined;
      do {
        const r = await this.client.send(new ScanCommand({
          TableName: this.tableName,
          FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
          ExpressionAttributeValues: { ':prefix': 'PKG#', ':sk': 'METADATA' },
          ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
        }));
        for (const item of r.Items ?? []) items.push(item as unknown as VulnPackage);
        lastKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastKey);
      return success(items);
    } catch (e) { return failure(domainError('QUERY_FAILED', (e as Error).message)); }
  }

  async getVulnPackage(ecosystem: string, name: string): Promise<Result<VulnPackage | null, DomainError>> {
    try {
      const r = await this.client.send(new GetCommand({
        TableName: this.tableName,
        Key: { PK: `PKG#${ecosystem}#${name}`, SK: 'METADATA' },
      }));
      return success(r.Item ? r.Item as unknown as VulnPackage : null);
    } catch (e) { return failure(domainError('FETCH_FAILED', (e as Error).message)); }
  }

  async saveCveEntry(ecosystem: string, name: string, cve: CveEntry): Promise<Result<void, DomainError>> {
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: { PK: `PKG#${ecosystem}#${name}`, SK: `CVE#${cve.cveId}`, ...cve },
      }));
      return success(undefined);
    } catch (e) { return failure(domainError('SAVE_FAILED', (e as Error).message)); }
  }

  async listCveEntries(ecosystem: string, name: string): Promise<Result<CveEntry[], DomainError>> {
    try {
      const r = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `PKG#${ecosystem}#${name}`, ':prefix': 'CVE#' },
      }));
      return success((r.Items ?? []) as unknown as CveEntry[]);
    } catch (e) { return failure(domainError('QUERY_FAILED', (e as Error).message)); }
  }

  async deleteAllCveEntries(ecosystem: string, name: string): Promise<Result<void, DomainError>> {
    // Query all CVE entries then batch delete
    try {
      const r = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `PKG#${ecosystem}#${name}`, ':prefix': 'CVE#' },
        ProjectionExpression: 'SK',
      }));
      for (const item of r.Items ?? []) {
        await this.client.send(new DeleteCommand({
          TableName: this.tableName,
          Key: { PK: `PKG#${ecosystem}#${name}`, SK: item['SK'] as string },
        }));
      }
      return success(undefined);
    } catch (e) { return failure(domainError('DELETE_FAILED', (e as Error).message)); }
  }

  // ── GitLeaks ──────────────────────────────────────────────────────────────

  async saveGitLeaksReport(report: GitLeaksReport): Promise<Result<void, DomainError>> {
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: { PK: `GITLEAKS#${report.reportId}`, SK: 'METADATA', ...report },
      }));
      return success(undefined);
    } catch (e) { return failure(domainError('SAVE_FAILED', (e as Error).message)); }
  }

  async listGitLeaksReports(): Promise<Result<GitLeaksReport[], DomainError>> {
    try {
      const items: GitLeaksReport[] = [];
      let lastKey: Record<string, unknown> | undefined;
      do {
        const r = await this.client.send(new ScanCommand({
          TableName: this.tableName,
          FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
          ExpressionAttributeValues: { ':prefix': 'GITLEAKS#', ':sk': 'METADATA' },
          ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
        }));
        for (const item of r.Items ?? []) items.push(item as unknown as GitLeaksReport);
        lastKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastKey);
      return success(items);
    } catch (e) { return failure(domainError('QUERY_FAILED', (e as Error).message)); }
  }

  async getGitLeaksReport(reportId: string): Promise<Result<GitLeaksReport | null, DomainError>> {
    try {
      const r = await this.client.send(new GetCommand({
        TableName: this.tableName,
        Key: { PK: `GITLEAKS#${reportId}`, SK: 'METADATA' },
      }));
      return success(r.Item ? r.Item as unknown as GitLeaksReport : null);
    } catch (e) { return failure(domainError('FETCH_FAILED', (e as Error).message)); }
  }

  async saveGitLeaksFinding(reportId: string, finding: GitLeaksFinding): Promise<Result<void, DomainError>> {
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: { PK: `GITLEAKS#${reportId}`, SK: `FINDING#${finding.fingerprint}`, ...finding },
      }));
      return success(undefined);
    } catch (e) { return failure(domainError('SAVE_FAILED', (e as Error).message)); }
  }

  async listGitLeaksFindings(reportId: string): Promise<Result<GitLeaksFinding[], DomainError>> {
    try {
      const r = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `GITLEAKS#${reportId}`, ':prefix': 'FINDING#' },
      }));
      return success((r.Items ?? []) as unknown as GitLeaksFinding[]);
    } catch (e) { return failure(domainError('QUERY_FAILED', (e as Error).message)); }
  }

  async deleteGitLeaksReport(reportId: string): Promise<Result<void, DomainError>> {
    // Delete metadata + all findings
    try {
      const r = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `GITLEAKS#${reportId}` },
        ProjectionExpression: 'SK',
      }));
      for (const item of r.Items ?? []) {
        await this.client.send(new DeleteCommand({
          TableName: this.tableName,
          Key: { PK: `GITLEAKS#${reportId}`, SK: item['SK'] as string },
        }));
      }
      return success(undefined);
    } catch (e) { return failure(domainError('DELETE_FAILED', (e as Error).message)); }
  }
}
