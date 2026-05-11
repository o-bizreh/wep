import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createDynamoDBClient, getTableName, createEventBridgeClient } from '@wep/aws-clients';
import { EventPublisher } from '@wep/event-bus';

import {
  createCatalogRouter,
  RegisterServiceHandler,
  UpdateServiceOwnershipHandler,
  DeregisterServiceHandler,
  GetServiceHandler,
  SearchServicesHandler,
  GetDependencyGraphHandler,
  GetDependentsHandler,
  GetTeamHandler,
  ListTeamsHandler,
  DynamoDBServiceRepository,
  DynamoDBTeamRepository,
  DynamoDBDependencyRepository,
  ResolveAwsMappingHandler,
  ReconciliationService,
  GitHubOrgCrawler,
  AWSResourceScanner,
} from '@wep/service-catalog';

import {
  createDeploymentRouter,
  createWebhookRouter,
  RecordDeploymentStartedHandler,
  RecordDeploymentCompletedHandler,
  GetCurrentStateHandler,
  GetEnvironmentDiffHandler,
  ListDeploymentsHandler,
  DynamoDBDeploymentRepository,
  GitHubCommitComparator,
} from '@wep/deployment-tracker';

import {
  createVelocityRouter,
  GetTeamMetricsHandler,
  GetOrgDashboardHandler,
  DynamoDBMetricRepository,
} from '@wep/velocity-metrics';

import {
  createPipelineRouter,
  GetPipelineHealthHandler,
  GetFailureAnalysisHandler,
  GetCostBreakdownHandler,
  DynamoDBPipelineRepository,
} from '@wep/pipeline-analytics';

import {
  createCostRouter,
  GetCostDashboardHandler,
  DynamoDBCostRepository,
} from '@wep/cost-intelligence';

import {
  createSecurityRouter,
  DynamoDBSecurityRepository,
} from '@wep/security';

import {
  createPortalRouter,
  SubmitRequestHandler,
  ApproveRequestHandler,
  RejectRequestHandler,
  CredentialDispatcher,
  AutoApprovalEvaluator,
  RequesterContextService,
  ResourceTagResolver,
  GetOperationCatalogHandler,
  GetRequestHistoryHandler,
  GetPendingApprovalsHandler,
  DynamoDBPortalRepository,
  RevokeJitSessionHandler,
  DeleteExpiredJitRolesHandler,
} from '@wep/self-service';

import { errorHandler, notFoundHandler } from './plugins/error-handler.js';
import { createSettingsRouter } from './routes/settings-router.js';
import { createDashboardRouter } from './routes/dashboard-router.js';
import { createErrorsRouter } from './routes/errors-router.js';
import { createProjectsRouter } from './routes/projects-router.js';
import { createSprintRouter } from './routes/sprint-router.js';
import { createQualityRouter } from './routes/quality-router.js';
import { createSlackInteractionsRouter } from './routes/slack-interactions-router.js';
import { createAnnouncementsRouter } from './routes/announcements-router.js';
import { createTechRadarRouter } from './routes/tech-radar-router.js';
import { createRunbookRouter } from './routes/runbook-router.js';
import { createAwsResourcesRouter } from './routes/aws-resources-router.js';
import { createGlobalRouter } from './routes/global-router.js';
import { createAuthRouter } from './routes/auth-router.js';
import { createTeamsRouter } from './routes/teams-router.js';
import { createAiRouter } from './routes/ai-router.js';
import { createAiInfraRouter } from './routes/ai-infra-router.js';
import { createCampaignRevertRouter } from './routes/campaign-revert-router.js';
import { createPortfolioRouter } from './routes/portfolio-router.js';

