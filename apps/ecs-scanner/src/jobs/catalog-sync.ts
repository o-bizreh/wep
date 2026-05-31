import {
  ReconciliationService,
  GitHubOrgCrawler,
  AWSResourceScanner,
  DynamoDBServiceRepository,
  DynamoDBTeamRepository,
} from '@wep/service-catalog';
import { createDynamoDBClient, getTableName, createEventBridgeClient } from '@wep/aws-clients';
import { EventPublisher } from '@wep/event-bus';

export async function catalogSyncJob(): Promise<void> {
  const dynamoClient = createDynamoDBClient();
  const catalogTable = getTableName('service-catalog');

  const serviceRepo = new DynamoDBServiceRepository(dynamoClient, catalogTable);
  const teamRepo = new DynamoDBTeamRepository(dynamoClient, catalogTable);

  const eventPublisher = new EventPublisher(createEventBridgeClient());

  const reconciliation = new ReconciliationService(
    serviceRepo,
    teamRepo,
    new GitHubOrgCrawler(),
    new AWSResourceScanner(),
    eventPublisher,
  );

  await reconciliation.run();
}
