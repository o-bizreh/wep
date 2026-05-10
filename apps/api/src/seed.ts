/**
 * Seed script — populates WEP with realistic Washmen sample data.
 *
 * Prerequisites:
 *   1. Start DynamoDB Local (Docker):
 *      docker run -d -p 8000:8000 amazon/dynamodb-local
 *
 *   2. Create tables:
 *      npx tsx apps/api/src/create-tables.ts
 *
 *   3. Run seed:
 *      npx tsx apps/api/src/seed.ts
 *
 * The script reads AWS_ENDPOINT_URL from your .env (already set to DynamoDB Local).
 */

import 'dotenv/config';
import { createDynamoDBClient, getTableName, createEventBridgeClient } from '@wep/aws-clients';
import { EventPublisher } from '@wep/event-bus';
import type { DomainEvent, DomainError, Domain } from '@wep/domain-types';

// Service Catalog
import {
  RegisterServiceHandler,
  DynamoDBServiceRepository,
  DynamoDBTeamRepository,
  DynamoDBDependencyRepository,
  type Team,
} from '@wep/service-catalog';

// Deployment Tracker
import {
  RecordDeploymentStartedHandler,
  RecordDeploymentCompletedHandler,
  DynamoDBDeploymentRepository,
} from '@wep/deployment-tracker';

// ─── Infrastructure ───────────────────────────────────────────────────────────

const APP_ENV = process.env['NODE_ENV'] ?? 'development';
const dynamo  = createDynamoDBClient();

// EventBridge won't be available locally — pass a stub that matches the interface
const publisher = {
  async publish<T>(_src: string, _type: string, _event: DomainEvent<T>) { return; },
  async publishBatch<T>(_src: string, _type: string, _events: DomainEvent<T>[]) { return; },
} as unknown as EventPublisher;

const catalogTable    = getTableName('service-catalog',    APP_ENV);
const deploymentTable = getTableName('deployment-tracker', APP_ENV);

const teamRepo       = new DynamoDBTeamRepository(dynamo,    catalogTable);
const serviceRepo    = new DynamoDBServiceRepository(dynamo, catalogTable);
const depRepo        = new DynamoDBDependencyRepository(dynamo, catalogTable);

const registerService = new RegisterServiceHandler(serviceRepo, publisher);
const recordStarted   = new RecordDeploymentStartedHandler(
  new DynamoDBDeploymentRepository(dynamo, deploymentTable),
  publisher,
);
const recordCompleted = new RecordDeploymentCompletedHandler(
  new DynamoDBDeploymentRepository(dynamo, deploymentTable),
  publisher,
);

// ─── Sample data ──────────────────────────────────────────────────────────────

const TEAMS: Array<Omit<Team, 'serviceIds'>> = [
  {
    teamId: 'team_platform', teamName: 'Platform', domain: 'DevOps' as Domain, githubTeamSlug: 'platform', slackChannelId: 'C0PLATFORM',
    members: [
      { userId: 'u1', role: 'lead'   },
      { userId: 'u2', role: 'member' },
      { userId: 'u3', role: 'member' },
      { userId: 'u4', role: 'member' },
      { userId: 'u5', role: 'member' },
    ],
  },
  {
    teamId: 'team_consumer', teamName: 'Consumer', domain: 'CustomerDomain' as Domain, githubTeamSlug: 'consumer', slackChannelId: 'C0CONSUMER',
    members: [
      { userId: 'u6',  role: 'lead'   },
      { userId: 'u7',  role: 'member' },
      { userId: 'u8',  role: 'member' },
      { userId: 'u9',  role: 'member' },
      { userId: 'u10', role: 'member' },
      { userId: 'u11', role: 'member' },
    ],
  },
  {
    teamId: 'team_ops', teamName: 'Operations', domain: 'DevOps' as Domain, githubTeamSlug: 'ops', slackChannelId: 'C0OPS',
    members: [
      { userId: 'u12', role: 'lead'   },
      { userId: 'u13', role: 'member' },
      { userId: 'u14', role: 'member' },
      { userId: 'u15', role: 'member' },
    ],
  },
  {
    teamId: 'team_data', teamName: 'Data & Analytics', domain: 'DataDomain' as Domain, githubTeamSlug: 'data', slackChannelId: 'C0DATA',
    members: [
      { userId: 'u16', role: 'lead'   },
      { userId: 'u17', role: 'member' },
      { userId: 'u18', role: 'member' },
    ],
  },
];

