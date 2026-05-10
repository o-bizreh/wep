import { settings } from './settings';

const API_BASE = '/api/v1';

function getCredentialHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};

  const token = settings.getGithubToken();
  if (token) headers['X-GitHub-Token'] = token;

  const creds = settings.getAwsCredentials();
  if (creds) {
    headers['X-Aws-Access-Key-Id'] = creds.accessKeyId;
    headers['X-Aws-Secret-Access-Key'] = creds.secretAccessKey;
    if (creds.sessionToken) headers['X-Aws-Session-Token'] = creds.sessionToken;
  }

  return headers;
}

export async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...getCredentialHeaders() },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail ?? `API Error: ${response.status}`);
  }

  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as unknown as T;
  }

  return response.json();
}

export type SyncPhase = 'idle' | 'fetching-repos' | 'aws-enrichment' | 'done' | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  reposSaved: number;
  reposSkipped: number;
  awsEnriched: number;
  awsTotal: number;
  message: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

export interface WorkflowRun {
  runId: number;
  workflowName: string;
  status: string;
  conclusion: string | null;
  environment: string;
  branch: string | null;
  sha: string;
  startedAt: string;
  completedAt: string;
  durationSeconds: number | null;
  htmlUrl: string;
  actor: string | null;
  headCommitMessage: string | null;
}

export const catalogApi = {
  listServices: (params?: Record<string, string>) =>
    fetchApi<{ items: unknown[]; nextCursor?: string }>(`/catalog/services?${new URLSearchParams(params)}`),
  getService: (id: string) => fetchApi(`/catalog/services/${id}`),
  listTeams: (params?: Record<string, string>) =>
    fetchApi<unknown[]>(`/catalog/teams?${new URLSearchParams(params)}`),
  getTeam: (id: string) => fetchApi(`/catalog/teams/${id}`),
  getTeamServices: (id: string) =>
    fetchApi<{ items: unknown[] }>(`/catalog/teams/${id}/services`),
  sync: (org?: string) =>
    fetchApi<{ ok: boolean; message: string }>('/catalog/sync', {
      method: 'POST',
      body: JSON.stringify({ org }),
    }),
  syncStatus: () => fetchApi<SyncStatus>('/catalog/sync/status'),
  getDeploymentPreferences: () =>
    fetchApi<{ watchedRepos: string[] }>('/catalog/deployments/preferences'),
  saveDeploymentPreferences: (watchedRepos: string[]) =>
    fetchApi<{ ok: boolean; watchedRepos: string[] }>('/catalog/deployments/preferences', {
      method: 'PUT',
      body: JSON.stringify({ watchedRepos }),
    }),
  getDeploymentPipelines: () =>
    fetchApi<{
      noRepos: boolean;
      periodDays?: number;
      totalRuns?: number;
      completed?: number;
      inProgress?: number;
      successRate?: number;
      avgDurationSeconds?: number;
      failureByType?: { failure: number; cancelled: number; timed_out: number };
      workflowStats?: Array<{ name: string; total: number; failures: number; failRate: number; avgDuration: number }>;
      repoStats?: Array<{ serviceId: string; serviceName: string; total: number; successes: number; failures: number; failRate: number; avgDurationSeconds: number }>;
      slowestWorkflows?: Array<{ name: string; avgDuration: number; total: number }>;
    }>('/catalog/deployments/pipelines'),
  getDeploymentVelocity: () =>
    fetchApi<{
      noRepos: boolean;
      periodDays?: number;
      watchedRepos?: number;
      totalRuns?: number;
      metrics?: {
        deploymentFrequency: { value: number; classification: string; unit: string };
        changeFailureRate:   { value: number; classification: string };
        leadTimeHours:       { value: number; classification: string };
        mttrHours:           { value: number; classification: string } | null;
      };
      weeklyTrend?: Array<{ week: string; deploys: number; failures: number }>;
      repoBreakdown?: Array<{ serviceId: string; serviceName: string; deploys: number; failures: number; failRate: number }>;
    }>('/catalog/deployments/velocity'),
  getDeploymentFeed: (params?: { environment?: string; page?: number }) =>
    fetchApi<{
      items: Array<{
        serviceId: string; serviceName: string;
        runId: number; workflowName: string; status: string; conclusion: string | null;
        environment: string; branch: string | null; sha: string;
        startedAt: string; completedAt: string; durationSeconds: number | null;
        htmlUrl: string; actor: string | null; commitMessage: string | null;
      }>;
      totalItems: number; page: number; pageSize: number; hasMore: boolean;
    }>(`/catalog/deployments/feed?${new URLSearchParams(
      Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]))
    )}`),
  getServiceStability: (serviceId: string, environment: string, days = 30) =>
    fetchApi<{
      metrics: Array<{ timestamp: string; errors5xx: number; requests2xx: number; latencyP95Ms: number; errorRate: number; unhealthyHosts: number; errors: number }>;
      deployments: Array<{ timestamp: string; branch: string | null; actor: string | null; conclusion: string | null; htmlUrl: string; commitMessage: string | null }>;
      lbType?: string;
      lbName?: string;
      reason?: string;
    }>(`/catalog/services/${serviceId}/stability?environment=${environment}&days=${days}`),
  getServiceLastDeployments: (serviceId: string) =>
    fetchApi<{
      environments: Record<string, {
        runId: number; workflowName: string; branch: string | null;
        actor: string | null; commitMessage: string | null;
        completedAt: string; htmlUrl: string;
      }>;
    }>(`/catalog/services/${serviceId}/last-deployments`),
  getServicePullRequests: (serviceId: string) =>
    fetchApi<{ items: Array<{
      number: number; title: string; author: string; authorAvatarUrl: string;
      authorHtmlUrl: string; createdAt: string; updatedAt: string; draft: boolean;
      htmlUrl: string; labels: string[]; reviewers: string[]; commentsCount: number;
    }> }>(`/catalog/services/${serviceId}/pull-requests`),
  getServiceContributors: (serviceId: string) =>
    fetchApi<{
      topContributors: Array<{ login: string; contributions: number; avatarUrl: string; htmlUrl: string }>;
      topTriggers: Array<{ login: string; count: number }>;
    }>(`/catalog/services/${serviceId}/contributors`),
  getServiceWorkflowRuns: (serviceId: string, limit = 10, page = 1) =>
    fetchApi<{ items: WorkflowRun[]; totalCount: number; page: number; limit: number }>(
      `/catalog/services/${serviceId}/workflow-runs?limit=${limit}&page=${page}`,
    ),
  getStaleServices: () =>
    fetchApi<{
      services: Array<{
        serviceId: string;
        serviceName: string;
        ownerTeam: { teamId: string; teamName: string };
        runtimeType: string;
        environments: string[];
        lastSyncedAt: string;
        daysSinceSync: number;
        healthStatus: string;
        staleReasons: string[];
      }>;
    }>('/catalog/services/stale'),
  getPromotionServices: () =>
    fetchApi<{
      services: Array<{
        serviceId: string;
        serviceName: string;
        ownerTeam: { teamId: string; teamName: string };
        runtimeType: string;
        environments: string[];
        lastSyncedAt: string;
      }>;
    }>('/catalog/services/promotion'),
};

