/**
 * Creates all WEP DynamoDB tables.
 * Run once before seeding or starting the API.
 *
 * DynamoDB Local (Docker):
 *   docker run -d -p 8000:8000 amazon/dynamodb-local
 *   npx tsx apps/api/src/create-tables.ts
 *
 * Real AWS  (comment out AWS_ENDPOINT_URL in .env first):
 *   npx tsx apps/api/src/create-tables.ts
 */

import 'dotenv/config';
import { DynamoDBClient, CreateTableCommand, ListTablesCommand, ResourceInUseException } from '@aws-sdk/client-dynamodb';
import { getTableName } from '@wep/aws-clients';

const REGION   = process.env['AWS_REGION']        ?? 'me-south-1';
const ENDPOINT = process.env['AWS_ENDPOINT_URL'];
const ENV      = process.env['WEP_ENVIRONMENT']   ?? 'development';

// Use the raw DynamoDB client (not the document client) for table management.
// When ENDPOINT is set (DynamoDB Local) we pass dummy credentials — Local doesn't validate them.
// When ENDPOINT is absent (real AWS) we omit credentials entirely so the SDK uses its
// default chain: env vars → SSO cache → ECS task role → EC2 instance profile.
const client = new DynamoDBClient({
  region: REGION,
  ...(ENDPOINT
    ? { endpoint: ENDPOINT, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }
    : {}),
});

const CONTEXTS = [
  'service-catalog',
  'deployment-tracker',
  'velocity-metrics',
  'pipeline-analytics',
  'cost-intelligence',
  'self-service',
  'security',
  'teams',
];

async function getExistingTables(): Promise<Set<string>> {
  const res = await client.send(new ListTablesCommand({ Limit: 100 }));
  return new Set(res.TableNames ?? []);
}

async function createTable(tableName: string, existing: Set<string>) {
  if (existing.has(tableName)) {
    console.log(`  ⏭  ${tableName}  (already exists)`);
    return;
  }

  try {
    await client.send(
      new CreateTableCommand({
        TableName:            tableName,
        BillingMode:          'PAY_PER_REQUEST',
        AttributeDefinitions: [
          { AttributeName: 'PK',     AttributeType: 'S' },
          { AttributeName: 'SK',     AttributeType: 'S' },
          { AttributeName: 'GSI1PK', AttributeType: 'S' },
          { AttributeName: 'GSI1SK', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH'  },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'GSI1',
            KeySchema: [
              { AttributeName: 'GSI1PK', KeyType: 'HASH'  },
              { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
      }),
    );
    console.log(`  ✓  ${tableName}`);
  } catch (err) {
    if (err instanceof ResourceInUseException) {
      console.log(`  ⏭  ${tableName}  (already exists)`);
    } else {
      throw err;
    }
  }
}

async function main() {
  console.log('🗄️   Creating DynamoDB tables\n');
  console.log(`   Endpoint: ${ENDPOINT ?? 'AWS default (real DynamoDB)'}`);
  console.log(`   Region:   ${REGION}`);
  console.log(`   Env:      ${ENV}\n`);

  const existing = await getExistingTables();

  for (const context of CONTEXTS) {
    await createTable(getTableName(context, ENV), existing);
  }

  console.log('\n✅  Tables ready.\n');
  console.log('   Run seed:  npx tsx apps/api/src/seed.ts\n');
}

main().catch((err) => {
  console.error('\n❌  Failed:', err.message ?? err);
  process.exit(1);
});
