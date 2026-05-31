import { Router } from 'express';
import { DynamoDBDocumentClient, ScanCommand, GetCommand } from '@wep/aws-clients';
import { getTableName } from '@wep/aws-clients';

interface DriftItem {
  field: string;
  stagingValue: string;
  productionValue: string;
}

interface DriftCacheEntry {
  serviceId: string;
  serviceName: string;
  hasDrift: boolean;
  stagingImage: string | null;
  productionImage: string | null;
  driftItems: DriftItem[];
  computedAt: string;
}

interface DriftCacheResponse {
  entries: DriftCacheEntry[];
  computedAt: string | null;
}

export function createDriftCacheRouter(dynamoClient: DynamoDBDocumentClient): Router {
  const router = Router();
  const tableName = getTableName('drift-cache');

  router.get('/drift-cache', async (_req, res, next) => {
    try {
      // Scan for all DRIFT#* / LATEST items
      const scanResult = await dynamoClient.send(
        new ScanCommand({
          TableName: tableName,
          FilterExpression: 'SK = :sk AND begins_with(PK, :pk)',
          ExpressionAttributeValues: {
            ':sk': 'LATEST',
            ':pk': 'DRIFT#',
          },
        }),
      );

      // Get the run metadata item
      const metaResult = await dynamoClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: 'DRIFT_RUN', SK: 'LATEST' },
        }),
      );

      const entries: DriftCacheEntry[] = (scanResult.Items ?? []).map((item: Record<string, unknown>) => ({
        serviceId: item['serviceId'] as string,
        serviceName: item['serviceName'] as string,
        hasDrift: item['hasDrift'] as boolean,
        stagingImage: (item['stagingImage'] as string | null) ?? null,
        productionImage: (item['productionImage'] as string | null) ?? null,
        driftItems: (item['driftItems'] as DriftItem[]) ?? [],
        computedAt: item['computedAt'] as string,
      }));

      const computedAt = (metaResult.Item?.['computedAt'] as string | undefined) ?? null;

      const response: DriftCacheResponse = { entries, computedAt };
      res.json(response);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