// ─────────────── Project Health (Measure section) ───────────────

export type ProjectSignal =
  | 'high-activity' | 'low-activity' | 'stale' | 'bus-factor-risk'
  | 'deploy-failures' | 'review-backlog' | 'no-deploys' | 'healthy';

interface ProjectPersonCount {
  login: string;
  count: number;
}

export interface ProjectMetrics {
  owner: string;
  repo: string;
  fullName: string;
  defaultBranch: string;
  language: string | null;
  htmlUrl: string;
  topics: string[];
  lastActivityAt: string | null;
  daysSinceActivity: number | null;
  isStale: boolean;
  commits30d: number;
  contributors30d: number;
  topContributor: ProjectPersonCount | null;
  topContributors: ProjectPersonCount[];
  openPrCount: number;
  oldestOpenPrDays: number | null;
  mergedPrs30d: number;
  deploys30d: { production: number; development: number; total: number };
  deploySuccessRate30d: number | null;
  lastDeployAt: { production: string | null; development: string | null };
  topDeployer: {
    production: ProjectPersonCount | null;
    development: ProjectPersonCount | null;
    overall: ProjectPersonCount | null;
  };
  topDeployers: {
    production: ProjectPersonCount[];
    development: ProjectPersonCount[];
    overall: ProjectPersonCount[];
  };
  linkedServiceCount: number;
  signals: ProjectSignal[];
}

export interface ProjectListing {
  owner: string;
  repo: string;
  fullName: string;
  defaultBranch: string;
  language: string | null;
  htmlUrl: string;
  topics: string[];
  linkedServiceCount: number;
}

export interface ProjectsListResponse {
  generatedAt: string;
  staleCutoffDays: number;
  windowDays: number;
  total: number;
  excludedArchived: number;
  repos: ProjectListing[];
}

export interface ProjectOpenPr {
  number: number;
  title: string;
  author: string;
  ageDays: number;
  htmlUrl: string;
  draft: boolean;
}

export interface ProjectRecentRun {
  id: number;
  name: string;
  branch: string | null;
  env: 'production' | 'development' | 'unknown';
  status: string;
  conclusion: string | null;
  actor: string | null;
  startedAt: string;
  durationSeconds: number | null;
  htmlUrl: string;
}

export interface ProjectLinkedAwsResource {
  resourceType: string;
  identifier: string;
  region: string;
  arn?: string;
  clusterName?: string;
  consoleUrl: string;
  errors24h: number | null;
  invocations24h: number | null;
}

export interface ProjectLinkedService {
  serviceId: string;
  serviceName: string;
  environments: string[];
  resources: { production: ProjectLinkedAwsResource[]; development: ProjectLinkedAwsResource[] };
}