const SERVICES = [
  { name: 'api-gateway',          team: 'team_platform',  runtime: 'ecs'           as const, envs: ['production', 'staging', 'development'] as const },
  { name: 'auth-service',         team: 'team_platform',  runtime: 'ecs'           as const, envs: ['production', 'staging', 'development'] as const },
  { name: 'notification-worker',  team: 'team_platform',  runtime: 'lambda'        as const, envs: ['production', 'staging']               as const },
  { name: 'config-service',       team: 'team_platform',  runtime: 'ecs'           as const, envs: ['production', 'staging', 'development'] as const },
  { name: 'customer-app-bff',     team: 'team_consumer',  runtime: 'ecs'           as const, envs: ['production', 'staging', 'development'] as const },
  { name: 'order-service',        team: 'team_consumer',  runtime: 'ecs'           as const, envs: ['production', 'staging', 'development'] as const },
  { name: 'pricing-engine',       team: 'team_consumer',  runtime: 'lambda'        as const, envs: ['production', 'staging']               as const },
  { name: 'feedback-service',     team: 'team_consumer',  runtime: 'ecs'           as const, envs: ['production', 'staging']               as const },
  { name: 'promo-service',        team: 'team_consumer',  runtime: 'lambda'        as const, envs: ['production', 'staging']               as const },
  { name: 'driver-app-bff',       team: 'team_ops',       runtime: 'ecs'           as const, envs: ['production', 'staging', 'development'] as const },
  { name: 'routing-service',      team: 'team_ops',       runtime: 'ecs'           as const, envs: ['production', 'staging', 'development'] as const },
  { name: 'tracking-worker',      team: 'team_ops',       runtime: 'lambda'        as const, envs: ['production', 'staging']               as const },
  { name: 'capacity-planner',     team: 'team_ops',       runtime: 'step-function' as const, envs: ['production', 'staging']               as const },
  { name: 'analytics-pipeline',   team: 'team_data',      runtime: 'lambda'        as const, envs: ['production', 'staging']               as const },
  { name: 'reporting-api',        team: 'team_data',      runtime: 'ecs'           as const, envs: ['production', 'staging']               as const },
  { name: 'ml-scoring-service',   team: 'team_data',      runtime: 'lambda'        as const, envs: ['production', 'staging']               as const },
];

// serviceId returned after registration, keyed by service name
const serviceIds: Record<string, string> = {};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hoursAgo(n: number) {
  return new Date(Date.now() - n * 3_600_000).toISOString();
}

function sha() {
  return Math.random().toString(16).slice(2, 9).padEnd(7, '0');
}

const ACTORS = ['omar', 'sara', 'karim', 'layla', 'rami', 'hassan', 'dina', 'youssef'];
const actor  = () => ACTORS[Math.floor(Math.random() * ACTORS.length)]!;

function ok(msg: string)   { console.log(`  ✓  ${msg}`); }
function warn(msg: string) { console.warn(`  ⚠  ${msg}`); }

// ─── Steps ────────────────────────────────────────────────────────────────────

async function seedTeams() {
  console.log('👥  Seeding teams...');
  for (const t of TEAMS) {
    const result = await teamRepo.save({ ...t, serviceIds: [] });
    if (!result.ok) { warn(`${t.teamName}: ${result.error.message}`); continue; }
    ok(`${t.teamName}  (${t.teamId})`);
  }
  console.log();
}

