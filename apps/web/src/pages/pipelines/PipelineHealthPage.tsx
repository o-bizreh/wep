import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend,
} from 'recharts';
import { PageHeader, Spinner } from '@wep/ui';
import { CheckCircle2, XCircle, Clock, MinusCircle, GitBranch, RefreshCw } from 'lucide-react';
import { catalogApi } from '../../lib/api';

type PipelineData = Awaited<ReturnType<typeof catalogApi.getDeploymentPipelines>>;

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function StatTile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200/60 bg-white/60 px-5 py-4 shadow-xl shadow-slate-200/20 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gray-50 dark:bg-gray-800">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold tabular-nums text-gray-900 dark:text-white">{value}</p>
        <p className="text-xs text-gray-400">{label}</p>
        {sub && <p className="text-xs text-gray-300 dark:text-gray-600">{sub}</p>}
      </div>
    </div>
  );
}

export function PipelineHealthPage() {
  const [data, setData]       = useState<PipelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await catalogApi.getDeploymentPipelines());
    } catch (err) {
      console.error('Failed to fetch pipeline data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load pipeline data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);

  // ── No repos ──────────────────────────────────────────────────────────────

  if (!loading && data?.noRepos) {
    return (
      <div>
        <PageHeader title="Pipeline Analytics" onRefresh={fetchData} refreshing={loading} />
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800">
            <GitBranch className="h-6 w-6 text-gray-400" />
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
        <PageHeader title="Pipeline Analytics" refreshing />
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Pipeline Analytics" onRefresh={fetchData} refreshing={loading} />
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950/20">
          <p className="font-medium text-red-700 dark:text-red-400">Failed to load pipeline data</p>
          <p className="mt-1 text-sm text-red-600 dark:text-red-500">{error}</p>
        </div>
      </div>
    );
  }

  const failureTypeData = data?.failureByType
    ? [
        { name: 'Failed',    count: data.failureByType.failure,   fill: '#ef4444' },
        { name: 'Timed out', count: data.failureByType.timed_out, fill: '#f97316' },
        { name: 'Cancelled', count: data.failureByType.cancelled,  fill: '#94a3b8' },
      ].filter((d) => d.count > 0)
    : [];

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <PageHeader title="Pipeline Analytics" />
        <div className="flex items-center gap-3">
          {data && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {data.totalRuns} runs · last {data.periodDays} days
              {(data.inProgress ?? 0) > 0 && ` · ${data.inProgress} in progress`}
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

      {/* Summary tiles */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
          label="Success Rate"
          value={data?.successRate != null ? `${data.successRate}%` : '—'}
          sub={`${data?.completed ?? 0} completed`}
        />
        <StatTile
          icon={<XCircle className="h-5 w-5 text-red-500" />}
          label="Failures"
          value={String((data?.failureByType?.failure ?? 0) + (data?.failureByType?.timed_out ?? 0))}
          sub="failed + timed out"
        />
        <StatTile
          icon={<Clock className="h-5 w-5 text-blue-600" />}
          label="Avg Duration"
          value={data?.avgDurationSeconds != null ? formatDuration(data.avgDurationSeconds) : '—'}
          sub="across all workflows"
        />
        <StatTile
          icon={<MinusCircle className="h-5 w-5 text-gray-400" />}
          label="Cancelled"
          value={String(data?.failureByType?.cancelled ?? 0)}
          sub="manually cancelled"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

        {/* Failure type breakdown */}
        {failureTypeData.length > 0 && (
          <div className="rounded-2xl border border-slate-200/60 bg-white/60 p-5 shadow-xl shadow-slate-200/20 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40">
            <h2 className="mb-1 text-sm font-semibold text-gray-700 dark:text-gray-200">Failure Breakdown</h2>
            <p className="mb-4 text-xs text-gray-400">Runs that did not succeed, by conclusion</p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={failureTypeData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                <Bar dataKey="count" name="Count" radius={[4, 4, 0, 0]}>
                  {failureTypeData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Slowest workflows */}
        {(data?.slowestWorkflows?.length ?? 0) > 0 && (
          <div className="rounded-2xl border border-slate-200/60 bg-white/60 p-5 shadow-xl shadow-slate-200/20 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40">
            <h2 className="mb-1 text-sm font-semibold text-gray-700 dark:text-gray-200">Slowest Workflows</h2>
            <p className="mb-4 text-xs text-gray-400">Average run duration</p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart
                data={data!.slowestWorkflows}
                layout="vertical"
                margin={{ top: 0, right: 40, left: 0, bottom: 0 }}
              >
                <XAxis type="number" tickFormatter={(v) => formatDuration(v)} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={120} />
                <Tooltip formatter={(v) => [formatDuration(Number(v)), 'Avg duration']} contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }} />
                <Bar dataKey="avgDuration" name="Avg duration" fill="#6366f1" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

      </div>

      {/* Workflow success/fail table */}
      {(data?.workflowStats?.length ?? 0) > 0 && (
        <div className="mt-6 rounded-2xl border border-slate-200/60 bg-white/60 p-5 shadow-xl shadow-slate-200/20 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40">
          <h2 className="mb-1 text-sm font-semibold text-gray-700 dark:text-gray-200">Workflow Health</h2>
          <p className="mb-4 text-xs text-gray-400">All workflow names across watched repos, sorted by run count</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800 text-xs text-gray-400 uppercase tracking-wide">
                  <th className="pb-2 text-left font-medium">Workflow</th>
                  <th className="pb-2 text-right font-medium">Runs</th>
                  <th className="pb-2 text-right font-medium">Failures</th>
                  <th className="pb-2 text-right font-medium">Fail %</th>
                  <th className="pb-2 text-right font-medium">Avg Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {data!.workflowStats!.map((w) => (
                  <tr key={w.name} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="py-2 pr-4 font-medium text-gray-800 dark:text-gray-100">{w.name}</td>
                    <td className="py-2 text-right tabular-nums text-gray-500 dark:text-gray-400">{w.total}</td>
                    <td className="py-2 text-right tabular-nums">
                      <span className={w.failures > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}>
                        {w.failures}
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      <span className={
                        w.failRate === 0 ? 'text-emerald-600 dark:text-emerald-400' :
                        w.failRate < 10 ? 'text-amber-600 dark:text-amber-400' :
                        'text-red-600 dark:text-red-400'
                      }>
                        {w.failRate}%
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums text-gray-500 dark:text-gray-400">{formatDuration(w.avgDuration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per-repo table */}
      {(data?.repoStats?.length ?? 0) > 0 && (
        <div className="mt-6 rounded-2xl border border-slate-200/60 bg-white/60 p-5 shadow-xl shadow-slate-200/20 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40">
          <h2 className="mb-1 text-sm font-semibold text-gray-700 dark:text-gray-200">Per-Repo Health</h2>
          <p className="mb-4 text-xs text-gray-400">CI health per watched repo over the last {data?.periodDays} days</p>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {data!.repoStats!.map((r) => (
              <div key={r.serviceId} className="flex items-center gap-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <Link
                  to={`/catalog/services/${r.serviceId}`}
                  className="flex-1 truncate text-sm font-medium text-gray-800 hover:text-blue-600 dark:text-gray-100 dark:hover:text-blue-400"
                >
                  {r.serviceName}
                </Link>
                <span className="text-xs text-gray-400 tabular-nums">{r.total} runs</span>
                <span className="text-xs text-emerald-600 dark:text-emerald-400 tabular-nums">{r.successes} ✓</span>
                {r.failures > 0 && (
                  <span className="text-xs text-red-600 dark:text-red-400 tabular-nums">{r.failures} ✗</span>
                )}
                <span className={`w-10 text-right text-xs tabular-nums ${
                  r.failRate === 0 ? 'text-emerald-600 dark:text-emerald-400' :
                  r.failRate < 10 ? 'text-amber-600 dark:text-amber-400' :
                  'text-red-600 dark:text-red-400'
                }`}>
                  {r.failRate}%
                </span>
                <span className="w-14 text-right text-xs text-gray-400 tabular-nums">{formatDuration(r.avgDurationSeconds)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && data && !data.noRepos && (data.totalRuns ?? 0) === 0 && (
        <div className="rounded-2xl border border-slate-200/60 bg-white/60 p-12 text-center shadow-xl shadow-slate-200/20 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40">
          <p className="font-medium text-gray-500 dark:text-gray-400">No pipeline runs found in the last {data.periodDays} days</p>
          <p className="mt-1 text-sm text-gray-400">Trigger a workflow on any of your watched repos to start seeing data.</p>
        </div>
      )}
    </div>
  );
}