export interface ProjectReviewStats {
  sampleSize: number;
  medianTimeToFirstReviewHours: number | null;
  p90TimeToFirstReviewHours: number | null;
}

export interface ProjectCostBreakdown {
  available: boolean;
  reason: string | null;
  monthlyTotal: number | null;
  currency: string | null;
  byTag: { tag: string; amount: number }[];
}

export interface ProjectDetail {
  metrics: ProjectMetrics;
  openPrs: ProjectOpenPr[];
  reviewStats: ProjectReviewStats;
  recentRuns: ProjectRecentRun[];
  linkedServices: ProjectLinkedService[];
  cost: ProjectCostBreakdown;
  generatedAt: string;
}

export const projectsApi = {
  /** Fast list of non-archived repos. Used to render skeleton rows. */
  list: () => fetchApi<ProjectsListResponse>('/measure/projects'),
  /** Per-repo metrics. Each row in the list view fetches this independently. */
  metrics: (owner: string, repo: string) =>
    fetchApi<ProjectMetrics>(`/measure/projects/metrics/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`),
  /** Full drawer detail — open PRs, review stats, AWS resources, errors, cost. */
  detail: (owner: string, repo: string) =>
    fetchApi<ProjectDetail>(`/measure/projects/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`),
};

// ─────────────── Sprint Digest ───────────────

export type SprintWindowKind = '1w' | '2w' | '4w' | 'custom';

export interface SprintShippedPr {
  repo: string;
  number: number;
  title: string;
  author: string;
  branch: string;
  mergedAt: string;
  htmlUrl: string;
}

export interface SprintDeployEntry {
  repo: string;
  workflowName: string;
  branch: string;
  env: 'production' | 'development' | 'unknown';
  actor: string;
  conclusion: string;
  startedAt: string;
  durationSeconds: number | null;
  htmlUrl: string;
  isHotfix: boolean;
  isOffHours: boolean;
}

export interface SprintEngineerEntry {
  login: string;
  prsMerged: number;
  commits: number;
  deploysTriggered: number;
  reposTouched: number;
  repos: string[];
}

export interface SprintQualitySummary {
  mergedPrs: number;
  totalDeploys: number;
  prodDeploys: number;
  deploySuccessRate: number | null;
  hotfixDeploys: number;
  offHoursProdDeploys: number;
  cycleTimeP50Hours: number | null;
  cycleTimeP90Hours: number | null;
}

export interface SprintRepoListing {
  owner: string;
  repo: string;
  fullName: string;
  htmlUrl: string;
  language: string | null;
  pushedAt: string | null;
}

export interface SprintReposResponse {
  windowKind: SprintWindowKind;
  windowStart: string;
  windowEnd: string;
  prevWindowStart: string;
  prevWindowEnd: string;
  windowDays: number;
  repos: SprintRepoListing[];
  excludedArchived: number;
  excludedQuiet: number;
  generatedAt: string;
}

export interface SprintRepoWindowStats {
  mergedPrs: number;
  totalDeploys: number;
  prodDeploys: number;
  succeededDeploys: number;
  completedDeploys: number;
  hotfixDeploys: number;
  offHoursProdDeploys: number;
  cycleTimesHours: number[];
}

export interface SprintRepoEngineerStat {
  prsMerged: number;
  commits: number;
  deploysTriggered: number;
  openPrCount: number;
  oldestOpenPrAgeDays: number | null;
  offHoursCommits: number;
  offHoursDeploys: number;
}

export interface SprintRepoResponse {
  repo: string;
  owner: string;
  windowStart: string;
  windowEnd: string;
  prevWindowStart: string;
  prevWindowEnd: string;
  current: SprintRepoWindowStats;
  previous: SprintRepoWindowStats;
  shipped: SprintShippedPr[];
  deploys: SprintDeployEntry[];
  engineerStats: Record<string, SprintRepoEngineerStat>;
  generatedAt: string;
}

function sprintQuery(window: SprintWindowKind, customStart?: string, customEnd?: string): string {
  const params = new URLSearchParams({ window });
  if (window === 'custom' && customStart) params.set('start', customStart);
  if (window === 'custom' && customEnd) params.set('end', customEnd);
  return params.toString();
}

export const sprintApi = {
  /** Fast list of eligible repos for the window — used to render skeleton rows. */
  repos: (window: SprintWindowKind, customStart?: string, customEnd?: string) =>
    fetchApi<SprintReposResponse>(`/measure/sprint/repos?${sprintQuery(window, customStart, customEnd)}`),
  /** Per-repo sprint data. The page fans out one of these per row. */
  repo: (owner: string, repo: string, window: SprintWindowKind, customStart?: string, customEnd?: string) =>
    fetchApi<SprintRepoResponse>(
      `/measure/sprint/repo/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}?${sprintQuery(window, customStart, customEnd)}`,
    ),
};

// ─────────────── Quality Trend ───────────────

