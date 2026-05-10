export { createDynamoDBClient, getTableName } from './dynamodb.js';
export { createEventBridgeClient, getBusName } from './eventbridge.js';
export { getSecret } from './secrets.js';
export { credentialStore, type CredentialOverride, type CredentialSource } from './credential-store.js';
export { regionStore } from './region-store.js';

export { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
export {
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  DeleteCommand,
  UpdateCommand,
  BatchGetCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
export { EventBridgeClient } from '@aws-sdk/client-eventbridge';
export { ECSClient, ListClustersCommand, ListServicesCommand, DescribeServicesCommand, DescribeTaskDefinitionCommand } from '@aws-sdk/client-ecs';
export { LambdaClient, ListFunctionsCommand, GetFunctionCommand } from '@aws-sdk/client-lambda';
export { CloudFormationClient, ListStacksCommand, ListStackResourcesCommand } from '@aws-sdk/client-cloudformation';
export {
  CloudWatchClient,
  GetMetricDataCommand,
  DescribeAlarmsCommand,
  DescribeAlarmHistoryCommand,
  type MetricAlarm,
  type MetricDataQuery,
  type MetricDataResult,
  type AlarmHistoryItem,
} from '@aws-sdk/client-cloudwatch';
export {
  ElasticLoadBalancingV2Client,
  DescribeTargetGroupsCommand,
  DescribeLoadBalancersCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2';
export { STSClient, GetCallerIdentityCommand, AssumeRoleCommand } from '@aws-sdk/client-sts';
export {
  SecretsManagerClient,
  CreateSecretCommand,
  PutSecretValueCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
export { SNSClient, ListTopicsCommand, PublishCommand } from '@aws-sdk/client-sns';
export {
  RDSClient,
  DescribeDBInstancesCommand,
  ListTagsForResourceCommand,
} from '@aws-sdk/client-rds';
export {
  ResourceGroupsTaggingAPIClient,
  GetResourcesCommand,
} from '@aws-sdk/client-resource-groups-tagging-api';
export { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';
export {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  DescribeLogStreamsCommand,
  GetLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
export {
  SQSClient,
  ListQueuesCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs';
export {
  SFNClient,
  ListStateMachinesCommand,
  StartExecutionCommand,
} from '@aws-sdk/client-sfn';
export {
  APIGatewayClient,
  GetRestApisCommand,
} from '@aws-sdk/client-api-gateway';
export {
  FirehoseClient,
  ListDeliveryStreamsCommand,
} from '@aws-sdk/client-firehose';
export {
  RedshiftClient,
  GetClusterCredentialsCommand,
  DescribeClustersCommand,
} from '@aws-sdk/client-redshift';
export {
  CostExplorerClient,
  GetCostAndUsageCommand,
  type GetCostAndUsageCommandInput,
} from '@aws-sdk/client-cost-explorer';
export {
  EC2Client,
  DescribeVpcsCommand,
  DescribeSubnetsCommand,
  DescribeSecurityGroupsCommand,
  DescribeInstancesCommand,
} from '@aws-sdk/client-ec2';
export {
  ACMClient,
  ListCertificatesCommand,
  DescribeCertificateCommand,
} from '@aws-sdk/client-acm';
export {
  CloudFrontClient,
  ListDistributionsCommand,
} from '@aws-sdk/client-cloudfront';
export {
  Route53Client,
  ListHostedZonesCommand,
  ListResourceRecordSetsCommand,
} from '@aws-sdk/client-route-53';
export {
  WAFV2Client,
  ListWebACLsCommand,
  GetWebACLCommand,
  ListResourcesForWebACLCommand,
} from '@aws-sdk/client-wafv2';
export {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
export {
  SSOAdminClient,
  ListInstancesCommand,
} from '@aws-sdk/client-sso-admin';
export {
  IdentitystoreClient,
  GetUserIdCommand,
  DescribeUserCommand,
  ListGroupMembershipsForMemberCommand,
  DescribeGroupCommand,
} from '@aws-sdk/client-identitystore';
export {
  BudgetsClient,
  DescribeBudgetsCommand,
} from '@aws-sdk/client-budgets';
export {
  IAMClient,
  CreateRoleCommand,
  PutRolePolicyCommand,
  DeleteRolePolicyCommand,
  DeleteRoleCommand,
  TagRoleCommand,
  ListRolesCommand,
  AttachRolePolicyCommand,
  DetachRolePolicyCommand,
  ListAttachedRolePoliciesCommand,
} from '@aws-sdk/client-iam';
export {
  ApplicationAutoScalingClient,
  DescribeScalableTargetsCommand,
  DescribeScalingPoliciesCommand,
} from '@aws-sdk/client-application-auto-scaling';
export {
  SchedulerClient,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  GetScheduleCommand,
  type CreateScheduleCommandInput,
} from '@aws-sdk/client-scheduler';
