import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  ScanCommand,
  DeleteCommand,
} from '@wep/aws-clients';
import type { ScanRun, RepoScanResult } from '../../domain/entities/audit-types.js';

export class NpmAuditRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async saveRun(run: ScanRun): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        PK: 'SCAN_RUN',
        SK: `RUN#${run.startedAt}#${run.runId}`,
        GSI1PK: `STATUS#${run.status}`,
        GSI1SK: run.startedAt,
        ...run,
      },
    }));
  }

  async getRun(runId: string): Promise<ScanRun | null> {
    // Scan for the run (runId is in the data, not the key)
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: 'runId = :runId',
      ExpressionAttributeValues: { ':pk': 'SCAN_RUN', ':runId': runId },
      Limit: 1,
    }));
    const item = result.Items?.[0];
    if (!item) return null;
    return item as ScanRun;
  }

  async getLatestRun(): Promise<ScanRun | null> {
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': 'SCAN_RUN' },
      ScanIndexForward: false,
      Limit: 1,
    }));
    const item = result.Items?.[0];
    if (!item) return null;
    return item as ScanRun;
  }

  async saveRepoResult(result: RepoScanResult): Promise<void> {
    const repoKey = result.repoFullName.replace('/', '#');
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        PK: `REPO#${repoKey}`,
        SK: 'AUDIT',
        GSI1PK: result.totalVulns > 0 ? 'VULN#yes' : 'VULN#no',
        GSI1SK: result.scannedAt,
        ...result,
      },
    }));
  }

  async getRepoResult(repoFullName: string): Promise<RepoScanResult | null> {
    const repoKey = repoFullName.replace('/', '#');
    const result = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: { PK: `REPO#${repoKey}`, SK: 'AUDIT' },
    }));
    if (!result.Item) return null;
    return result.Item as RepoScanResult;
  }

  async listAllRepoResults(): Promise<RepoScanResult[]> {
    const items: RepoScanResult[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const result = await this.client.send(new ScanCommand({
        TableName: this.tableName,
        FilterExpression: 'SK = :sk',
        ExpressionAttributeValues: { ':sk': 'AUDIT' },
        ExclusiveStartKey: lastKey,
      }));
      items.push(...(result.Items ?? []) as RepoScanResult[]);
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    return items;
  }

  async deleteRepoResult(repoFullName: string): Promise<void> {
    const repoKey = repoFullName.replace('/', '#');
    await this.client.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { PK: `REPO#${repoKey}`, SK: 'AUDIT' },
    }));
  }
}
