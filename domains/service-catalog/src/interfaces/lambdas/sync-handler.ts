import { createDynamoDBClient, getTableName, createEventBridgeClient } from '@wep/aws-clients';
import { EventPublisher } from '@wep/event-bus';
import { DynamoDBServiceRepository } from '../../infrastructure/dynamodb/service-repository.js';
import { DynamoDBTeamRepository } from '../../infrastructure/dynamodb/team-repository.js';
import { GitHubOrgCrawler } from '../../infrastructure/github/github-crawler.js';
import { AWSResourceScanner } from '../../infrastructure/aws/aws-scanner.js';
import { ReconciliationService } from '../../application/services/reconciliation-service.js';

const ORG = process.env['GITHUB_ORG'] ?? 'washmen';

const dynamoClient = createDynamoDBClient();
const tableName = getTableName('service-catalog');
const serviceRepo = new DynamoDBServiceRepository(dynamoClient, tableName);
const teamRepo = new DynamoDBTeamRepository(dynamoClient, tableName);
const githubCrawler = new GitHubOrgCrawler();
const awsScanner = new AWSResourceScanner();
const eventPublisher = new EventPublisher(createEventBridgeClient());

const reconciliationService = new ReconciliationService(
  serviceRepo,
  teamRepo,
  githubCrawler,
  awsScanner,
  eventPublisher,
);

export async function handler(): Promise<void> {
  console.log('Starting service catalog sync...');

  const result = await reconciliationService.reconcile(ORG);

  if (!result.ok) {
    console.error('Reconciliation failed:', JSON.stringify(result.error));
    throw new Error(result.error.message);
  }

  console.log('Service catalog sync completed successfully');
}
