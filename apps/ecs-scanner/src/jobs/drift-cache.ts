import {
  ECSClient,
  ListServicesCommand,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
} from '@aws-sdk/client-ecs';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient, getTableName, credentialStore } from '@wep/aws-clients';

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

interface TaskDefDetails {
  image: string | null;
  cpu: string | null;
  memory: string | null;
  envVarCount: number;
}

async function listAllServices(ecsClient: ECSClient, cluster: string): Promise<string[]> {
  const arns: string[] = [];
  let nextToken: string | undefined;

  do {
    const response = await ecsClient.send(
      new ListServicesCommand({ cluster, nextToken, maxResults: 100 }),
    );
    arns.push(...(response.serviceArns ?? []));
    nextToken = response.nextToken;
  } while (nextToken !== undefined && arns.length < 100);

  return arns;
}

function extractServiceName(arn: string): string {
  // ARN format: arn:aws:ecs:region:account:service/cluster/service-name
  // or older: arn:aws:ecs:region:account:service/service-name
  const parts = arn.split('/');
  return parts[parts.length - 1] ?? arn;
}

function normaliseServiceName(name: string, envSuffix: string): string {
  // Strip common env suffixes to find a canonical name for matching
  return name
    .replace(new RegExp(`[-_]${envSuffix}$`, 'i'), '')
    .replace(new RegExp(`-${envSuffix}$`, 'i'), '');
}

async function describeTaskDef(ecsClient: ECSClient, taskDefArn: string): Promise<TaskDefDetails> {
  const res = await ecsClient.send(new DescribeTaskDefinitionCommand({ taskDefinition: taskDefArn }));
  const containers = res.taskDefinition?.containerDefinitions ?? [];
  const primary = containers[0];

  return {
    image: primary?.image ?? null,
    cpu: res.taskDefinition?.cpu ?? null,
    memory: res.taskDefinition?.memory ?? null,
    envVarCount: primary?.environment?.length ?? 0,
  };
}

function compareDetails(staging: TaskDefDetails, production: TaskDefDetails): DriftItem[] {
  const items: DriftItem[] = [];

  if (staging.image !== production.image) {
    items.push({
      field: 'image',
      stagingValue: staging.image ?? '(none)',
      productionValue: production.image ?? '(none)',
    });
  }

  if (staging.cpu !== production.cpu) {
    items.push({
      field: 'cpu',
      stagingValue: staging.cpu ?? '(none)',
      productionValue: production.cpu ?? '(none)',
    });
  }

  if (staging.memory !== production.memory) {
    items.push({
      field: 'memory',
      stagingValue: staging.memory ?? '(none)',
      productionValue: production.memory ?? '(none)',
    });
  }

  if (staging.envVarCount !== production.envVarCount) {
    items.push({
      field: 'envVarCount',
      stagingValue: String(staging.envVarCount),
      productionValue: String(production.envVarCount),
    });
  }

  return items;
}

async function writeDriftEntry(
  dynamo: DynamoDBDocumentClient,
  tableName: string,
  entry: DriftCacheEntry,
): Promise<void> {
  await dynamo.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `DRIFT#${entry.serviceId}`,
        SK: 'LATEST',
        GSI1PK: 'DRIFT',
        GSI1SK: entry.serviceId,
        ...entry,
      },
    }),
  );
}

export async function driftCacheJob(): Promise<void> {
  const stagingCluster = process.env['STAGING_CLUSTER'] ?? 'wep-staging';
  const productionCluster = process.env['PRODUCTION_CLUSTER'] ?? 'wep-production';
  const region = process.env['AWS_REGION'] ?? 'me-south-1';
  const computedAt = new Date().toISOString();

  const ecsClient = new ECSClient({
    region,
    credentials: credentialStore.getProvider(),
  });

  const dynamo = createDynamoDBClient();
  const tableName = getTableName('drift-cache');

  // List all services in both clusters
  const [stagingArns, productionArns] = await Promise.all([
    listAllServices(ecsClient, stagingCluster),
    listAllServices(ecsClient, productionCluster),
  ]);

  // Describe all services to get task definition ARNs
  const chunkSize = 10;
  const stagingServiceMap = new Map<string, string>(); // normalised name -> taskDefArn
  const productionServiceMap = new Map<string, string>();

  // Describe staging services in chunks
  for (let i = 0; i < stagingArns.length; i += chunkSize) {
    const chunk = stagingArns.slice(i, i + chunkSize);
    try {
      const res = await ecsClient.send(
        new DescribeServicesCommand({ cluster: stagingCluster, services: chunk }),
      );
      for (const svc of res.services ?? []) {
        if (svc.serviceName && svc.taskDefinition) {
          const normName = normaliseServiceName(svc.serviceName, 'staging');
          stagingServiceMap.set(normName, svc.taskDefinition);
        }
      }
    } catch (err) {
      console.error(`[drift-cache] Failed describing staging chunk ${i}: ${(err as Error).message}`);
    }
  }

  // Describe production services in chunks
  for (let i = 0; i < productionArns.length; i += chunkSize) {
    const chunk = productionArns.slice(i, i + chunkSize);
    try {
      const res = await ecsClient.send(
        new DescribeServicesCommand({ cluster: productionCluster, services: chunk }),
      );
      for (const svc of res.services ?? []) {
        if (svc.serviceName && svc.taskDefinition) {
          const normName = normaliseServiceName(svc.serviceName, 'production');
          productionServiceMap.set(normName, svc.taskDefinition);
        }
      }
    } catch (err) {
      console.error(`[drift-cache] Failed describing production chunk ${i}: ${(err as Error).message}`);
    }
  }

  // Find matching pairs and compare
  let totalServices = 0;
  let driftCount = 0;

  for (const [normName, stagingTaskDefArn] of stagingServiceMap.entries()) {
    const productionTaskDefArn = productionServiceMap.get(normName);
    if (!productionTaskDefArn) continue; // no production counterpart

    totalServices++;

    try {
      const [stagingDetails, productionDetails] = await Promise.all([
        describeTaskDef(ecsClient, stagingTaskDefArn),
        describeTaskDef(ecsClient, productionTaskDefArn),
      ]);

      const driftItems = compareDetails(stagingDetails, productionDetails);
      const hasDrift = driftItems.length > 0;
      if (hasDrift) driftCount++;

      const entry: DriftCacheEntry = {
        serviceId: normName,
        serviceName: normName,
        hasDrift,
        stagingImage: stagingDetails.image,
        productionImage: productionDetails.image,
        driftItems,
        computedAt,
      };

      await writeDriftEntry(dynamo, tableName, entry);
    } catch (err) {
      console.error(`[drift-cache] Failed comparing ${normName}: ${(err as Error).message}`);
    }
  }

  // Write run metadata
  await dynamo.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: 'DRIFT_RUN',
        SK: 'LATEST',
        GSI1PK: 'DRIFT_RUN',
        GSI1SK: 'LATEST',
        computedAt,
        totalServices,
        driftCount,
      },
    }),
  );

  console.log(`[drift-cache] Compared ${totalServices} service pairs, ${driftCount} with drift.`);
}