export interface QualityRepoListing {
  owner: string;
  repo: string;
  fullName: string;
  htmlUrl: string;
  language: string | null;
  pushedAt: string | null;
  defaultBranch: string;
}

export interface QualityRevertCommitArtifact {
  sha: string;
  shortSha: string;
  message: string;
  branch: string;
  authorLogin: string | null;
  authorName: string | null;
  date: string;
  htmlUrl: string;
}

export interface QualityHotfixDeployArtifact {
  workflowName: string;
  branch: string;
  actor: string | null;
  conclusion: string;
  startedAt: string;
  htmlUrl: string;
}

export interface QualityFailedDeployArtifact {
  workflowName: string;
  branch: string;
  actor: string | null;
  conclusion: string;
  startedAt: string;
  htmlUrl: string;
}

export type QualityRedeployReason = 'manual-re-run' | 'same-sha' | 'fix-forward';

export interface QualityRedeployArtifact {
  branch: string;
  actor: string | null;
  startedAt: string;
  prevStartedAt: string | null;
  gapMinutes: number | null;
  htmlUrl: string;
  prevHtmlUrl: string | null;
  reason: QualityRedeployReason;
  shortSha: string;
  prevShortSha: string | null;
  prevConclusion: string | null;
}

export interface QualityArtifacts {
  revertCommits: QualityRevertCommitArtifact[];
  hotfixDeploys: QualityHotfixDeployArtifact[];
  failedDeploys: QualityFailedDeployArtifact[];
  sameDayRedeploys: QualityRedeployArtifact[];
}

export interface QualityReposResponse {
  weeks: number;
  windowStart: string;
  windowEnd: string;
  repos: QualityRepoListing[];
  excludedArchived: number;
  excludedQuiet: number;
  generatedAt: string;
}

export interface QualityWeekBucket {
  weekStart: string;
  weekEnd: string;
  prodDeploys: number;
  totalDeploys: number;
  succeededDeploys: number;
  completedDeploys: number;
  failedDeploys: number;
  hotfixDeploys: number;
  sameDayRedeploys: number;
  revertCommits: number;
}

export interface QualityRepoResponse {
  owner: string;
  repo: string;
  defaultBranch: string;
  windowStart: string;
  windowEnd: string;
  weeks: QualityWeekBucket[];
  artifacts: QualityArtifacts;
  generatedAt: string;
}

export const qualityApi = {
  repos: (weeks: number) =>
    fetchApi<QualityReposResponse>(`/measure/quality/repos?weeks=${weeks}`),
  repo: (owner: string, repo: string, weeks: number) =>
    fetchApi<QualityRepoResponse>(
      `/measure/quality/repo/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}?weeks=${weeks}`,
    ),
};

export type ErrorsWindow = '24h' | '7d';

export interface ErrorsChartPoint {
  bucket: string;
  value: number;
}

export interface ErrorsResourceEntry {
  name: string;
  errors: number;
  consoleUrl: string;
}

export type ErrorsCategory =
  | 'lambda' | 'alb' | 'firehose' | 'sns' | 'sqs' | 'dynamodb' | 'apigateway' | 'stepfunctions';

export interface ErrorsCategoryResult {
  category: ErrorsCategory;
  label: string;
  metric: string;
  totalErrors: number;
  chart: ErrorsChartPoint[];
  resources: ErrorsResourceEntry[];
}

export interface ErrorsCategoryMeta {
  category: ErrorsCategory;
  label: string;
  metric: string;
}

export interface ErrorsCategoriesResponse {
  categories: ErrorsCategoryMeta[];
}

export interface ErrorsCategoryResponse extends ErrorsCategoryResult {
  window: ErrorsWindow;
  generatedAt: string;
}

export const errorsApi = {
  /** Lightweight bootstrap — list of categories with labels/metrics. */
  getCategories: () =>
    fetchApi<ErrorsCategoriesResponse>('/errors'),
  /** Per-category detail, used for lazy loading each card independently. */
  getCategory: (category: ErrorsCategory, window: ErrorsWindow) =>
    fetchApi<ErrorsCategoryResponse>(`/errors/${category}?window=${window}`),
};

export const costApi = {
  getOverview: () =>
    fetchApi<{
      noCredentials: boolean;
      currentMonth?: { total: number; currency: string; period: string };
      lastMonth?: { total: number; period: string };
      changePercent?: number;
      byService?: Array<{ service: string; cost: number; lastMonthCost: number; changePercent: number }>;
      dailyTrend?: Array<{ date: string; cost: number }>;
    }>('/costs/overview'),
  getInfraCost: () =>
    fetchApi<{
      noRepos: boolean;
      noCredentials?: boolean;
      resourceLevel?: boolean;
      period?: string;
      lastPeriod?: string;
      currency?: string;
      services?: Array<{
        serviceId: string;
        serviceName: string;
        repoSlug: string;
        matched: boolean;
        thisCost: number;
        lastCost: number;
        changePercent: number;
        environments: {
          dev:  { thisCost: number; lastCost: number };
          prod: { thisCost: number; lastCost: number };
        };
      }>;
      totalThisMonth?: number;
      matchedCount?: number;
      unmatchedCount?: number;
    }>('/catalog/deployments/infra-cost'),
};