export function createServer(): import('express').Express {
  const app = express();

  // --- Middleware ---
  app.use(helmet());
  app.use(cors({
    origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:5173',
    credentials: true,
  }));

  // Webhook routes MUST be mounted before express.json() so we can read the raw body
  // for HMAC-SHA256 signature verification. express.raw() captures bytes as Buffer.
  app.use('/api/v1/webhooks/github', express.raw({ type: '*/*' }));
  // Slack interactions need the raw body too — Slack signs it. Capture as Buffer
  // and store on req.rawBody so the verification middleware can read it.
  app.use('/api/v1/slack/interactions', express.raw({ type: '*/*' }), (req, _res, next) => {
    (req as { rawBody?: Buffer }).rawBody = req.body as Buffer;
    next();
  });

  app.use(express.json({ limit: '5mb' }));

  const readLimiter = rateLimit({ windowMs: 60_000, max: 100 });
  const writeLimiter = rateLimit({ windowMs: 60_000, max: 20 });

  // --- AWS Clients ---
  const dynamoClient = createDynamoDBClient();
  const eventPublisher = new EventPublisher(createEventBridgeClient());

  // --- Service Catalog ---
  const catalogTable = getTableName('service-catalog');
  const serviceRepo = new DynamoDBServiceRepository(dynamoClient, catalogTable);
  const teamRepo = new DynamoDBTeamRepository(dynamoClient, catalogTable);
  const depRepo = new DynamoDBDependencyRepository(dynamoClient, catalogTable);

  const reconciliation = new ReconciliationService(
    serviceRepo,
    teamRepo,
    new GitHubOrgCrawler(),
    new AWSResourceScanner(),
    eventPublisher,
  );

  const catalogRouter = createCatalogRouter({
    registerService: new RegisterServiceHandler(serviceRepo, eventPublisher),
    updateOwnership: new UpdateServiceOwnershipHandler(serviceRepo, teamRepo, eventPublisher),
    deregisterService: new DeregisterServiceHandler(serviceRepo, eventPublisher),
    getService: new GetServiceHandler(serviceRepo),
    searchServices: new SearchServicesHandler(serviceRepo),
    getDependencyGraph: new GetDependencyGraphHandler(depRepo),
    getDependents: new GetDependentsHandler(depRepo),
    getTeam: new GetTeamHandler(teamRepo),
    listTeams: new ListTeamsHandler(teamRepo),
    resolveAwsMapping: new ResolveAwsMappingHandler(serviceRepo),
    reconciliation,
  });

  // --- Deployment Tracker ---
  const deployTable = getTableName('deployment-tracker');
  const deployRepo = new DynamoDBDeploymentRepository(dynamoClient, deployTable);
  const commitComparator = new GitHubCommitComparator();

  const deploymentRouter = createDeploymentRouter({
    recordStarted: new RecordDeploymentStartedHandler(deployRepo, eventPublisher),
    recordCompleted: new RecordDeploymentCompletedHandler(deployRepo, eventPublisher),
    getCurrentState: new GetCurrentStateHandler(deployRepo),
    getEnvironmentDiff: new GetEnvironmentDiffHandler(deployRepo, commitComparator),
    listDeployments: new ListDeploymentsHandler(deployRepo),
  });

  // --- Velocity Metrics ---
  const velocityTable = getTableName('velocity-metrics');
  const metricRepo = new DynamoDBMetricRepository(dynamoClient, velocityTable);

  const velocityRouter = createVelocityRouter({
    getTeamMetrics: new GetTeamMetricsHandler(metricRepo),
    getOrgDashboard: new GetOrgDashboardHandler(metricRepo),
    metricRepo,
  });

  // --- Pipeline Analytics ---
  const pipelineTable = getTableName('pipeline-analytics');
  const pipelineRepo = new DynamoDBPipelineRepository(dynamoClient, pipelineTable);

  const pipelineRouter = createPipelineRouter({
    getPipelineHealth: new GetPipelineHealthHandler(pipelineRepo),
    getFailureAnalysis: new GetFailureAnalysisHandler(pipelineRepo),
    getCostBreakdown: new GetCostBreakdownHandler(pipelineRepo),
    pipelineRepo,
  });

  // --- Cost Intelligence ---
  const costTable = getTableName('cost-intelligence');
  const costRepo = new DynamoDBCostRepository(dynamoClient, costTable);

  const costRouter = createCostRouter({
    getCostDashboard: new GetCostDashboardHandler(costRepo),
    costRepo,
  });

  // --- Self-Service Portal ---
  const portalTable = getTableName('self-service');
  const portalRepo = new DynamoDBPortalRepository(dynamoClient, portalTable);

  // Background JIT session revocation loop — runs every 30 s inside the API process.
  // Queries the DynamoDB GSI2 (JIT_STATUS#active / expiresAt) for sessions past their TTL.
  const revokeHandler = new RevokeJitSessionHandler(portalRepo);
  setInterval(() => {
    portalRepo.listExpiredActiveSessions().then(async (result) => {
      if (!result.ok) { console.error('[jit-revoke] Failed to list expired sessions:', result.error.message); return; }
      for (const session of result.value) {
        const r = await revokeHandler.execute(session.sessionId, 'scheduler');
        if (!r.ok) console.error(`[jit-revoke] Failed to revoke session ${session.sessionId}:`, r.error.message);
      }
    }).catch((e) => console.error('[jit-revoke] Unhandled error:', e));
  }, 30_000);

  // Background cleanup: delete expired wep-jit-* IAM roles every 15 minutes.
  const deleteExpiredRolesHandler = new DeleteExpiredJitRolesHandler();
  setInterval(() => {
    deleteExpiredRolesHandler.execute().then(({ deleted, errors }) => {
      if (deleted.length > 0) console.info(`[jit-cleanup] Deleted ${deleted.length} expired IAM role(s): ${deleted.join(', ')}`);
      if (errors.length > 0) console.warn(`[jit-cleanup] Errors: ${errors.join(' | ')}`);
    }).catch((e) => console.error('[jit-cleanup] Unhandled error:', e));
  }, 15 * 60 * 1000);

  // Act-overhaul services
  const credentialDispatcher = new CredentialDispatcher(portalRepo);
  const resourceTagResolver = new ResourceTagResolver();
  const autoApprovalEvaluator = new AutoApprovalEvaluator(undefined, resourceTagResolver);
  // RequesterContext now reads the user's stored profile (department/userType
  // self-declared in Settings). Auto-approval rules with `requesterDepartment`
  // / `requesterUserType` / `resourceOwnerTagEquals` evaluate live against this
  // + the resource's tags.
  const requesterContextResolver = new RequesterContextService(portalRepo);

  const portalRouter = createPortalRouter({
    submitRequest: new SubmitRequestHandler(
      portalRepo,
      eventPublisher,
      credentialDispatcher,
      autoApprovalEvaluator,
      requesterContextResolver,
    ),
    approveRequest: new ApproveRequestHandler(portalRepo, eventPublisher, credentialDispatcher),
    rejectRequest: new RejectRequestHandler(portalRepo, eventPublisher),
    getOperations: new GetOperationCatalogHandler(portalRepo),
    getRequestHistory: new GetRequestHistoryHandler(portalRepo),
    getPendingApprovals: new GetPendingApprovalsHandler(portalRepo),
    portalRepo,
  });

  // Webhook router (no rate limiting — GitHub needs reliable delivery)
  const webhookRouter = createWebhookRouter({ recordCompleted: new RecordDeploymentCompletedHandler(deployRepo, eventPublisher) });

  // --- Routes ---
  app.use('/api/v1/settings', createSettingsRouter());
  app.use('/api/v1/dashboard', readLimiter, createDashboardRouter(
    new SearchServicesHandler(serviceRepo),
    dynamoClient,
    getTableName('runbooks'),
  ));
  app.use('/api/v1/errors', readLimiter, createErrorsRouter());
  app.use('/api/v1/slack/interactions', createSlackInteractionsRouter());
  app.use('/api/v1/measure/projects', readLimiter, createProjectsRouter(new SearchServicesHandler(serviceRepo)));
  app.use('/api/v1/measure/sprint', readLimiter, createSprintRouter());
  app.use('/api/v1/measure/quality', readLimiter, createQualityRouter());
  app.use('/api/v1/announcements', readLimiter, createAnnouncementsRouter());
  app.use('/api/v1/catalog', readLimiter, catalogRouter);
  app.use('/api/v1/deployments', readLimiter, deploymentRouter);
  app.use('/api/v1/webhooks/github', webhookRouter);
  app.use('/api/v1/velocity', readLimiter, velocityRouter);
  app.use('/api/v1/pipelines', readLimiter, pipelineRouter);
  app.use('/api/v1/costs', readLimiter, costRouter);
  app.use('/api/v1/portal', readLimiter, portalRouter);

  // --- Tech Radar ---
  const techRadarTable = getTableName('tech-radar');
  app.use('/api/v1/tech-radar', readLimiter, createTechRadarRouter(dynamoClient, techRadarTable));

  // --- Runbook Studio ---
  const runbooksTable = getTableName('runbooks');
  app.use('/api/v1/runbooks', readLimiter, createRunbookRouter(dynamoClient, runbooksTable));

  // --- AWS Resource browser (for Runbook Studio dropdowns) ---
  app.use('/api/v1/aws-resources', readLimiter, createAwsResourcesRouter());

  // --- Portfolio (dependencies, coupling, recommendations, comparison, budgets) ---
  app.use('/api/v1/portfolio', readLimiter, createPortfolioRouter({
    dynamoDocClient: dynamoClient,
    costTableName: costTable,
  }));
  app.use('/api/v1/global', readLimiter, createGlobalRouter());
  app.use('/api/v1/ai', writeLimiter, createAiRouter());
  app.use('/api/v1/ai', writeLimiter, createAiInfraRouter());
  app.use('/api/v1/campaign-reverts', writeLimiter, createCampaignRevertRouter());

  // --- Security ---
  const securityTable = getTableName('security');
  const securityRepo = new DynamoDBSecurityRepository(dynamoClient, securityTable);
  app.use('/api/v1/security', readLimiter, createSecurityRouter(securityRepo));

  // --- Auth + Teams ---
  const teamsTable = getTableName('teams');
  app.use('/api/v1/auth', readLimiter, createAuthRouter(dynamoClient, teamsTable));
  app.use('/api/v1/teams', readLimiter, createTeamsRouter(dynamoClient, teamsTable));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), dynamoEndpoint: process.env['AWS_ENDPOINT_URL'] ?? 'not set' });
  });

  // --- Error handling ---
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