async function seedServices() {
  console.log('📦  Registering services...');
  for (const svc of SERVICES) {
    const teamResult = await teamRepo.findById(svc.team);
    if (!teamResult.ok || !teamResult.value) {
      warn(`${svc.name}: team ${svc.team} not found`); continue;
    }
    const team = teamResult.value;

    const result = await registerService.execute({
      serviceName:     svc.name,
      repositoryUrl:   `https://github.com/washmen/${svc.name}`,
      runtimeType:     svc.runtime,
      ownerTeam: {
        teamId:        team.teamId,
        teamName:      team.teamName,
        domain:        team.domain,
        memberCount:   team.members.length,
        slackChannelId: team.slackChannelId,
      },
      environments:    svc.envs as unknown as ('production' | 'staging' | 'development')[],
      discoveryMethod: 'manual',
      metadata:        { language: 'typescript' },
    });

    if (!result.ok) { warn(`${svc.name}: ${result.error.message}`); continue; }
    serviceIds[svc.name] = result.value.serviceId;
    ok(`${svc.name}  →  ${result.value.serviceId}`);
  }
  console.log();
}

async function seedDeployments() {
  console.log('🚀  Recording deployments...');

  type Spec = {
    svc: string; env: string; hoursBack: number;
    status: 'success' | 'failure' | 'started'; durSec: number;
  };

  const specs: Spec[] = [
    // api-gateway — frequent releases, one failure+recovery
    { svc: 'api-gateway',         env: 'production',  hoursBack: 2,    status: 'success', durSec: 142 },
    { svc: 'api-gateway',         env: 'staging',     hoursBack: 5,    status: 'success', durSec: 98  },
    { svc: 'api-gateway',         env: 'production',  hoursBack: 26,   status: 'success', durSec: 137 },
    { svc: 'api-gateway',         env: 'production',  hoursBack: 50,   status: 'failure', durSec: 45  },
    { svc: 'api-gateway',         env: 'production',  hoursBack: 50.5, status: 'success', durSec: 151 },
    { svc: 'api-gateway',         env: 'production',  hoursBack: 98,   status: 'success', durSec: 140 },
    // auth-service
    { svc: 'auth-service',        env: 'production',  hoursBack: 10,   status: 'success', durSec: 203 },
    { svc: 'auth-service',        env: 'staging',     hoursBack: 12,   status: 'success', durSec: 178 },
    { svc: 'auth-service',        env: 'production',  hoursBack: 58,   status: 'success', durSec: 210 },
    { svc: 'auth-service',        env: 'production',  hoursBack: 120,  status: 'success', durSec: 198 },
    // order-service — busiest, one staging failure
    { svc: 'order-service',       env: 'production',  hoursBack: 1,    status: 'success', durSec: 89  },
    { svc: 'order-service',       env: 'staging',     hoursBack: 3,    status: 'success', durSec: 72  },
    { svc: 'order-service',       env: 'production',  hoursBack: 25,   status: 'success', durSec: 91  },
    { svc: 'order-service',       env: 'production',  hoursBack: 49,   status: 'success', durSec: 88  },
    { svc: 'order-service',       env: 'staging',     hoursBack: 51,   status: 'failure', durSec: 18  },
    { svc: 'order-service',       env: 'staging',     hoursBack: 51.5, status: 'success', durSec: 85  },
    { svc: 'order-service',       env: 'production',  hoursBack: 73,   status: 'success', durSec: 90  },
    // pricing-engine — staging failure, hotfix
    { svc: 'pricing-engine',      env: 'production',  hoursBack: 18,   status: 'success', durSec: 34  },
    { svc: 'pricing-engine',      env: 'staging',     hoursBack: 20,   status: 'failure', durSec: 22  },
    { svc: 'pricing-engine',      env: 'staging',     hoursBack: 20.5, status: 'success', durSec: 31  },
    { svc: 'pricing-engine',      env: 'production',  hoursBack: 96,   status: 'success', durSec: 33  },
    // routing-service
    { svc: 'routing-service',     env: 'production',  hoursBack: 6,    status: 'success', durSec: 118 },
    { svc: 'routing-service',     env: 'staging',     hoursBack: 8,    status: 'success', durSec: 104 },
    { svc: 'routing-service',     env: 'production',  hoursBack: 30,   status: 'success', durSec: 122 },
    { svc: 'routing-service',     env: 'production',  hoursBack: 78,   status: 'success', durSec: 115 },
    // customer-app-bff — currently deploying to staging
    { svc: 'customer-app-bff',    env: 'staging',     hoursBack: 0.2,  status: 'started', durSec: 0   },
    { svc: 'customer-app-bff',    env: 'production',  hoursBack: 14,   status: 'success', durSec: 163 },
    { svc: 'customer-app-bff',    env: 'production',  hoursBack: 62,   status: 'success', durSec: 158 },
    // tracking-worker
    { svc: 'tracking-worker',     env: 'production',  hoursBack: 36,   status: 'success', durSec: 28  },
    { svc: 'tracking-worker',     env: 'staging',     hoursBack: 37,   status: 'success', durSec: 25  },
    // notification-worker
    { svc: 'notification-worker', env: 'production',  hoursBack: 72,   status: 'success', durSec: 19  },
    { svc: 'notification-worker', env: 'staging',     hoursBack: 73,   status: 'success', durSec: 16  },
    // driver-app-bff
    { svc: 'driver-app-bff',      env: 'production',  hoursBack: 20,   status: 'success', durSec: 144 },
    { svc: 'driver-app-bff',      env: 'staging',     hoursBack: 22,   status: 'success', durSec: 131 },
    // analytics-pipeline
    { svc: 'analytics-pipeline',  env: 'production',  hoursBack: 48,   status: 'success', durSec: 55  },
    { svc: 'analytics-pipeline',  env: 'staging',     hoursBack: 49,   status: 'success', durSec: 48  },
    // ml-scoring-service
    { svc: 'ml-scoring-service',  env: 'production',  hoursBack: 120,  status: 'success', durSec: 62  },
    { svc: 'ml-scoring-service',  env: 'staging',     hoursBack: 121,  status: 'success', durSec: 58  },
    // reporting-api
    { svc: 'reporting-api',       env: 'production',  hoursBack: 84,   status: 'success', durSec: 77  },
    // capacity-planner
    { svc: 'capacity-planner',    env: 'production',  hoursBack: 168,  status: 'success', durSec: 41  },
    // feedback-service
    { svc: 'feedback-service',    env: 'production',  hoursBack: 44,   status: 'success', durSec: 93  },
    // promo-service
    { svc: 'promo-service',       env: 'production',  hoursBack: 55,   status: 'success', durSec: 38  },
    // config-service
    { svc: 'config-service',      env: 'production',  hoursBack: 110,  status: 'success', durSec: 109 },
  ];

  for (const s of specs) {
    const serviceId = serviceIds[s.svc];
    if (!serviceId) { warn(`${s.svc}/${s.env}: serviceId missing — was service registration successful?`); continue; }

    const commitSha = sha();
    const startedAt = hoursAgo(s.hoursBack);

    const startResult = await recordStarted.execute({
      serviceId,
      environment:   s.env,
      sha:           commitSha,
      actor:         actor(),
      triggerSource: 'github-actions',
    });
    if (!startResult.ok) { warn(`${s.svc}/${s.env} (start): ${startResult.error.message}`); continue; }

    if (s.status === 'started') {
      ok(`${s.svc}  →  ${s.env}  [in progress]`);
      continue;
    }

    const completedAt = new Date(new Date(startedAt).getTime() + s.durSec * 1000).toISOString();
    const compResult  = await recordCompleted.execute({
      deploymentId: startResult.value.deploymentId,
      status:       s.status,
      completedAt,
      actor:        startResult.value.actor,
    });
    if (!compResult.ok) { warn(`${s.svc}/${s.env} (complete): ${compResult.error.message}`); continue; }

    ok(`${s.svc}  →  ${s.env}  [${s.status}]  ${s.durSec}s`);
  }

  console.log();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱  WEP Seed Script\n');
  console.log(`   DynamoDB endpoint: ${process.env['AWS_ENDPOINT_URL'] ?? 'AWS default (real DynamoDB)'}`);
  console.log(`   Tables:            ${catalogTable}, ${deploymentTable}`);
  console.log();

  await seedTeams();
  await seedServices();
  await seedDeployments();

  console.log('✅  Seed complete!\n');
  console.log('   Start the API:  pnpm --filter @wep/api dev');
  console.log('   Open the UI:    pnpm --filter @wep/web dev\n');
}

main().catch((err) => {
  console.error('\n❌  Seed failed:', err.message ?? err);
  process.exit(1);
});