export const deploymentApi = {
  list: (params?: Record<string, string>) =>
    fetchApi<{ items: unknown[]; nextCursor?: string }>(`/deployments?${new URLSearchParams(params)}`),
  getCurrentState: (serviceId: string) =>
    fetchApi<unknown[]>(`/deployments/services/${serviceId}/current`),
  getDiff: (serviceId: string) =>
    fetchApi(`/deployments/services/${serviceId}/diff`),
  getHistory: (serviceId: string) =>
    fetchApi<{ items: unknown[] }>(`/deployments/services/${serviceId}/history`),
};

export const velocityApi = {
  getOrgDashboard: () =>
    fetchApi<{ current: unknown; history: unknown[] }>('/velocity/org'),
  getTeamMetrics: (teamId: string, memberCount: number) =>
    fetchApi<{ current: unknown; history: unknown[] }>(`/velocity/teams/${teamId}?memberCount=${memberCount}`),
  getAnomalies: () => fetchApi<unknown[]>('/velocity/anomalies'),
};

export interface InfraStatus {
  dynamodb: {
    allTablesExist: boolean;
    tables: Record<string, { exists: boolean; tableName: string }>;
  };
  credentials: { source: 'override' | 'environment' | 'iam-role' };
  github: { tokenConfigured: boolean; tokenSource: 'environment' | 'override' | 'none' };
  region: { current: string; source: 'environment' | 'default' };
}

export interface AwsIdentity {
  arn: string;
  account: string;
  userId: string;
  displayName: string;
  principalType: string;
  accountAlias: string | null;
}

