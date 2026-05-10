import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { DetailPageLayout, Badge, StatusIndicator, Spinner } from '@wep/ui';
import { RefreshCw, ExternalLink, ChevronLeft, ChevronRight, CheckCircle2, XCircle, Clock, MinusCircle, RotateCcw, GitBranch, Sparkles, X, Loader2 } from 'lucide-react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Legend,
} from 'recharts';
import { catalogApi, fetchApi, type WorkflowRun } from '../../lib/api';

interface AwsResource {
  arn: string;
  name?: string;
  resourceType?: string;
  identifier?: string;
  region?: string;
  clusterName?: string;
}

interface ServiceDetail {
  serviceId: string;
  serviceName: string;
  repositoryUrl: string;
  runtimeType: string;
  ownerTeam: { teamId: string; teamName: string };
  environments: string[];
  healthStatus: { status: string; signals: Array<{ source: string; status: string; checkedAt?: string }> };
  awsResources: Record<string, AwsResource[]>;
  metadata: Record<string, string>;
  awsEnriched: boolean;
}

// ── Workflow run helpers ──────────────────────────────────────────────────────

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// GitHub Actions conclusion values: success | failure | cancelled | skipped | timed_out | action_required | neutral | stale | null (in progress)
const CONCLUSION_CONFIG: Record<string, { icon: React.ReactNode; label: string; classes: string }> = {
  success:         { icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: 'Success',     classes: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/30 dark:text-emerald-400' },
  failure:         { icon: <XCircle      className="h-3.5 w-3.5" />, label: 'Failed',      classes: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950/30 dark:text-red-400' },
  cancelled:       { icon: <MinusCircle  className="h-3.5 w-3.5" />, label: 'Cancelled',   classes: 'bg-gray-50 text-gray-600 ring-gray-500/10 dark:bg-gray-800 dark:text-gray-400' },
  timed_out:       { icon: <Clock        className="h-3.5 w-3.5" />, label: 'Timed out',   classes: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950/30 dark:text-amber-400' },
  skipped:         { icon: <RotateCcw    className="h-3.5 w-3.5" />, label: 'Skipped',     classes: 'bg-gray-50 text-gray-500 ring-gray-500/10 dark:bg-gray-800 dark:text-gray-400' },
  in_progress:     { icon: <Clock        className="h-3.5 w-3.5" />, label: 'In progress', classes: 'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-950/30 dark:text-blue-400' },
};

// ── ARN → AWS Console URL ─────────────────────────────────────────────────────

function arnToConsoleUrl(resource: AwsResource): string | null {
  const arn = resource.arn;
  if (!arn) return null;

  // arn:aws:<service>:<region>:<account>:<resource>
  const parts = arn.split(':');
  const service = parts[2];
  const region = parts[3] || resource.region;

  if (service === 'lambda') {
    // arn:aws:lambda:region:account:function:name
    const fnName = parts[6] ?? parts.slice(6).join(':');
    return `https://${region}.console.aws.amazon.com/lambda/home?region=${region}#/functions/${fnName}`;
  }

  if (service === 'ecs') {
    // arn:aws:ecs:region:account:service/cluster/name  OR  service/name (old format)
    const resourcePart = parts.slice(5).join(':').replace(/^service\//, '');
    const cluster = resource.clusterName ?? resourcePart.split('/')[0];
    const svcName = resource.identifier ?? resourcePart.split('/').pop();
    return `https://${region}.console.aws.amazon.com/ecs/v2/clusters/${cluster}/services/${svcName}/health?region=${region}`;
  }

  return null;
}

const ENV_LABEL: Record<string, string> = {
  production: 'Production',
  development: 'Development',
  staging: 'Staging',
};

const ENV_BADGE: Record<string, string> = {
  production:  'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-950/30 dark:text-emerald-400',
  development: 'bg-orange-50  text-orange-700  ring-1 ring-inset ring-orange-600/20  dark:bg-orange-950/30  dark:text-orange-400',
  staging:     'bg-amber-50   text-amber-700   ring-1 ring-inset ring-amber-600/20   dark:bg-amber-950/30   dark:text-amber-400',
};

const DEP_PAGE_SIZE = 10;

// ── Markdown renderer ─────────────────────────────────────────────────────────
function renderMd(md: string): string {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^#{3}\s+(.+)$/gm, '<h3 class="mt-4 mb-1 text-sm font-bold text-gray-900 dark:text-white">$1</h3>')
    .replace(/^#{2}\s+(.+)$/gm, '<h2 class="mt-5 mb-1 text-base font-bold text-gray-900 dark:text-white">$1</h2>')
    .replace(/^#{1}\s+(.+)$/gm, '<h1 class="mt-5 mb-1 text-base font-bold text-gray-900 dark:text-white">$1</h1>')
    .replace(/^[-*]\s+(.+)$/gm, '<li class="ml-4 list-disc text-sm text-gray-700 dark:text-gray-300">$1</li>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code class="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs font-mono">$1</code>')
    .replace(/^---+$/gm, '<hr class="my-3 border-gray-200 dark:border-gray-700" />')
    .replace(/\n/g, '<br />');
}

// ── PR Risk Assessment Drawer ─────────────────────────────────────────────────
interface PrRiskDrawerProps {
  repoFullName: string;
  pr: { number: number; title: string; author: string; htmlUrl: string };
  onClose: () => void;
}

function PrRiskDrawer({ repoFullName, pr, onClose }: PrRiskDrawerProps) {
  const [loading, setLoading] = useState(true);
  const [assessment, setAssessment] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function generate() {
      setLoading(true);
      setError(null);
      try {
        const [owner, repo] = repoFullName.split('/') as [string, string];

        // Fetch PR files/diff
        const files = await fetchApi<Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }>>(
          `/aws-resources/github/pr-files?owner=${owner}&repo=${repo}&pr=${pr.number}`
        );

        const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
        const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);
        const fileSummaries = files.map((f) =>
          `${f.status.toUpperCase()} ${f.filename} (+${f.additions}/-${f.deletions})${f.patch ? `\n${f.patch}` : ''}`
        );

        const { assessment: aiAssessment } = await fetchApi<{ assessment: string }>('/ai/pr-risk', {
          method: 'POST',
          body: JSON.stringify({
            repoFullName,
            prNumber: pr.number,
            prTitle: pr.title,
            author: pr.author,
            additions: totalAdditions,
            deletions: totalDeletions,
            changedFiles: files.length,
            fileSummaries,
          }),
        });
        setAssessment(aiAssessment);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to generate assessment');
      } finally {
        setLoading(false);
      }
    }
    void generate();
  }, [repoFullName, pr]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl dark:bg-zinc-900 animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-gray-100 dark:border-white/10 px-6 py-4">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-900/30">
            <Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">PR Risk Assessment</h2>
            <p className="truncate text-xs text-gray-500 dark:text-gray-400">
              <a href={pr.htmlUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                #{pr.number} — {pr.title}
              </a>
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-gray-400">
              <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
              <p className="text-sm">Reviewing PR changes…</p>
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
          {assessment && !loading && (
            <div
              className="prose-sm max-w-none text-gray-800 dark:text-gray-200"
              dangerouslySetInnerHTML={{ __html: renderMd(assessment) }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function ServiceDetailPage() {
  const { serviceId } = useParams<{ serviceId: string }>();
  const [service, setService] = useState<ServiceDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Contributors state ────────────────────────────────────────────────────
  type ContributorsData = Awaited<ReturnType<typeof catalogApi.getServiceContributors>>;
  const [contributors, setContributors] = useState<ContributorsData | null>(null);

  // ── Last deployments state ────────────────────────────────────────────────
  type LastDeploymentsData = Awaited<ReturnType<typeof catalogApi.getServiceLastDeployments>>;
  const [lastDeployments, setLastDeployments] = useState<LastDeploymentsData | null>(null);
  const [lastDeploymentsLoading, setLastDeploymentsLoading] = useState(false);

  // ── Pull requests tab state ───────────────────────────────────────────────
  type PullRequestsData = Awaited<ReturnType<typeof catalogApi.getServicePullRequests>>;
  type PrItem = PullRequestsData['items'][number];
  const [prs, setPrs]           = useState<PullRequestsData | null>(null);
  const [prsLoading, setPrsLoading] = useState(false);
  const prsLoadedRef = useRef(false);
  const [riskPr, setRiskPr] = useState<PrItem | null>(null);

  // ── Dependencies tab state ────────────────────────────────────────────────
  interface DepScanOutbound {
    envVar: string; value: string; dependencyType: 'api-call' | 'aws-resource' | 'database' | 'queue' | 'other';
    targetLabel: string; targetServiceId: string | null; environment: string; source: string;
  }
  interface DepScanInbound { serviceId: string; serviceName: string; healthStatus: string }
  interface DepScanData { serviceId: string; outbound: DepScanOutbound[]; inbound: DepScanInbound[]; scannedSources: string[] }
  const [depScan, setDepScan] = useState<DepScanData | null>(null);
  const [depsLoading, setDepsLoading] = useState(false);
  const depsLoadedRef = useRef(false);
  const [depEnv, setDepEnv] = useState<string>('');

  // ── Capacity tab state ────────────────────────────────────────────────────
  interface EcsCapacityPoint    { time: string; cpu: number | null; memory: number | null }
  interface LambdaCapacityPoint { time: string; invocations: number | null; throttles: number | null; concurrency: number | null }
  interface EcsResource {
    type: 'ecs';
    environment: string;
    name: string;
    clusterName: string;
    latestCpu: number | null;
    latestMemory: number | null;
    series: EcsCapacityPoint[];
  }
  interface LambdaResource {
    type: 'lambda';
    environment: string;
    name: string;
    latestInvocations: number | null;
    latestThrottles: number | null;
    latestConcurrency: number | null;
    series: LambdaCapacityPoint[];
  }
  type CapacityResource = EcsResource | LambdaResource;
  interface CapacityData { serviceId: string; resources: CapacityResource[] }
  const [capacity, setCapacity] = useState<CapacityData | null>(null);
  const [capacityLoading, setCapacityLoading] = useState(false);
  const capacityLoadedRef = useRef(false);

  // ── Deployment tab state ──────────────────────────────────────────────────
  const [runs, setRuns]             = useState<WorkflowRun[]>([]);
  const [depLoading, setDepLoading] = useState(false);
  const [depLoaded, setDepLoaded]   = useState(false);
  const [depPage, setDepPage]       = useState(1);
  const [depTotalCount, setDepTotalCount] = useState(0);
  const depLoadedRef = useRef(false);

  const fetchRuns = useCallback(async (page: number) => {
    if (!serviceId) return;
    setDepLoading(true);
    try {
      const result = await catalogApi.getServiceWorkflowRuns(serviceId, DEP_PAGE_SIZE, page);
      setRuns(result.items);
      setDepTotalCount(result.totalCount);
      setDepPage(page);
    } catch (err) {
      console.error('Failed to fetch workflow runs:', err);
    } finally {
      setDepLoading(false);
      setDepLoaded(true);
    }
  }, [serviceId]);

  const handleTabChange = useCallback((key: string) => {
    if (key === 'deployments' && !depLoadedRef.current) {
      depLoadedRef.current = true;
      void fetchRuns(1);
    }
    if (key === 'pull-requests' && !prsLoadedRef.current && serviceId) {
      prsLoadedRef.current = true;
      setPrsLoading(true);
      catalogApi.getServicePullRequests(serviceId)
        .then(setPrs)
        .catch(() => setPrs({ items: [] }))
        .finally(() => setPrsLoading(false));
    }
    if (key === 'capacity' && !capacityLoadedRef.current && serviceId) {
      capacityLoadedRef.current = true;
      setCapacityLoading(true);
      fetchApi<CapacityData>(`/catalog/services/${serviceId}/capacity`)
        .then(setCapacity)
        .catch(() => setCapacity(null))
        .finally(() => setCapacityLoading(false));
    }
    if (key === 'dependencies' && !depsLoadedRef.current && serviceId) {
      depsLoadedRef.current = true;
      setDepsLoading(true);
      fetchApi<DepScanData>(`/catalog/services/${serviceId}/dependency-scan`)
        .then(setDepScan)
        .catch(() => setDepScan({ serviceId: serviceId ?? '', outbound: [], inbound: [], scannedSources: [] }))
        .finally(() => setDepsLoading(false));
    }
  }, [fetchRuns, serviceId]);

  const totalDepPages = Math.max(1, Math.ceil(depTotalCount / DEP_PAGE_SIZE));
  const pageRuns = runs; // server already returns the right page

  // ── Stability chart state ─────────────────────────────────────────────────
  type StabilityData = Awaited<ReturnType<typeof catalogApi.getServiceStability>>;
  type StabilityDeployment = StabilityData['deployments'][number];
  const [stability, setStability]       = useState<StabilityData | null>(null);
  const [stabilityEnv, setStabilityEnv] = useState<'production' | 'development'>('production');
  const [stabilityDays, setStabilityDays] = useState(30);
  const [stabilityLoading, setStabilityLoading] = useState(false);
  const [hoveredDep, setHoveredDep]     = useState<{ dep: StabilityDeployment; clientX: number; clientY: number } | null>(null);
  // Cache keyed by `${env}-${days}` — avoids re-fetching when user toggles back
  const stabilityCache = useRef<Map<string, StabilityData>>(new Map());

  const fetchStability = useCallback(async (env: string, days: number) => {
    if (!serviceId) return;
    const cacheKey = `${env}-${days}`;
    const cached = stabilityCache.current.get(cacheKey);
    if (cached) {
      setStability(cached);
      return;
    }
    setStabilityLoading(true);
    try {
      const data = await catalogApi.getServiceStability(serviceId, env, days);
      stabilityCache.current.set(cacheKey, data);
      setStability(data);
    } catch {
      // non-fatal — chart stays empty
    } finally {
      setStabilityLoading(false);
    }
  }, [serviceId]);

  // ── Service fetch ─────────────────────────────────────────────────────────
  const fetchService = useCallback(async () => {
    if (!serviceId) return;
    setLoading(true);
    catalogApi.getService(serviceId)
      .then((data) => setService(data as ServiceDetail))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [serviceId]);

  useEffect(() => { fetchService(); }, [fetchService]);

  // Load stability + contributors once service is known
  useEffect(() => {
    if (!service) return;
    const defaultEnv = service.environments.includes('production') ? 'production' : (service.environments[0] ?? 'production');
    setStabilityEnv(defaultEnv as 'production' | 'development');
    void fetchStability(defaultEnv, stabilityDays);
    catalogApi.getServiceContributors(service.serviceId)
      .then(setContributors)
      .catch(() => { /* non-fatal */ });
    setLastDeploymentsLoading(true);
    catalogApi.getServiceLastDeployments(service.serviceId)
      .then(setLastDeployments)
      .catch(() => setLastDeployments({ environments: {} }))
      .finally(() => setLastDeploymentsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service?.serviceId]);

  if (loading) return <div className="flex justify-center py-12"><Spinner size="lg" /></div>;
  if (!service) return <div className="text-center py-12 text-gray-500 dark:text-gray-400">Service not found</div>;

  const header = (
    <div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{service.serviceName}</h1>
          <StatusIndicator status={service.healthStatus.status} />
        </div>
        <button
          onClick={fetchService}
          title="Refresh"
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>
      <div className="mt-2 flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
        <span>Owner: {service.ownerTeam.teamId === 'team_unassigned'
          ? <span className="text-amber-500 dark:text-amber-400" title="No team assigned to this service">Unassigned</span>
          : <Link to={`/catalog/teams/${service.ownerTeam.teamId}`} className="text-blue-600 hover:underline">{service.ownerTeam.teamName}</Link>
        }</span>
        <Badge variant="runtime" value={service.runtimeType} />
        <a href={service.repositoryUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Repository</a>
      </div>
      <div className="mt-2 flex gap-1">
        {service.environments.map((e) => <Badge key={e} variant="environment" value={e} />)}
      </div>
    </div>
  );

  return (
    <>
    <DetailPageLayout
      header={header}
      onTabChange={handleTabChange}
      tabs={[
        {
          key: 'overview',
          label: 'Overview',
          content: (
            <div className="space-y-8">

              {/* ── Stability chart ──────────────────────────────────────────── */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Deployment Stability</h3>
                  <div className="flex items-center gap-2">
                    {/* Environment toggle */}
                    {service.environments.length > 1 && (
                      <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-xs font-medium">
                        {(['production', 'development'] as const)
                          .filter((e) => service.environments.includes(e))
                          .map((e) => (
                            <button
                              key={e}
                              onClick={() => { setStabilityEnv(e); void fetchStability(e, stabilityDays); }}
                              className={`px-3 py-1.5 transition-colors ${
                                stabilityEnv === e
                                  ? e === 'production'
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-orange-500 text-white'
                                  : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'
                              }`}
                            >
                              {e === 'production' ? 'Production' : 'Development'}
                            </button>
                          ))}
                      </div>
                    )}
                    {/* Days selector */}
                    <select
                      value={stabilityDays}
                      onChange={(e) => { const d = Number(e.target.value); setStabilityDays(d); void fetchStability(stabilityEnv, d); }}
                      className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                    >
                      <option value={7}>7 days</option>
                      <option value={14}>14 days</option>
                      <option value={30}>30 days</option>
                      <option value={60}>60 days</option>
                    </select>
                  </div>
                </div>

                {stabilityLoading ? (
                  <div className="flex h-48 items-center justify-center">
                    <Spinner size="lg" />
                  </div>
                ) : !stability || stability.metrics.length === 0 ? (
                  <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/50">
                    <p className="text-sm text-gray-400">{stability?.reason ?? 'No metric data available for this period'}</p>
                    {stability?.lbName && <p className="mt-1 text-xs text-gray-300 dark:text-gray-600">{stability.lbName}</p>}
                  </div>
                ) : (() => {
                  const isLambda  = stability.lbType === 'AWS/Lambda';
                  const errorKey  = isLambda ? 'errors' : 'errors5xx';
                  const hasErrors = stability.metrics.some((m) => (((m as unknown) as Record<string, number | undefined>)[errorKey] ?? 0) > 0);

                  // Convert ISO timestamps → numeric ms so ReferenceLine x values can
                  // land anywhere on the axis (not just at exact data-point positions).
                  const chartData = stability.metrics.map((m) => ({ ...m, ts: new Date(m.timestamp).getTime() }));

                  // Custom SVG label rendered at top of each ReferenceLine.
                  // Handles hover (show tooltip) and click (open GitHub run).
                  const DeploymentPin = ({ viewBox, dep }: { viewBox?: { x?: number; y?: number }; dep: StabilityDeployment }) => {
                    const cx = (viewBox?.x ?? 0);
                    const cy = (viewBox?.y ?? 0) + 2;
                    return (
                      <g
                        style={{ cursor: 'pointer' }}
                        onClick={() => window.open(dep.htmlUrl, '_blank', 'noopener,noreferrer')}
                        onMouseEnter={(e) => setHoveredDep({ dep, clientX: e.clientX, clientY: e.clientY })}
                        onMouseLeave={() => setHoveredDep(null)}
                      >
                        <circle cx={cx} cy={cy + 7} r={9} fill="#10b981" fillOpacity={0.15} stroke="#10b981" strokeWidth={1.5} />
                        <text x={cx} y={cy + 12} textAnchor="middle" fontSize={11} dominantBaseline="middle">🚀</text>
                      </g>
                    );
                  };

                  return (
                    <div className="relative rounded-xl border border-gray-100 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                      {/* Deployment hover tooltip */}
                      {hoveredDep && (
                        <div
                          className="pointer-events-none fixed z-50 max-w-xs rounded-lg bg-gray-900 p-2.5 text-xs shadow-xl ring-1 ring-white/10"
                          style={{ top: hoveredDep.clientY - 8, left: hoveredDep.clientX + 14, transform: 'translateY(-100%)' }}
                        >
                          {hoveredDep.dep.commitMessage && (
                            <p className="font-medium text-white">{hoveredDep.dep.commitMessage}</p>
                          )}
                          <p className="mt-0.5 text-gray-400">
                            {hoveredDep.dep.branch}
                            {hoveredDep.dep.actor ? ` · ${hoveredDep.dep.actor}` : ''}
                          </p>
                          <p className="mt-0.5 text-gray-500">{new Date(hoveredDep.dep.timestamp).toLocaleString()}</p>
                          <p className="mt-1 text-emerald-400">Click to open in GitHub →</p>
                        </div>
                      )}
                      {stability.lbName && (
                        <p className="mb-2 text-xs text-gray-400 dark:text-gray-500">
                          {stability.lbType} · {stability.lbName}
                        </p>
                      )}
                      <ResponsiveContainer width="100%" height={220}>
                        <ComposedChart data={chartData} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                          <XAxis
                            dataKey="ts"
                            type="number"
                            scale="time"
                            domain={['dataMin', 'dataMax']}
                            tickFormatter={(v: number) => new Date(v).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                            tick={{ fontSize: 11, fill: '#94a3b8' }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            yAxisId="errors"
                            orientation="left"
                            tick={{ fontSize: 11, fill: '#94a3b8' }}
                            axisLine={false}
                            tickLine={false}
                            allowDecimals={false}
                          />
                          <YAxis
                            yAxisId="latency"
                            orientation="right"
                            tick={{ fontSize: 11, fill: '#94a3b8' }}
                            axisLine={false}
                            tickLine={false}
                            unit="ms"
                          />
                          <Tooltip
                            contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                            labelStyle={{ color: '#94a3b8' }}
                            labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
                            formatter={(value, name) => {
                              const v = Number(value);
                              if (name === 'Errors') return [`${v}`, name as string];
                              if (name === 'p95 Latency') return [`${v} ms`, name as string];
                              return [`${v}`, name as string];
                            }}
                          />
                          <Legend wrapperStyle={{ fontSize: 11 }} />

                          {/* Error bars */}
                          {hasErrors && (
                            <Area
                              yAxisId="errors"
                              type="monotone"
                              dataKey={errorKey}
                              name="Errors"
                              fill="rgba(239,68,68,0.15)"
                              stroke="#ef4444"
                              strokeWidth={1.5}
                              dot={false}
                            />
                          )}

                          {/* Latency line */}
                          <Line
                            yAxisId="latency"
                            type="monotone"
                            dataKey="latencyP95Ms"
                            name="p95 Latency"
                            stroke="#3b82f6"
                            strokeWidth={1.5}
                            dot={false}
                          />

                          {/* Deployment markers — vertical lines with interactive rocket pin */}
                          {stability.deployments.map((d, i) => (
                            <ReferenceLine
                              key={i}
                              yAxisId="errors"
                              x={new Date(d.timestamp).getTime()}
                              stroke="#10b981"
                              strokeDasharray="4 3"
                              strokeWidth={2}
                              label={(props) => <DeploymentPin {...props} dep={d} />}
                            />
                          ))}
                        </ComposedChart>
                      </ResponsiveContainer>
                      <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                        Dashed green lines mark successful deployments · Blue = p95 latency{hasErrors ? ' · Red = errors' : ''}
                      </p>
                    </div>
                  );
                })()}
              </div>

              {/* ── Last Deployments ─────────────────────────────────────── */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Last Deployment</h3>
                {lastDeploymentsLoading ? (
                  <div className="flex justify-center py-6"><Spinner size="md" /></div>
                ) : !lastDeployments || Object.keys(lastDeployments.environments).length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500">
                    No successful deployments found in the last 50 runs.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {(['production', 'development'] as const)
                      .filter((e) => lastDeployments.environments[e])
                      .map((e) => {
                        const d = lastDeployments.environments[e]!;
                        return (
                          <a
                            key={e}
                            href={d.htmlUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group flex flex-col gap-1.5 rounded-xl border border-gray-100 bg-white p-4 transition-colors hover:border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700 dark:hover:bg-gray-800/60"
                          >
                            <div className="flex items-center justify-between">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                                e === 'production'
                                  ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/30 dark:text-emerald-400'
                                  : 'bg-orange-50 text-orange-700 ring-orange-600/20 dark:bg-orange-950/30 dark:text-orange-400'
                              }`}>
                                {e === 'production' ? 'Production' : 'Development'}
                              </span>
                              <span className="text-xs text-gray-400 dark:text-gray-500">
                                {formatRelativeTime(d.completedAt)}
                              </span>
                            </div>
                            {d.commitMessage && (
                              <p className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">{d.commitMessage}</p>
                            )}
                            <p className="text-xs text-gray-400 dark:text-gray-500">
                              {d.branch}{d.actor ? ` · ${d.actor}` : ''}
                            </p>
                          </a>
                        );
                      })}
                  </div>
                )}
              </div>

              {/* ── People ──────────────────────────────────────────────────── */}
              {contributors && (contributors.topContributors.length > 0 || contributors.topTriggers.length > 0) && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">People</h3>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

                    {/* Top contributors */}
                    {contributors.topContributors.length > 0 && (
                      <div className="rounded-xl border border-gray-100 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Top Contributors</p>
                        <ol className="space-y-2">
                          {contributors.topContributors.map((c, i) => (
                            <li key={c.login} className="flex items-center gap-2.5">
                              <span className="w-4 text-right text-xs text-gray-400">{i + 1}</span>
                              <img src={c.avatarUrl} alt={c.login} className="h-6 w-6 rounded-full" />
                              <a
                                href={c.htmlUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-1 truncate text-sm font-medium text-gray-800 hover:text-blue-600 dark:text-gray-200 dark:hover:text-blue-400"
                              >
                                {c.login}
                              </a>
                              <span className="text-xs tabular-nums text-gray-400">{c.contributions.toLocaleString()} commits</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}

                    {/* Top action triggers */}
                    {contributors.topTriggers.length > 0 && (
                      <div className="rounded-xl border border-gray-100 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Top Action Triggers</p>
                        <ol className="space-y-2">
                          {contributors.topTriggers.map((t, i) => (
                            <li key={t.login} className="flex items-center gap-2.5">
                              <span className="w-4 text-right text-xs text-gray-400">{i + 1}</span>
                              <a
                                href={`https://github.com/${t.login}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-1 truncate text-sm font-medium text-gray-800 hover:text-blue-600 dark:text-gray-200 dark:hover:text-blue-400"
                              >
                                {t.login}
                              </a>
                              <span className="text-xs tabular-nums text-gray-400">{t.count} runs</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}

                  </div>
                </div>
              )}

              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Health Signals</h3>
                {service.healthStatus.signals.length === 0 ? (
                  <p className="text-gray-500 dark:text-gray-400 text-sm">
                    {service.awsEnriched
                      ? 'No AWS resources found for this service'
                      : 'AWS enrichment has not run yet — trigger a sync to populate health data'}
                  </p>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-gray-800 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                    {service.healthStatus.signals.map((s, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-3 bg-white dark:bg-gray-900">
                        <div className="flex items-center gap-3">
                          <StatusIndicator status={s.status} />
                          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{s.source}</span>
                        </div>
                        {s.checkedAt && (
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            Checked {new Date(s.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {Object.keys(service.metadata).length > 0 && (
                <div>
                  <h3 className="text-lg font-medium mb-2">Metadata</h3>
                  <dl className="grid grid-cols-2 gap-2">
                    {Object.entries(service.metadata).map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-xs text-gray-500 dark:text-gray-400">{k}</dt>
                        <dd className="text-sm text-gray-900 dark:text-white">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>
          ),
        },
        {
          key: 'resources',
          label: 'AWS Resources',
          content: (() => {
            const rows = Object.entries(service.awsResources).flatMap(([env, resources]) =>
              resources.map((r) => ({ env, resource: r })),
            );

            if (rows.length === 0) {
              return (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {service.awsEnriched
                    ? 'No AWS resources were found for this service'
                    : 'Run a sync to discover AWS resources'}
                </p>
              );
            }

            return (
              <div className="overflow-hidden rounded-xl border border-gray-100 dark:border-gray-800">
                {/* Header */}
                <div className="grid grid-cols-[140px_160px_1fr_32px] gap-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  <span>Environment</span>
                  <span>Type</span>
                  <span>Resource</span>
                  <span />
                </div>

                {rows.map(({ env, resource }, i) => {
                  const consoleUrl = arnToConsoleUrl(resource);
                  const label = resource.identifier ?? resource.name ?? resource.arn.split(':').pop() ?? resource.arn;
                  const type = resource.resourceType ?? '—';
                  const Row = consoleUrl ? 'a' : 'div';
                  const rowProps = consoleUrl
                    ? { href: consoleUrl, target: '_blank', rel: 'noopener noreferrer' }
                    : {};

                  return (
                    <Row
                      key={i}
                      {...(rowProps as Record<string, string>)}
                      className={`grid grid-cols-[140px_160px_1fr_32px] items-center gap-4 px-4 py-3 bg-white dark:bg-gray-900 text-sm transition-colors ${
                        consoleUrl ? 'cursor-pointer hover:bg-blue-50/40 dark:hover:bg-blue-950/20 group' : ''
                      } ${i < rows.length - 1 ? 'border-b border-gray-50 dark:border-gray-800/60' : ''}`}
                    >
                      {/* Environment badge */}
                      <span className={`inline-flex w-fit items-center rounded-md px-2 py-0.5 text-xs font-medium ${ENV_BADGE[env] ?? 'bg-gray-50 text-gray-600 ring-1 ring-inset ring-gray-500/10'}`}>
                        {ENV_LABEL[env] ?? env}
                      </span>

                      {/* Resource type */}
                      <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{type}</span>

                      {/* Resource name + ARN */}
                      <div className="min-w-0">
                        <p className="truncate font-medium text-gray-900 dark:text-white">{label}</p>
                        <p className="truncate font-mono text-xs text-gray-400 dark:text-gray-500">{resource.arn}</p>
                      </div>

                      {/* External link icon */}
                      <div className="flex justify-end">
                        {consoleUrl && (
                          <ExternalLink className="h-3.5 w-3.5 text-gray-300 group-hover:text-blue-500 dark:text-gray-600 transition-colors" />
                        )}
                      </div>
                    </Row>
                  );
                })}
              </div>
            );
          })(),
        },
        {
          key: 'deployments',
          label: 'Deployments',
          content: (() => {
            if (!depLoaded && !depLoading) {
              return (
                <div className="flex items-center justify-center py-12 text-sm text-gray-400">
                  Loading deployments…
                </div>
              );
            }

            if (depLoading) {
              return <div className="flex justify-center py-12"><Spinner size="lg" /></div>;
            }

            if (pageRuns.length === 0 && runs.length === 0) {
              return (
                <p className="text-sm text-gray-500 dark:text-gray-400 py-4">
                  No GitHub Actions runs found for this repository.
                </p>
              );
            }

            return (
              <div>
                <div className="overflow-hidden rounded-xl border border-gray-100 dark:border-gray-800">
                  {/* Header */}
                  <div className="grid grid-cols-[1fr_1fr_130px_120px_120px_90px_32px] gap-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                    <span>Workflow / Branch</span>
                    <span>Commit</span>
                    <span>Environment</span>
                    <span>Result</span>
                    <span>Triggered by</span>
                    <span className="text-right">Duration</span>
                    <span />
                  </div>

                  {pageRuns.map((run, i) => {
                    const key = run.conclusion ?? (run.status === 'in_progress' ? 'in_progress' : 'cancelled');
                    const cfg = CONCLUSION_CONFIG[key] ?? CONCLUSION_CONFIG['cancelled']!;
                    const envBadge = ENV_BADGE[run.environment] ?? 'bg-gray-50 text-gray-600 ring-1 ring-inset ring-gray-500/10';

                    return (
                      <div
                        key={run.runId}
                        className={`grid grid-cols-[1fr_1fr_130px_120px_120px_90px_32px] items-center gap-4 px-4 py-3 bg-white dark:bg-gray-900 text-sm ${
                          i < pageRuns.length - 1 ? 'border-b border-gray-50 dark:border-gray-800/60' : ''
                        }`}
                      >
                        {/* Workflow / Branch */}
                        <div className="min-w-0">
                          <p className="truncate font-medium text-gray-900 dark:text-white">{run.workflowName}</p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <GitBranch className="h-3 w-3 text-gray-400 shrink-0" />
                            <span className="truncate font-mono text-xs text-gray-400 dark:text-gray-500">{run.branch ?? run.sha.slice(0, 7)}</span>
                            <span className="text-gray-300 dark:text-gray-600">·</span>
                            <span className="text-xs text-gray-400">{formatRelativeTime(run.startedAt)}</span>
                          </div>
                        </div>

                        {/* Commit message */}
                        <span className="min-w-0 truncate text-xs text-gray-500 dark:text-gray-400">
                          {run.headCommitMessage ?? <span className="text-gray-300 dark:text-gray-600">—</span>}
                        </span>

                        {/* Environment */}
                        <span className={`inline-flex w-fit items-center rounded-md px-2 py-0.5 text-xs font-medium ${envBadge}`}>
                          {ENV_LABEL[run.environment] ?? run.environment}
                        </span>

                        {/* Result */}
                        <span className={`inline-flex w-fit items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cfg.classes}`}>
                          {cfg.icon}{cfg.label}
                        </span>

                        {/* Triggered by */}
                        <span className="truncate text-xs text-gray-600 dark:text-gray-300">
                          {run.actor ?? '—'}
                        </span>

                        {/* Duration */}
                        <span className="text-right font-mono text-xs text-gray-500 dark:text-gray-400">
                          {formatDuration(run.durationSeconds)}
                        </span>

                        {/* Link to GitHub Actions */}
                        <a
                          href={run.htmlUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex justify-end text-gray-300 hover:text-blue-500 dark:text-gray-600 transition-colors"
                          title="Open in GitHub Actions"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    );
                  })}
                </div>

                {/* Pagination */}
                {totalDepPages > 1 && (
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-gray-400">
                      Page {depPage} of {totalDepPages} · {depTotalCount} total runs
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => fetchRuns(depPage - 1)}
                        disabled={depPage <= 1 || depLoading}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-gray-800"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => fetchRuns(depPage + 1)}
                        disabled={depPage >= totalDepPages || depLoading}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-gray-800"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })(),
        },
        {
          key: 'pull-requests',
          label: 'Pull Requests',
          content: (() => {
            if (prsLoading) {
              return <div className="flex justify-center py-12"><Spinner size="lg" /></div>;
            }
            if (!prs) {
              return (
                <div className="flex items-center justify-center py-12 text-sm text-gray-400">
                  Loading pull requests…
                </div>
              );
            }
            if (prs.items.length === 0) {
              return (
                <div className="flex flex-col items-center justify-center py-12 text-sm text-gray-400">
                  <p>No open pull requests</p>
                </div>
              );
            }
            return (
              <div className="divide-y divide-gray-100 dark:divide-gray-800 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                {prs.items.map((pr) => (
                  <div key={pr.number} className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                    <img src={pr.authorAvatarUrl} alt={pr.author} className="mt-0.5 h-7 w-7 flex-shrink-0 rounded-full" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <a
                          href={pr.htmlUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate text-sm font-medium text-gray-800 hover:text-blue-600 dark:text-gray-100 dark:hover:text-blue-400"
                        >

                          {pr.draft && (
                            <span className="mr-1.5 inline-flex items-center rounded-full bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                              Draft
                            </span>
                          )}
                          {pr.title}
                        </a>
                        <div className="flex flex-shrink-0 items-center gap-1.5">
                          <button
                            onClick={() => setRiskPr(pr)}
                            title="AI Risk Assessment"
                            className="inline-flex items-center gap-1 rounded-md border border-violet-200 dark:border-violet-900/50 px-2 py-0.5 text-xs font-medium text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/20 transition-colors"
                          >
                            <Sparkles className="h-3 w-3" />
                            Risk
                          </button>
                          <a
                            href={pr.htmlUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                            title="Open in GitHub"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400 dark:text-gray-500">
                        <span>#{pr.number}</span>
                        <span>·</span>
                        <a href={pr.authorHtmlUrl} target="_blank" rel="noopener noreferrer" className="hover:text-gray-600 dark:hover:text-gray-300">
                          {pr.author}
                        </a>
                        <span>·</span>
                        <span>opened {formatRelativeTime(pr.createdAt)}</span>
                        {pr.commentsCount > 0 && (
                          <>
                            <span>·</span>
                            <span>{pr.commentsCount} comment{pr.commentsCount !== 1 ? 's' : ''}</span>
                          </>
                        )}
                        {pr.reviewers.length > 0 && (
                          <>
                            <span>·</span>
                            <span>reviewers: {pr.reviewers.join(', ')}</span>
                          </>
                        )}
                      </div>
                      {pr.labels.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {pr.labels.map((label) => (
                            <span
                              key={label}
                              className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700 ring-1 ring-inset ring-blue-600/20 dark:bg-blue-950/30 dark:text-blue-400"
                            >
                              {label}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })(),
        },
        {
          key: 'capacity',
          label: 'Capacity',
          content: (() => {
            if (capacityLoading) {
              return <div className="flex justify-center py-12"><Spinner size="lg" /></div>;
            }
            if (!capacity) {
              return (
                <div className="flex items-center justify-center py-12 text-sm text-gray-400">
                  Loading capacity data…
                </div>
              );
            }

            function statBadge(value: number | null, label: string) {
              if (value === null) return null;
              const color = value >= 85 ? 'text-red-600 dark:text-red-400' : value >= 60 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400';
              return (
                <div className="text-center">
                  <p className={`text-xl font-bold tabular-nums ${color}`}>{value.toFixed(1)}%</p>
                  <p className="text-xs text-gray-400">{label}</p>
                </div>
              );
            }

            function capacityTickFormatter(iso: string) {
              const d = new Date(iso);
              return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }

            const envOrder = ['production', 'staging', 'development'];
            const byEnv = capacity.resources.reduce<Record<string, CapacityResource[]>>((acc, r) => {
              if (!acc[r.environment]) acc[r.environment] = [];
              acc[r.environment]!.push(r);
              return acc;
            }, {});
            const sortedEnvs = Object.keys(byEnv).sort(
              (a, b) => (envOrder.indexOf(a) === -1 ? 99 : envOrder.indexOf(a)) - (envOrder.indexOf(b) === -1 ? 99 : envOrder.indexOf(b)),
            );

            if (capacity.resources.length === 0) {
              return (
                <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                  No ECS services found for this service. Run an AWS sync to discover resources.
                </p>
              );
            }

            return (
              <div className="space-y-10">
                {sortedEnvs.map((env) => (
                  <div key={env}>
                    <div className="mb-4 flex items-center gap-2">
                      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold capitalize ${ENV_BADGE[env] ?? 'bg-gray-50 text-gray-600 ring-1 ring-inset ring-gray-500/10'}`}>
                        {ENV_LABEL[env] ?? env}
                      </span>
                    </div>
                    <div className="space-y-6">
                      {byEnv[env]!.map((resource) => (
                        <div key={resource.name} className="rounded-xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
                          {resource.type === 'ecs' ? (
                            <>
                              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">ECS Service</p>
                                  <p className="mt-0.5 font-medium text-gray-900 dark:text-white">{resource.name}</p>
                                  <p className="text-xs text-gray-400 dark:text-gray-500">Cluster: {resource.clusterName}</p>
                                </div>
                                <div className="flex items-center gap-8">
                                  {statBadge(resource.latestCpu, 'CPU now')}
                                  {statBadge(resource.latestMemory, 'Memory now')}
                                </div>
                              </div>
                              <div className="px-5 py-4">
                                <div className="mb-2 flex items-center gap-4 text-xs text-gray-400">
                                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-500" />CPU</span>
                                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Memory</span>
                                  <span className="ml-auto">Last 24h · 5-min</span>
                                </div>
                                {resource.series.length === 0 ? (
                                  <div className="flex h-40 items-center justify-center text-sm text-gray-400">No CloudWatch data yet</div>
                                ) : (
                                  <ResponsiveContainer width="100%" height={200}>
                                    <ComposedChart data={resource.series} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-gray-100 dark:text-gray-800" />
                                      <XAxis dataKey="time" tickFormatter={capacityTickFormatter} tick={{ fontSize: 10, fill: 'currentColor' }} className="text-gray-400" interval="preserveStartEnd" minTickGap={60} />
                                      <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 10, fill: 'currentColor' }} className="text-gray-400" />
                                      <Tooltip content={({ active, payload, label }) => {
                                        if (!active || !payload?.length) return null;
                                        const time = label ? new Date(String(label)).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
                                        return (
                                          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-gray-700 dark:bg-gray-900">
                                            <p className="mb-1 text-gray-400">{time}</p>
                                            {payload.map((p) => (
                                              <p key={String(p.dataKey)} style={{ color: p.color }}>{p.dataKey === 'cpu' ? 'CPU' : 'Memory'}: {p.value != null ? `${Number(p.value).toFixed(1)}%` : '—'}</p>
                                            ))}
                                          </div>
                                        );
                                      }} />
                                      <ReferenceLine y={85} stroke="#ef4444" strokeDasharray="4 2" strokeWidth={1} />
                                      <ReferenceLine y={60} stroke="#f59e0b" strokeDasharray="4 2" strokeWidth={1} />
                                      <Line type="monotone" dataKey="cpu" stroke="#3b82f6" strokeWidth={1.5} dot={false} connectNulls />
                                      <Line type="monotone" dataKey="memory" stroke="#10b981" strokeWidth={1.5} dot={false} connectNulls />
                                    </ComposedChart>
                                  </ResponsiveContainer>
                                )}
                                <div className="mt-2 flex items-center gap-4 text-xs text-gray-400">
                                  <span className="flex items-center gap-1"><span className="inline-block h-px w-4 border-t-2 border-dashed border-red-400" />85% critical</span>
                                  <span className="flex items-center gap-1"><span className="inline-block h-px w-4 border-t-2 border-dashed border-amber-400" />60% warning</span>
                                </div>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Lambda Function</p>
                                  <p className="mt-0.5 font-medium text-gray-900 dark:text-white">{resource.name}</p>
                                </div>
                                <div className="flex items-center gap-6">
                                  <div className="text-center">
                                    <p className="text-xl font-bold tabular-nums text-gray-900 dark:text-white">{resource.latestInvocations?.toLocaleString() ?? '—'}</p>
                                    <p className="text-xs text-gray-400">Invocations</p>
                                  </div>
                                  <div className="text-center">
                                    <p className={`text-xl font-bold tabular-nums ${(resource.latestThrottles ?? 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{resource.latestThrottles?.toLocaleString() ?? '—'}</p>
                                    <p className="text-xs text-gray-400">Throttles</p>
                                  </div>
                                  <div className="text-center">
                                    <p className="text-xl font-bold tabular-nums text-blue-600 dark:text-blue-400">{resource.latestConcurrency?.toLocaleString() ?? '—'}</p>
                                    <p className="text-xs text-gray-400">Concurrency</p>
                                  </div>
                                </div>
                              </div>
                              <div className="space-y-4 px-5 py-4">
                                {resource.series.length === 0 ? (
                                  <div className="flex h-40 items-center justify-center text-sm text-gray-400">No CloudWatch data yet</div>
                                ) : (
                                  <>
                                    {/* Invocations chart */}
                                    <div>
                                      <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400"><span className="h-2 w-2 rounded-full bg-blue-500" />Invocations (sum per 5 min)</p>
                                      <ResponsiveContainer width="100%" height={120}>
                                        <ComposedChart data={resource.series} margin={{ top: 2, right: 4, bottom: 0, left: -20 }}>
                                          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-gray-100 dark:text-gray-800" />
                                          <XAxis dataKey="time" tickFormatter={capacityTickFormatter} tick={{ fontSize: 9, fill: 'currentColor' }} className="text-gray-400" interval="preserveStartEnd" minTickGap={80} />
                                          <YAxis tick={{ fontSize: 9, fill: 'currentColor' }} className="text-gray-400" />
                                          <Tooltip content={({ active, payload, label }) => {
                                            if (!active || !payload?.length) return null;
                                            const time = label ? new Date(String(label)).toLocaleString([], { hour: '2-digit', minute: '2-digit' }) : '';
                                            return <div className="rounded border border-gray-200 bg-white px-2 py-1 text-xs shadow dark:border-gray-700 dark:bg-gray-900"><p className="text-gray-400">{time}</p><p className="text-blue-600">{Number(payload[0]?.value ?? 0).toLocaleString()} invocations</p></div>;
                                          }} />
                                          <Area type="monotone" dataKey="invocations" stroke="#3b82f6" fill="#3b82f620" strokeWidth={1.5} dot={false} connectNulls />
                                        </ComposedChart>
                                      </ResponsiveContainer>
                                    </div>
                                    {/* Throttles chart */}
                                    <div>
                                      <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400"><span className="h-2 w-2 rounded-full bg-red-500" />Throttles (sum per 5 min)</p>
                                      <ResponsiveContainer width="100%" height={120}>
                                        <ComposedChart data={resource.series} margin={{ top: 2, right: 4, bottom: 0, left: -20 }}>
                                          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-gray-100 dark:text-gray-800" />
                                          <XAxis dataKey="time" tickFormatter={capacityTickFormatter} tick={{ fontSize: 9, fill: 'currentColor' }} className="text-gray-400" interval="preserveStartEnd" minTickGap={80} />
                                          <YAxis tick={{ fontSize: 9, fill: 'currentColor' }} className="text-gray-400" allowDecimals={false} />
                                          <Tooltip content={({ active, payload, label }) => {
                                            if (!active || !payload?.length) return null;
                                            const time = label ? new Date(String(label)).toLocaleString([], { hour: '2-digit', minute: '2-digit' }) : '';
                                            return <div className="rounded border border-gray-200 bg-white px-2 py-1 text-xs shadow dark:border-gray-700 dark:bg-gray-900"><p className="text-gray-400">{time}</p><p className="text-red-600">{Number(payload[0]?.value ?? 0).toLocaleString()} throttles</p></div>;
                                          }} />
                                          <Area type="monotone" dataKey="throttles" stroke="#ef4444" fill="#ef444420" strokeWidth={1.5} dot={false} connectNulls />
                                        </ComposedChart>
                                      </ResponsiveContainer>
                                    </div>
                                    {/* Concurrency chart */}
                                    <div>
                                      <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400"><span className="h-2 w-2 rounded-full bg-violet-500" />Concurrent Executions (max per 5 min)</p>
                                      <ResponsiveContainer width="100%" height={120}>
                                        <ComposedChart data={resource.series} margin={{ top: 2, right: 4, bottom: 0, left: -20 }}>
                                          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-gray-100 dark:text-gray-800" />
                                          <XAxis dataKey="time" tickFormatter={capacityTickFormatter} tick={{ fontSize: 9, fill: 'currentColor' }} className="text-gray-400" interval="preserveStartEnd" minTickGap={80} />
                                          <YAxis tick={{ fontSize: 9, fill: 'currentColor' }} className="text-gray-400" allowDecimals={false} />
                                          <Tooltip content={({ active, payload, label }) => {
                                            if (!active || !payload?.length) return null;
                                            const time = label ? new Date(String(label)).toLocaleString([], { hour: '2-digit', minute: '2-digit' }) : '';
                                            return <div className="rounded border border-gray-200 bg-white px-2 py-1 text-xs shadow dark:border-gray-700 dark:bg-gray-900"><p className="text-gray-400">{time}</p><p className="text-violet-600">{Number(payload[0]?.value ?? 0).toLocaleString()} concurrent</p></div>;
                                          }} />
                                          <Area type="monotone" dataKey="concurrency" stroke="#8b5cf6" fill="#8b5cf620" strokeWidth={1.5} dot={false} connectNulls />
                                        </ComposedChart>
                                      </ResponsiveContainer>
                                    </div>
                                  </>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })(),
        },
        {
          key: 'dependencies',
          label: 'Dependencies',
          content: (() => {
            if (depsLoading) return <div className="flex justify-center py-12"><Spinner size="lg" /></div>;

            const TYPE_BADGE: Record<string, { label: string; classes: string }> = {
              'api-call':     { label: 'API Call',     classes: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20 dark:bg-blue-950/30 dark:text-blue-400' },
              'aws-resource': { label: 'AWS Resource', classes: 'bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-600/20 dark:bg-violet-950/30 dark:text-violet-400' },
              'database':     { label: 'Database',     classes: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-950/30 dark:text-amber-400' },
              'queue':        { label: 'Queue',        classes: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-950/30 dark:text-emerald-400' },
              'other':        { label: 'Other',        classes: 'bg-gray-50 text-gray-600 ring-1 ring-inset ring-gray-500/10' },
            };

            const HEALTH_BADGE: Record<string, string> = {
              healthy:   'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-950/30 dark:text-emerald-400',
              degraded:  'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-950/30 dark:text-amber-400',
              unhealthy: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20 dark:bg-red-950/30 dark:text-red-400',
              unknown:   'bg-gray-50 text-gray-600 ring-1 ring-inset ring-gray-500/10',
            };

            const allOutbound = depScan?.outbound ?? [];
            const inbound     = depScan?.inbound  ?? [];
            const sources     = depScan?.scannedSources ?? [];

            // Derive sorted environment list from outbound data
            const envOrder = ['production', 'staging', 'development'];
            const envs = Array.from(new Set(allOutbound.map((d) => d.environment)))
              .sort((a, b) => {
                const ai = envOrder.indexOf(a), bi = envOrder.indexOf(b);
                return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
              });

            // Default to first env when data arrives
            const activeEnv = depEnv && envs.includes(depEnv) ? depEnv : (envs[0] ?? '');
            const outbound  = allOutbound.filter((d) => d.environment === activeEnv);

            if (!depScan) {
              return (
                <div className="flex items-center justify-center py-16 text-sm text-gray-400">
                  Loading dependency scan…
                </div>
              );
            }

            return (
              <div className="space-y-6">

                {/* Scanned sources */}
                {sources.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                    <span className="font-medium text-gray-500">Scanned:</span>
                    {sources.map((s) => (
                      <span key={s} className="rounded-md bg-gray-100 px-2 py-0.5 dark:bg-gray-800">{s}</span>
                    ))}
                  </div>
                )}

                {/* Outbound dependencies with environment tabs */}
                <div>
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                      Outbound Dependencies
                      <span className="ml-2 text-xs font-normal text-gray-400">detected from environment variables</span>
                    </h3>
                    {envs.length > 1 && (
                      <div className="flex overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-medium">
                        {envs.map((env) => (
                          <button
                            key={env}
                            onClick={() => setDepEnv(env)}
                            className={`px-3 py-1.5 capitalize transition-colors ${
                              env === activeEnv
                                ? env === 'production'
                                  ? 'bg-emerald-600 text-white'
                                  : env === 'staging'
                                    ? 'bg-amber-500 text-white'
                                    : 'bg-orange-500 text-white'
                                : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'
                            }`}
                          >
                            {env}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {envs.length === 0 ? (
                    <p className="py-6 text-center text-sm text-gray-400">
                      {sources.length === 0
                        ? 'No AWS resources found to scan. Run an AWS sync to discover Lambda functions and ECS services.'
                        : 'No external dependencies detected in environment variables.'}
                    </p>
                  ) : outbound.length === 0 ? (
                    <p className="py-6 text-center text-sm text-gray-400 capitalize">
                      No dependencies detected in {activeEnv} environment variables.
                    </p>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-gray-100 dark:border-gray-800">
                      <div className="grid grid-cols-[160px_1fr_200px_120px] gap-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                        <span>Type</span>
                        <span>Target</span>
                        <span>Env Var</span>
                        <span>Source</span>
                      </div>
                      {outbound.map((dep, i) => {
                        const badge = TYPE_BADGE[dep.dependencyType] ?? TYPE_BADGE['other']!;
                        return (
                          <div
                            key={i}
                            className={`grid grid-cols-[160px_1fr_200px_120px] items-center gap-4 px-4 py-3 bg-white dark:bg-gray-900 text-sm ${i < outbound.length - 1 ? 'border-b border-gray-50 dark:border-gray-800/60' : ''}`}
                          >
                            <span className={`inline-flex w-fit items-center rounded-md px-2 py-0.5 text-xs font-semibold ${badge.classes}`}>
                              {badge.label}
                            </span>
                            <div className="min-w-0">
                              {dep.targetServiceId ? (
                                <Link to={`/catalog/services/${dep.targetServiceId}`} className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                                  {dep.targetLabel}
                                </Link>
                              ) : (
                                <span className="truncate font-medium text-gray-900 dark:text-white">{dep.targetLabel}</span>
                              )}
                              <p className="truncate font-mono text-xs text-gray-400 dark:text-gray-500">{dep.value}</p>
                            </div>
                            <span className="truncate font-mono text-xs text-gray-500 dark:text-gray-400">{dep.envVar}</span>
                            <span className="truncate text-xs text-gray-400 dark:text-gray-500">{dep.source.split(': ')[0]}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Inbound — shared across environments */}
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
                    Inbound
                    <span className="ml-2 text-xs font-normal text-gray-400">services that declare this as a dependency</span>
                  </h3>
                  {inbound.length === 0 ? (
                    <p className="py-6 text-center text-sm text-gray-400">No services registered as dependents.</p>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-gray-100 dark:border-gray-800">
                      <div className="grid grid-cols-[1fr_160px] gap-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                        <span>Service</span>
                        <span>Health</span>
                      </div>
                      {inbound.map((svc, i) => {
                        const hClass = HEALTH_BADGE[svc.healthStatus] ?? HEALTH_BADGE['unknown']!;
                        return (
                          <div
                            key={svc.serviceId}
                            className={`grid grid-cols-[1fr_160px] items-center gap-4 px-4 py-3 bg-white dark:bg-gray-900 text-sm ${i < inbound.length - 1 ? 'border-b border-gray-50 dark:border-gray-800/60' : ''}`}
                          >
                            <Link to={`/catalog/services/${svc.serviceId}`} className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                              {svc.serviceName}
                            </Link>
                            <span className={`inline-flex w-fit items-center rounded-md px-2 py-0.5 text-xs font-semibold capitalize ${hClass}`}>
                              {svc.healthStatus}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

              </div>
            );
          })(),
        },
      ]}
    />

    {riskPr && service && (
      <PrRiskDrawer
        repoFullName={service.repositoryUrl.replace('https://github.com/', '')}
        pr={riskPr}
        onClose={() => setRiskPr(null)}
      />
    )}
    </>
  );
}
