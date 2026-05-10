import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { credentialStore } from './credential-store.js';

export function createDynamoDBClient(config?: {
  region?: string;
  endpoint?: string;
}): DynamoDBDocumentClient {
  const endpoint = config?.endpoint ?? process.env['AWS_ENDPOINT_URL'];
  const baseClient = new DynamoDBClient({
    region: config?.region ?? process.env['AWS_REGION'] ?? 'me-south-1',
    // Skip credential provider when using DynamoDB Local (endpoint override)
    // Local Docker doesn't validate credentials
    ...(endpoint ? { endpoint } : { credentials: credentialStore.getProvider() }),
  });

  return DynamoDBDocumentClient.from(baseClient, {
    marshallOptions: {
      removeUndefinedValues: true,
    },
  });
}

export function getTableName(context: string, env?: string): string {
  const environment = env ?? process.env['WEP_ENVIRONMENT'] ?? 'development';
  return `wep-${context}-${environment}`;
}