export const settingsApi = {
  getStatus: () => fetchApi<InfraStatus>('/settings/status'),
  getIdentity: () =>
    fetch(`${API_BASE}/settings/identity`, { headers: getCredentialHeaders() }).then((r) =>
      r.status === 204 ? null : (r.json() as Promise<AwsIdentity>),
    ),
  setCredentials: (creds: { accessKeyId: string; secretAccessKey: string; sessionToken?: string } | null) =>
    fetchApi<{ credentialSource: string }>('/settings/credentials', {
      method: 'POST',
      body: JSON.stringify(creds ?? {}),
    }),
  clearCredentials: () =>
    fetchApi<{ credentialSource: string }>('/settings/credentials', { method: 'DELETE' }),
  setGithubToken: (token: string | null) =>
    fetchApi<{ tokenConfigured: boolean }>('/settings/github-token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  setRegion: (region: string) =>
    fetchApi<{ region: string }>('/settings/region', {
      method: 'POST',
      body: JSON.stringify({ region }),
    }),
  clearRegion: () =>
    fetchApi<{ region: string }>('/settings/region', { method: 'DELETE' }),
  validateCredentials: () =>
    fetchApi<{ valid: boolean; expired: boolean; reason: string }>('/settings/credentials/validate'),
};

export type MetricSeries = { timestamps: string[]; values: number[]; label: string };

export const globalApi = {
  getDistributions: () =>
    fetchApi<Array<{ id: string; domainName: string; aliases: string[]; status: string; enabled: boolean; priceClass: string; origins: Array<{ id: string; domain: string }>; defaultCacheBehavior: string; httpVersion: string; wafWebAclId: string | null; lastModified: string | null }>>('/global/distributions'),
  getDns: (zoneId?: string) =>
    fetchApi<{ zones: Array<{ id: string; name: string; private: boolean; recordCount: number }>; records: Array<{ name: string; type: string; ttl: number | null; values: string[]; alias: { dnsName: string; evaluateHealth: boolean } | null }> }>(`/global/dns${zoneId ? `?zoneId=${encodeURIComponent(zoneId)}` : ''}`),
  getCertificates: () =>
    fetchApi<Array<{ arn: string; domain: string; sans: string[]; status: string; type: string; keyAlgorithm: string; expiresAt: string | null; daysLeft: number | null; inUseBy: string[] }>>('/global/certificates'),
  getWaf: () =>
    fetchApi<Array<{ id: string; name: string; arn: string; scope: string; description: string; ruleCount: number; resources: string[] }>>('/global/waf'),
};

export const infraApi = {
  getMetrics: (type: string, name: string, cluster?: string) => {
    const params = new URLSearchParams({ type, name });
    if (cluster) params.set('cluster', cluster);
    return fetchApi<{ type: string; name: string; metrics: Record<string, MetricSeries> }>(`/aws-resources/infra/metrics?${params}`);
  },
  getResources: (environment?: string) =>
    fetchApi<{
      ecsServices: Array<{ type: 'ecs-service'; id: string; name: string; cluster: string; status: string; desiredCount: number; runningCount: number; environment: string | null; tags: Record<string, string | undefined> }>;
      lambdaFunctions: Array<{ type: 'lambda'; id: string; name: string; runtime: string; memoryMb: number; timeoutSec: number; lastModified: string | null; environment: string | null; tags: Record<string, string | undefined> }>;
      rdsInstances: Array<{ type: 'rds'; id: string; name: string; engine: string; instanceClass: string; status: string; multiAz: boolean; environment: string | null; tags: Record<string, string | undefined> }>;
    }>(`/aws-resources/infra/resources${environment ? `?environment=${environment}` : ''}`),
  getTopology: () =>
    fetchApi<{
      vpcs: Array<{ vpcId: string; name: string | null; cidr: string; isDefault: boolean; state: string; tags: Record<string, string | undefined> }>;
      subnets: Array<{ subnetId: string; vpcId: string; name: string | null; cidr: string; az: string; availableIps: number; isPublic: boolean; tags: Record<string, string | undefined> }>;
      securityGroups: Array<{ groupId: string; vpcId: string; name: string; description: string; ingressRules: Array<{ protocol: string; fromPort: number | null; toPort: number | null; cidrs: string[]; sourceSgs: string[] }>; egressRules: Array<{ protocol: string; fromPort: number | null; toPort: number | null; cidrs: string[] }> }>;
    }>('/aws-resources/infra/topology'),
};

export const aiApi = {
  runbook: (problem: string) =>
    fetchApi<{ runbook: string }>('/ai/runbook', { method: 'POST', body: JSON.stringify({ problem }) }),
  digest: (serviceName: string, deployments: unknown[]) =>
    fetchApi<{ digest: string }>('/ai/digest', { method: 'POST', body: JSON.stringify({ serviceName, deployments }) }),
  costExplain: (service: string, trend: unknown[]) =>
    fetchApi<{ explanation: string }>('/ai/cost-explain', { method: 'POST', body: JSON.stringify({ service, trend }) }),
  cveTriage: (packageName: string, cves: unknown[], services?: string[]) =>
    fetchApi<{ triage: string }>('/ai/cve-triage', { method: 'POST', body: JSON.stringify({ packageName, cves, services }) }),
  incident: (input: string) =>
    fetchApi<{ report: string }>('/ai/incident', { method: 'POST', body: JSON.stringify({ input }) }),
  campaignImpact: (totalUsers: number, resources: Array<{ type: string; name: string; cluster?: string }>, channels: string[], context?: string) =>
    fetchApi<{ report: string; data: unknown[] }>('/ai/campaign-impact', { method: 'POST', body: JSON.stringify({ totalUsers, resources, channels, context }) }),
  generateSuggestions: (data: { name: string; description?: string; targetUsers: number; channels: string[]; campaignStartDate: string; durationDays: number; revertDate: string; resourceSnapshot?: unknown[] }) =>
    fetchApi<{ suggestions: string }>('/ai/campaign-revert-suggestions', { method: 'POST', body: JSON.stringify(data) }),
  infraSimulate: (resourceType: string, resourceName: string, change: string, cluster?: string) =>
    fetchApi<{ report: string }>('/ai/infra-simulate', { method: 'POST', body: JSON.stringify({ resourceType, resourceName, change, cluster }) }),
  deploymentRisk: (data: { owner: string; repo: string; prNumber: number; prTitle?: string; prBody?: string; prAuthor?: string }) =>
    fetchApi<{ report: string }>('/ai/deployment-risk', { method: 'POST', body: JSON.stringify(data) }),
  generateRunbook: (serviceName: string, serviceData: unknown, userPrompt?: string) =>
    fetchApi<{ content: string }>('/ai/generate-runbook', { method: 'POST', body: JSON.stringify({ serviceName, serviceData, userPrompt }) }),
};

export const ecsApi = {
  getServiceDetail: (cluster: string, service: string) =>
    fetchApi<{
      cluster: string;
      taskCpu: string;
      taskMemory: string;
      runningCount: number | null;
      envVars: Array<{ name: string; value: string }>;
      autoScaling: { min: number | null; max: number | null; scalesAt: string };
    }>(`/aws-resources/ecs-service-detail?cluster=${encodeURIComponent(cluster)}&service=${encodeURIComponent(service)}`),
};

export const githubApi = {
  postPrComment: (owner: string, repo: string, prNumber: number, body: string) =>
    fetchApi<{ commentUrl: string }>('/aws-resources/github/pr-comment', { method: 'POST', body: JSON.stringify({ owner, repo, prNumber, body }) }),
};

export const campaignRevertApi = {
  generateSuggestions: (data: { name: string; description?: string; targetUsers: number; channels: string[]; campaignStartDate: string; durationDays: number; revertDate: string; resourceSnapshot?: unknown[] }) =>
    fetchApi<{ suggestions: string }>('/ai/campaign-revert-suggestions', { method: 'POST', body: JSON.stringify(data) }),
  create: (data: unknown) =>
    fetchApi<{ campaignId: string }>('/campaign-reverts', { method: 'POST', body: JSON.stringify(data) }),
  list: () =>
    fetchApi<{ items: unknown[] }>('/campaign-reverts'),
  markReverted: (id: string) =>
    fetchApi<unknown>(`/campaign-reverts/${id}/revert`, { method: 'PATCH' }),
  delete: (id: string) =>
    fetchApi<void>(`/campaign-reverts/${id}`, { method: 'DELETE' }),
  remind: (data: { name: string; report: string; resourceSnapshot: unknown[]; campaignStartDate: string; durationDays: number; revertSuggestions: string; createdBy: string; createdByEmail: string; notificationWebhook?: string; notificationChannel?: string }) =>
    fetchApi<{ campaignId: string; revertDate: string }>('/campaign-reverts/remind', { method: 'POST', body: JSON.stringify(data) }),
  share: (data: { report: string; resourceData: unknown; sharedByName: string; sharedByEmail: string; targetChannel: string; slackWebhook: string }) =>
    fetchApi<{ approvalId: string }>('/campaign-reverts/share', { method: 'POST', body: JSON.stringify(data) }),
  getApproval: (approvalId: string) =>
    fetchApi<{ approvalId: string; report: string; resourceData: string; sharedByName: string; status: string; approvedBy?: string }>(`/campaign-reverts/approval/${approvalId}`),
  approve: (approvalId: string, approvedBy: string) =>
    fetchApi<{ ok: boolean }>(`/campaign-reverts/approval/${approvalId}/approve`, { method: 'POST', body: JSON.stringify({ approvedBy }) }),
};

// ─────────────── Portal / Act overhaul shapes ───────────────

export type OperationKind = 'aws-action' | 'db-credentials' | 'runbook';
export type RequestApprovalMode = 'manual' | 'auto';
export type RequestAuditEventType =
  | 'submitted' | 'auto-approved' | 'approved' | 'denied'
  | 'fulfilled' | 'failed' | 'revoked' | 'expired';

export interface PortalAutoApprovalRule {
  description: string;
  match: {
    requesterDomain?: string[];
    requesterTeamId?: string[];
    parameterEquals?: Record<string, string | string[]>;
  };
  constraints?: {
    maxDurationMinutes?: number;
    workingHoursOnly?: boolean;
    maxConcurrentSessionsForRequester?: number;
    excludeRequesterIds?: string[];
  };
}

export interface PortalAwsActionConfig {
  iamRoleArn: string;
  sessionPolicyTemplate: string;
  maxDurationMinutes: number;
  issueConsoleLink?: boolean;
}

export interface PortalDbCredentialsConfig {
  jitResourceId: string;
  allowedRoles: string[];
  maxDurationMinutes: number;
}

export interface PortalRequestAuditEvent {
  at: string;
  actor: string;
  type: RequestAuditEventType;
  detail?: string;
}

/** Subset of the ServiceRequest fields the new pages care about. */
export interface PortalServiceRequest {
  requestId: string;
  operationType: string;
  operationName: string;
  requesterId: string;
  requesterName: string;
  requesterEmail: string | null;
  requesterAwsUsername?: string;
  parameters: Record<string, string>;
  status: string;
  submittedAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  failureReason: string | null;
  approvalMode?: RequestApprovalMode;
  autoApprovalRuleDescription?: string;
  durationMinutes?: number;
  expiresAt?: string;
  audit?: PortalRequestAuditEvent[];
  metadata?: Record<string, unknown>;
}

export interface PortalIssuedCredentials {
  type: 'aws-action' | 'postgres' | 'redshift';
  expiresAt: string;
  // AWS action:
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  consoleUrl?: string;
  roleSessionName?: string;
  // DB:
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  connectionString?: string;
}

export interface PortalSubmitResponse {
  request: PortalServiceRequest;
  credentials?: PortalIssuedCredentials;
}

export interface PortalApproveResponse {
  request: PortalServiceRequest;
  credentials?: PortalIssuedCredentials;
}

export interface WepUserProfile {
  email: string;
  displayName?: string;
  department?: string;
  userType?: string;
  awsUsername?: string;
  source: 'manual' | 'identitystore';
  updatedAt: string;
  updatedBy: string;
}

export const portalApi = {
  /**
   * Resolves the caller's identity via STS (using the AWS credentials from Settings)
   * and returns their portal role.
   */
  getRole: () => fetchApi<{
    username: string | null;
    email: string | null;
    role: 'devops' | 'engineer';
    roleName: string | null;
  }>('/portal/auth/role'),

  getMyProfile: () => fetchApi<WepUserProfile>('/portal/profile/me'),
  updateMyProfile: (profile: { department?: string; userType?: string; awsUsername?: string; displayName?: string }) =>
    fetchApi<WepUserProfile>('/portal/profile/me', { method: 'PUT', body: JSON.stringify(profile) }),

  /**
   * Resolves the caller against IAM Identity Center and persists derived
   * department/userType/title/groups onto their stored profile.
   */
  autoResolveProfile: () =>
    fetchApi<
      | { resolved: true; profile: WepUserProfile; identityStore: { title: string | null; userType: string | null; displayName: string | null; groups: string[] } }
      | { resolved: false; reason: string; identity: { email: string; username: string; roleName: string } }
    >('/portal/profile/auto-resolve', { method: 'POST' }),

  getRequest: (requestId: string) =>
    fetchApi<PortalServiceRequest>(`/portal/requests/${encodeURIComponent(requestId)}`),

  approve: (requestId: string, approverId?: string, note?: string) =>
    fetchApi<PortalApproveResponse>(`/portal/requests/${encodeURIComponent(requestId)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ approverId, note }),
    }),

  reject: (requestId: string, reason: string) =>
    fetchApi<{ request: PortalServiceRequest }>(`/portal/requests/${encodeURIComponent(requestId)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
};

// ─── Portfolio: dependencies, coupling, recommendations, comparison, budgets ───

export interface ResourceDependency {
  sourceId: string;
  sourceName: string;
  sourceService: 'Lambda' | 'ECS';
  targetId: string;
  targetName: string;
  targetService: string;
  connectionType: 'env-var' | 'trigger' | 'resource-policy';
  detail: string;
}

export interface PortfolioRecommendation {
  id: string;
  type: 'rightsize' | 'memory' | 'billing-mode' | 'unused';
  severity: 'high' | 'medium' | 'low';
  service: 'Lambda' | 'ECS' | 'RDS' | 'DynamoDB';
  resourceId: string;
  resourceName: string;
  title: string;
  description: string;
  currentConfig: string;
  recommendedConfig: string;
  estimatedMonthlySavings: number;
  estimatedAnnualSavings: number;
  monthlyCost?: number;
}

export interface CostComparisonItem {
  service: string;
  currentMonthCost: number;
  previousMonthCost: number;
  change: number;
  changePercentage: number;
}

export interface BudgetConfig {
  id: string;
  name: string;
  monthlyBudget: number;
  scope: 'service' | 'tag' | 'all';
  scopeValue: string;
  alertThreshold: number;
  notificationEmails: string[];
  createdAt: string;
}

export interface BudgetStatus extends BudgetConfig {
  currentSpend: number;
  burnRate: number;
  projectedOverage: number;
  percentUsed: number;
  onTrack: boolean;
}

export const portfolioApi = {
  getLambdaDependencies: () =>
    fetchApi<{
      functions: Array<{ name: string; arn: string; runtime: string; envCount: number }>;
      dependencies: ResourceDependency[];
    }>('/portfolio/dependencies/lambda'),

  getEcsDependencies: (cluster?: string) =>
    fetchApi<{
      services: Array<{ name: string; arn: string; cluster: string; taskDef: string }>;
      dependencies: ResourceDependency[];
    }>(`/portfolio/dependencies/ecs${cluster ? `?cluster=${encodeURIComponent(cluster)}` : ''}`),

  getCoupling: (cluster: string) =>
    fetchApi<{
      clusterName: string;
      services: string[];
      couplings: Array<{ source: string; target: string; type: string; detail: string; port?: string }>;
      dependsOn: Record<string, string[]>;
      dependedBy: Record<string, string[]>;
    }>(`/portfolio/coupling/clusters/${encodeURIComponent(cluster)}`),

  getRecommendations: (service?: 'lambda' | 'ecs' | 'rds' | 'dynamodb') =>
    fetchApi<{ recommendations: PortfolioRecommendation[]; generatedAt: string }>(
      service ? `/portfolio/recommendations?service=${service}` : '/portfolio/recommendations',
    ),

  getCostComparison: () =>
    fetchApi<{
      noCredentials?: boolean;
      currentMonth: string;
      previousMonth: string;
      totalCurrent: number;
      totalPrevious: number;
      totalChange: number;
      totalChangePercentage: number;
      byService: CostComparisonItem[];
    }>('/portfolio/cost-comparison'),

  listBudgets: () => fetchApi<{ budgets: BudgetConfig[] }>('/portfolio/budgets'),
  listAwsBudgets: () =>
    fetchApi<{
      budgets: Array<{
        name: string; type: string; timeUnit: string;
        limit: number; currency: string;
        actualSpend: number; forecastedSpend: number;
        percentUsed: number; onTrack: boolean;
        startDate: string | null; endDate: string | null;
      }>;
      noCredentials?: boolean;
    }>('/portfolio/budgets/aws'),
  saveBudget: (budget: Partial<BudgetConfig>) =>
    fetchApi<{ budget: BudgetConfig }>('/portfolio/budgets', { method: 'POST', body: JSON.stringify(budget) }),
  deleteBudget: (id: string) =>
    fetchApi<{ ok: true }>(`/portfolio/budgets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getBudgetStatuses: () =>
    fetchApi<{ statuses: BudgetStatus[]; noCredentials?: boolean }>('/portfolio/budgets/status'),
};
