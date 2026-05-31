import { DynamoDBDocumentClient, PutCommand, QueryCommand, ScanCommand } from '@wep/aws-clients';
import type { RepoRunSummary, CiCostScanRun } from '../../domain/entities/ci-cost-types.js';

export class CiCostRepository {
  constructor(private readonly client: DynamoDBDocumentClient, private readonly tableName: string) {}

  async saveScanRun(run: CiCostScanRun): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: { PK: 'CI_SCAN_RUN', SK: `RUN#${run.startedAt}#${run.runId}`, ...run },
    }));
  }

  async getLatestScanRun(): Promise<CiCostScanRun | null> {
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': 'CI_SCAN_RUN' },
      ScanIndexForward: false,
      Limit: 1,
    }));
    return (result.Items?.[0] as CiCostScanRun) ?? null;
  }

  async saveRepoSummary(summary: RepoRunSummary): Promise<void> {
    const key = summary.repoFullName.replace('/', '#');
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        PK: `CI_REPO#${key}`,
        SK: 'SUMMARY',
        GSI1PK: 'CI_REPO',
        GSI1SK: summary.estimatedCostUsd.toString().padStart(10, '0'),
        ...summary,
      },
    }));
  }

  async listRepoSummaries(): Promise<RepoRunSummary[]> {
    const items: RepoRunSummary[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const result = await this.client.send(new ScanCommand({
        TableName: this.tableName,
        FilterExpression: 'SK = :sk',
        ExpressionAttributeValues: { ':sk': 'SUMMARY' },
        ExclusiveStartKey: lastKey,
      }));
      items.push(...(result.Items ?? []) as RepoRunSummary[]);
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    return items;
  }
}
