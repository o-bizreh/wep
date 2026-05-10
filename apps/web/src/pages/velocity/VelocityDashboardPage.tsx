import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, BarChart, Bar,
} from 'recharts';
import { PageHeader, Spinner } from '@wep/ui';
import { Rocket, AlertTriangle, CheckCircle2, Clock, RefreshCw } from 'lucide-react';
import { catalogApi } from '../../lib/api';

type VelocityData = Awaited<ReturnType<typeof catalogApi.getDeploymentVelocity>>;
type Metrics = NonNullable<VelocityData['metrics']>;

// ── DORA classification colours ───────────────────────────────────────────────

const CLASS_STYLE: Record<string, { label: string; classes: string; dot: string }> = {
  elite:  { label: 'Elite',  classes: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/30 dark:text-emerald-400', dot: 'bg-emerald-500' },
  high:   { label: 'High',   classes: 'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-950/30 dark:text-blue-400',               dot: 'bg-blue-500' },
  medium: { label: 'Medium', classes: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950/30 dark:text-amber-400',           dot: 'bg-amber-500' },
  low:    { label: 'Low',    classes: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950/30 dark:text-red-400',                     dot: 'bg-red-500' },
};

function ClassBadge({ cls }: { cls: string }) {
  const s = CLASS_STYLE[cls] ?? CLASS_STYLE['low']!;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.classes}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({
  title, value, unit, classification, description, icon,
}: {
  title: string; value: string; unit?: string;
  classification: string; description: string; icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white/60 p-5 shadow-xl shadow-slate-200/20 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-gray-400 dark:text-gray-500">
          {icon}
          <span className="text-xs font-semibold uppercase tracking-wide">{title}</span>
        </div>
        <ClassBadge cls={classification} />
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-3xl font-bold tabular-nums text-gray-900 dark:text-white">{value}</span>
        {unit && <span className="text-sm text-gray-400 dark:text-gray-500">{unit}</span>}
      </div>
      <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{description}</p>
    </div>
  );
}

function formatLeadTime(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function VelocityDashboardPage() {
  const [data, setData]       = useState<VelocityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await catalogApi.getDeploymentVelocity();
      setData(result);
    } catch (err) {
      console.error('Failed to fetch velocity:', err);
      setError(err instanceof Error ? err.message : 'Failed to load velocity data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);

  // ── No repos selected ─────────────────────────────────────────────────────

  if (!loading && data?.noRepos) {
    return (
      <div>
        <PageHeader title="Engineering Velocity" onRefresh={fetchData} refreshing={loading} />
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800">
            <Rocket className="h-6 w-6 text-gray-400" />
          </div>
          <p className="font-medium text-gray-500 dark:text-gray-400">No repos selected</p>
          <p className="mt-1 text-sm text-gray-400">
            Go to the{' '}
            <Link to="/deployments" className="text-blue-600 hover:underline dark:text-blue-400">Deployments</Link>
            {' '}page and choose which repos to monitor.
          </p>
        </div>
      </div>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div>
        <PageHeader title="Engineering Velocity" refreshing />
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Engineering Velocity" onRefresh={fetchData} refreshing={loading} />
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950/20">
          <p className="font-medium text-red-700 dark:text-red-400">Failed to load velocity data</p>
          <p className="mt-1 text-sm text-red-600 dark:text-red-500">{error}</p>
        </div>
      </div>
    );
  }

  const metrics = data?.metrics;

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <PageHeader title="Engineering Velocity" />
        <div className="flex items-center gap-3">
          {data && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {data.watchedRepos} repo{data.watchedRepos !== 1 ? 's' : ''} · last {data.periodDays} days · {data.totalRuns} production runs
            </span>
          )}
          <button
            onClick={fetchData}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* DORA metric cards */}
      {metrics ? (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard
              title="Deploy Frequency"
              value={String(metrics.deploymentFrequency.value)}
              unit={metrics.deploymentFrequency.unit}
              classification={metrics.deploymentFrequency.classification}
              description="Successful production deployments"
              icon={<Rocket className="h-4 w-4" />}
            />
            <MetricCard
              title="Change Failure Rate"
              value={String(metrics.changeFailureRate.value)}
              unit="%"
              classification={metrics.changeFailureRate.classification}
              description="Production runs that ended in failure"
              icon={<AlertTriangle className="h-4 w-4" />}
            />
            <MetricCard
              title="Lead Time"
              value={formatLeadTime(metrics.leadTimeHours.value)}
              classification={metrics.leadTimeHours.classification}
              description="Avg workflow duration for successful runs"
              icon={<Clock className="h-4 w-4" />}
            />
            <MetricCard
              title="MTTR"
              value={metrics.mttrHours ? formatLeadTime(metrics.mttrHours.value) : '—'}
              classification={metrics.mttrHours?.classification ?? 'elite'}
              description={metrics.mttrHours ? 'Avg time from failure to next success' : 'No failures in this period'}
              icon={<CheckCircle2 className="h-4 w-4" />}
            />
          </div>

          {/* Weekly trend */}
          {data?.weeklyTrend && data.weeklyTrend.length > 0 && (
            <div className="mt-6 rounded-2xl border border-slate-200/60 bg-white/60 p-5 shadow-xl shadow-slate-200/20 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40">
              <h2 className="mb-1 text-sm font-semibold text-gray-700 dark:text-gray-200">Weekly Deployment Trend</h2>
              <p className="mb-5 text-xs text-gray-400">Production deployments per week over the last 4 weeks</p>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={data.weeklyTrend} margin={{ top: 4, right: 16, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradDeploy" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradFail" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.1} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                  <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="deploys"  name="Successful" stroke="#3b82f6" strokeWidth={2} fill="url(#gradDeploy)" dot={{ r: 3 }} />
                  <Area type="monotone" dataKey="failures" name="Failed"     stroke="#ef4444" strokeWidth={2} fill="url(#gradFail)"   dot={{ r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Per-repo breakdown */}
          {data?.repoBreakdown && data.repoBreakdown.length > 0 && (
            <div className="mt-6 rounded-2xl border border-slate-200/60 bg-white/60 p-5 shadow-xl shadow-slate-200/20 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40">
              <h2 className="mb-1 text-sm font-semibold text-gray-700 dark:text-gray-200">Per-Repo Breakdown</h2>
              <p className="mb-5 text-xs text-gray-400">Production deployments per repo in the last {data.periodDays} days</p>
              <div className="mb-4">
                <ResponsiveContainer width="100%" height={Math.max(120, data.repoBreakdown.length * 32)}>
                  <BarChart data={data.repoBreakdown} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="serviceName" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={140} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }} />
                    <Bar dataKey="deploys"  name="Successful" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="failures" name="Failed"     fill="#ef4444" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden rounded-lg border border-gray-100 dark:border-gray-800">
                {data.repoBreakdown.map((r) => (
                  <div key={r.serviceId} className="flex items-center gap-4 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <Link
                      to={`/catalog/services/${r.serviceId}`}
                      className="flex-1 truncate text-sm font-medium text-gray-800 hover:text-blue-600 dark:text-gray-100 dark:hover:text-blue-400"
                    >
                      {r.serviceName}
                    </Link>
                    <span className="tabular-nums text-sm text-emerald-600 dark:text-emerald-400">{r.deploys} ✓</span>
                    {r.failures > 0 && (
                      <span className="tabular-nums text-sm text-red-600 dark:text-red-400">{r.failures} ✗</span>
                    )}
                    <span className="w-12 text-right text-xs text-gray-400">{r.failRate}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-2xl border border-slate-200/60 bg-white/60 p-12 text-center shadow-xl shadow-slate-200/20 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40">
          <p className="font-medium text-gray-500 dark:text-gray-400">No production deployment data yet</p>
          <p className="mt-1 text-sm text-gray-400">Push to your main/master branch to start seeing metrics here.</p>
        </div>
      )}
    </div>
  );
}
