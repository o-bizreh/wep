import { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from 'recharts';
import { PageHeader } from '@wep/ui';
import { DollarSign, TrendingUp, TrendingDown, Minus, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { costApi } from '../../lib/api';
import { useCachedQuery } from '../../lib/query-cache';

// ── Shared helpers ────────────────────────────────────────────────────────────

type OverviewData = Awaited<ReturnType<typeof costApi.getOverview>>;
type InfraData    = Awaited<ReturnType<typeof costApi.getInfraCost>>;

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000)      return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function ChangeChip({ pct }: { pct: number }) {
  if (Math.abs(pct) < 0.5) {
    return <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full"><Minus className="h-3 w-3" /> 0%</span>;
  }
  if (pct > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 px-2 py-0.5 rounded-full ring-1 ring-inset ring-red-500/20">
        <TrendingUp className="h-3 w-3" />+{pct}%
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 rounded-full ring-1 ring-inset ring-emerald-500/20">
      <TrendingDown className="h-3 w-3" />{pct}%
    </span>
  );
}

function NoCredentials() {
  return (
    <div className="mt-8 flex flex-col items-center justify-center py-20 text-center rounded-2xl border border-slate-200/60 bg-white/60 dark:border-white/10 dark:bg-zinc-900/40 backdrop-blur-xl shadow-xl shadow-slate-200/20 dark:shadow-black/40 relative overflow-hidden animate-fade-in">
      <div className="absolute inset-0 bg-gradient-to-b from-blue-500/5 to-transparent pointer-events-none" />
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/20 z-10">
        <DollarSign className="h-7 w-7 text-white" />
      </div>
      <p className="font-semibold text-zinc-900 dark:text-white text-lg z-10">AWS Credentials Required</p>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 max-w-md z-10">
        Cost intelligence relies on Cost Explorer. Please configure your integration in{' '}
        <Link to="/settings" className="font-medium text-cyan-600 hover:text-cyan-500 dark:text-cyan-400 transition-colors">Settings</Link>
        {' '}to unlock these insights.
      </p>
    </div>
  );
}

function CustomTooltip({ active, payload, label }: any) {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-xl border border-zinc-200/50 bg-white/80 p-3 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/80">
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</p>
        <div className="space-y-1">
          {payload.map((p: any, i: number) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                {p.name}
              </span>
              <span className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-white">
                {p.value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
}

// ── AWS Costs tab ─────────────────────────────────────────────────────────────

function AwsCostsTab() {
  // Backend caches Cost Explorer for 15 min; mirror with 10 min on the client.
  // Tab switches inside this page no longer trigger refetches.
  const { data, isLoading: loading, error, refetch: fetchData } = useCachedQuery<OverviewData>(
    'costs:overview',
    () => costApi.getOverview(),
    { staleTimeMs: 10 * 60_000 },
  );

  if (error || data?.noCredentials) {
    return (
      <>
        {data?.noCredentials ? <NoCredentials /> : null}
        {!!error && !data?.noCredentials && (
          <div className="mt-8 rounded-2xl border border-red-500/20 bg-red-50 dark:bg-red-500/5 p-6 animate-fade-in text-center">
            <AlertCircle className="h-6 w-6 text-red-500 mx-auto mb-2" />
            <p className="text-sm font-medium text-red-600 dark:text-red-400">{error instanceof Error ? error.message : 'Failed to load cost data'}</p>
            <button onClick={fetchData} className="mt-4 text-xs font-bold uppercase tracking-wider text-red-500 hover:text-red-600 transition-colors">Try Again</button>
          </div>
        )}
      </>
    );
  }

  const thisTotal = data?.currentMonth?.total ?? 0;
  const lastTotal = data?.lastMonth?.total ?? 0;
  const changePct = data?.changePercent ?? 0;
  const byService = data?.byService ?? [];
  const daily     = data?.dailyTrend ?? [];

  return (
    <div className="animate-fade-in space-y-6">
      {/* Summary tiles - Bento blocks */}
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
        {loading ? Array.from({ length: 3 }).map((_, i) => (
          <div key={`sk-ov-${i}`} className="rounded-2xl border border-slate-200/60 bg-white/60 dark:border-white/10 dark:bg-zinc-900/40 backdrop-blur-xl p-5 animate-pulse">
            <div className="h-3 w-20 bg-zinc-200 dark:bg-zinc-800 rounded"></div>
            <div className="mt-3 h-8 w-32 bg-zinc-200 dark:bg-zinc-800 rounded"></div>
            <div className="mt-4 h-4 w-24 bg-zinc-200 dark:bg-zinc-800 rounded"></div>
          </div>
        )) : (
          <>
            <div className="relative overflow-hidden rounded-2xl border border-slate-200/60 bg-white/60 dark:border-white/10 dark:bg-zinc-900/40 backdrop-blur-xl p-6 shadow-xl shadow-slate-200/20 dark:shadow-black/40 transition-all hover:-translate-y-1 hover:shadow-2xl">
              <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-cyan-500/10 blur-2xl" />
              <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400 relative z-10">This Month</p>
              <p className="mt-2 text-4xl font-bold tracking-tight text-zinc-900 dark:text-white tabular-nums relative z-10">{fmt(thisTotal)}</p>
              <div className="mt-3 flex items-center gap-2 relative z-10">
                <ChangeChip pct={changePct} />
                <span className="text-xs text-zinc-500">vs last period</span>
              </div>
            </div>
            <div className="relative overflow-hidden rounded-2xl border border-slate-200/60 bg-white/60 dark:border-white/10 dark:bg-zinc-900/40 backdrop-blur-xl p-6 shadow-xl shadow-slate-200/20 dark:shadow-black/40 transition-all hover:-translate-y-1 hover:shadow-2xl">
              <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400 relative z-10">Last Month</p>
              <p className="mt-2 text-4xl font-bold tracking-tight text-zinc-900 dark:text-white tabular-nums relative z-10">{fmt(lastTotal)}</p>
              {data?.lastMonth && <p className="mt-3 text-xs font-medium text-zinc-500">{fmtMonth(data.lastMonth.period)}</p>}
            </div>
            <div className="relative overflow-hidden rounded-2xl border border-slate-200/60 bg-white/60 dark:border-white/10 dark:bg-zinc-900/40 backdrop-blur-xl p-6 shadow-xl shadow-slate-200/20 dark:shadow-black/40 transition-all hover:-translate-y-1 hover:shadow-2xl sm:col-span-1 col-span-2">
              <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400 relative z-10">Top Spender</p>
              <p className="mt-2 text-xl font-bold text-zinc-900 dark:text-white truncate relative z-10 w-full">{byService[0]?.service ?? '—'}</p>
              <p className="mt-3 text-xs font-medium text-zinc-500 relative z-10">{byService[0] ? fmt(byService[0].cost) + ' accumulated' : 'Awaiting data'}</p>
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Daily trend */}
        {(daily.length > 0 || loading) && (
          <div className="rounded-2xl border border-slate-200/60 bg-white/60 dark:border-white/10 dark:bg-zinc-900/40 backdrop-blur-xl p-6 shadow-xl shadow-slate-200/20 dark:shadow-black/40 flex flex-col">
            <h2 className="text-sm font-bold text-zinc-900 dark:text-white">Daily Spend Velocity</h2>
            <p className="mb-6 mt-1 text-xs text-zinc-500 dark:text-zinc-400">Unblended total cost per day (USD)</p>
            {loading ? (
              <div className="flex-1 min-h-[220px] bg-zinc-200/50 dark:bg-zinc-800/50 animate-pulse rounded-xl" />
            ) : (
              <ResponsiveContainer width="100%" height={220} className="flex-1">
                <AreaChart data={daily} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cyanBlueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.05} vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} tickFormatter={(v: string) => v.slice(5)} interval="preserveStartEnd" dy={10} />
                  <YAxis tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${v}`} dx={-10} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="cost" name="Cost" stroke="#06b6d4" strokeWidth={3} fill="url(#cyanBlueGrad)" dot={false} activeDot={{ r: 6, fill: "#0ea5e9", stroke: "#fff", strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        )}

        {/* Top services bar chart */}
        {(byService.length > 0 || loading) && (
          <div className="rounded-2xl border border-slate-200/60 bg-white/60 dark:border-white/10 dark:bg-zinc-900/40 backdrop-blur-xl p-6 shadow-xl shadow-slate-200/20 dark:shadow-black/40 flex flex-col">
            <h2 className="text-sm font-bold text-zinc-900 dark:text-white">Service Matrix</h2>
            <p className="mb-6 mt-1 text-xs text-zinc-500 dark:text-zinc-400">Current vs previous period allocation</p>
            {loading ? (
              <div className="flex-1 min-h-[220px] bg-zinc-200/50 dark:bg-zinc-800/50 animate-pulse rounded-xl" />
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(220, Math.min(byService.length, 8) * 32)} className="flex-1">
                <BarChart data={byService.slice(0, 8)} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                  <XAxis type="number" tickFormatter={(v: number) => `$${v}`} tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="service" tick={{ fontSize: 10, fill: '#71717a', fontWeight: 500 }} axisLine={false} tickLine={false} width={130} tickFormatter={(v: string) => v.length > 18 ? v.slice(0, 17) + '…' : v} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="lastMonthCost" name="Last month" fill="currentColor" fillOpacity={0.1} radius={[4, 4, 4, 4]} barSize={10} />
                  <Bar dataKey="cost" name="This month" fill="#3b82f6" radius={[4, 4, 4, 4]} barSize={10} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
      </div>

      {/* Service breakdown table */}
      {(byService.length > 0 || loading) && (
        <div className="rounded-2xl border border-slate-200/60 bg-white/60 dark:border-white/10 dark:bg-zinc-900/40 backdrop-blur-xl shadow-xl shadow-slate-200/20 dark:shadow-black/40 overflow-hidden">
          <div className="border-b border-slate-100 px-6 py-5 dark:border-white/5 bg-white/50 dark:bg-zinc-900/50">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Full Service Breakdown</h2>
          </div>
          <div className="overflow-x-auto relative">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-zinc-800/20">
                  <th className="px-6 py-4 text-left text-[11px] font-bold uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400">AWS Service</th>
                  <th className="px-6 py-4 text-right text-[11px] font-bold uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400">Current Spend</th>
                  <th className="px-6 py-4 text-right text-[11px] font-bold uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400">Previous Spend</th>
                  <th className="px-6 py-4 text-right text-[11px] font-bold uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/50 dark:divide-white/5">
                {loading ? Array.from({ length: 4 }).map((_, i) => (
                  <tr key={`sk-tb-${i}`} className="animate-pulse">
                    <td className="px-6 py-5"><div className="h-4 w-40 bg-zinc-200 dark:bg-zinc-800 rounded" /></td>
                    <td className="px-6 py-5 flex justify-end"><div className="h-4 w-20 bg-zinc-200 dark:bg-zinc-800 rounded" /></td>
                    <td className="px-6 py-5"><div className="h-4 w-20 bg-zinc-200 dark:bg-zinc-800 rounded ml-auto" /></td>
                    <td className="px-6 py-5"><div className="h-5 w-16 bg-zinc-200 dark:bg-zinc-800 rounded-full ml-auto" /></td>
                  </tr>
                )) : byService.map((s) => (
                  <tr key={s.service} className="hover:bg-white dark:hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4 font-semibold text-zinc-800 dark:text-zinc-100">{s.service || '-'}</td>
                    <td className="px-6 py-4 text-right font-medium text-zinc-900 dark:text-white tabular-nums">{fmt(s.cost)}</td>
                    <td className="px-6 py-4 text-right tabular-nums text-zinc-500 dark:text-zinc-400">{fmt(s.lastMonthCost)}</td>
                    <td className="px-6 py-4 text-right"><ChangeChip pct={s.changePercent} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && byService.length === 0 && (
        <div className="mt-6 rounded-2xl border border-slate-200/60 bg-white/60 dark:border-white/10 dark:bg-zinc-900/40 backdrop-blur-xl p-16 text-center shadow-xl">
          <div className="mb-4 flex h-14 w-14 mx-auto items-center justify-center rounded-full bg-slate-100 dark:bg-zinc-800">
            <DollarSign className="h-6 w-6 text-zinc-400" />
          </div>
          <p className="font-semibold text-zinc-900 dark:text-white text-lg">Clean Slate</p>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto">Cost Explorer reflects absolutely zero spend for this period. Keep in mind AWS charges generally lag by 24 hours.</p>
        </div>
      )}
    </div>
  );
}

// ── Tracked Repos Infra Cost tab ──────────────────────────────────────────────

function InfraCostTab() {
  const { data, isLoading: loading, error, refetch: fetchData } = useCachedQuery<InfraData>(
    'costs:infra',
    () => costApi.getInfraCost(),
    { staleTimeMs: 10 * 60_000 },
  );

  if (error) {
    return (
      <div className="mt-8 rounded-2xl border border-red-500/20 bg-red-50 dark:bg-red-500/5 p-6 animate-fade-in text-center">
        <AlertCircle className="h-6 w-6 text-red-500 mx-auto mb-2" />
        <p className="text-sm font-medium text-red-600 dark:text-red-400">{error instanceof Error ? error.message : 'Failed to load infra cost data'}</p>
        <button onClick={fetchData} className="mt-4 text-xs font-bold uppercase tracking-wider text-red-500 hover:text-red-600 transition-colors">Try Again</button>
      </div>
    );
  }

  if (data?.noRepos) {
    return (
      <div className="mt-8 flex flex-col items-center justify-center py-20 text-center rounded-2xl border border-slate-200/60 bg-white/60 dark:border-white/10 dark:bg-zinc-900/40 backdrop-blur-xl shadow-xl shadow-slate-200/20 dark:shadow-black/40 animate-fade-in">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800 shadow-sm">
          <DollarSign className="h-7 w-7 text-zinc-400" />
        </div>
        <p className="font-semibold text-zinc-900 dark:text-white text-lg">No Tracked Repositories</p>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 max-w-sm">
          Visit the{' '}
          <Link to="/deployments" className="font-medium text-cyan-600 hover:text-cyan-500 dark:text-cyan-400 transition-colors">Deployments Tracking</Link>
          {' '}matrix to select which services should have their infra spend monitored.
        </p>
      </div>
    );
  }

  if (data?.noCredentials) {
    return <NoCredentials />;
  }

  const services       = data?.services ?? [];
  const period         = data?.period ?? '';
  const lastPeriod     = data?.lastPeriod ?? '';
  const totalCost      = data?.totalThisMonth ?? 0;
  const matchedCount   = data?.matchedCount ?? 0;
  const unmatchedCount = data?.unmatchedCount ?? 0;
  const resourceLevel  = data?.resourceLevel ?? false;

  const matched   = services.filter((s) => s.matched);
  const chartData = matched.map((s) => ({
    name: s.serviceName.length > 18 ? s.serviceName.slice(0, 17) + '…' : s.serviceName,
    dev:  s.environments.dev.thisCost,
    prod: s.environments.prod.thisCost,
    lastTotal: s.lastCost,
  }));

  return (
    <div className="animate-fade-in space-y-6">
      {/* Attribution banner */}
      {!loading && (
        <div className={`rounded-xl border px-5 py-4 ${resourceLevel ? 'border-cyan-500/20 bg-cyan-500/5 dark:bg-cyan-500/10' : 'border-amber-500/20 bg-amber-50 dark:bg-amber-500/10'}`}>
          <div className="flex items-start gap-3">
            <AlertCircle className={`h-5 w-5 shrink-0 mt-0.5 ${resourceLevel ? 'text-cyan-500' : 'text-amber-500'}`} />
            <p className={`text-[13px] leading-relaxed ${resourceLevel ? 'text-cyan-800 dark:text-cyan-200' : 'text-amber-800 dark:text-amber-200'}`}>
              {resourceLevel ? (
                <>
                  <strong className="font-bold">Deep Linking Active:</strong> ECS services and Lambda functions are matched by exact infra names <code className="font-mono text-cyan-700 dark:text-cyan-300 font-bold bg-white/40 dark:bg-black/20 px-1 rounded">dev-&#123;slug&#125;</code> and <code className="font-mono text-cyan-700 dark:text-cyan-300 font-bold bg-white/40 dark:bg-black/20 px-1 rounded">prod-&#123;slug&#125;</code>.
                  {unmatchedCount > 0 && ` Notice: ${unmatchedCount} repos are failing to link infrastructure.`}
                </>
              ) : (
                <>
                  <strong className="font-bold">Heuristic Routing Mode:</strong> Since resource-level data is off in AWS, we divide standard container spend uniformly across {services.length} tracked target(s). For precision tracking, please enable Resource-Level allocations inside AWS Cost Explorer.
                </>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-6">
        {loading ? Array.from({ length: 3 }).map((_, i) => (
          <div key={`sk-ic-${i}`} className="rounded-2xl border border-slate-200/60 bg-white/60 dark:border-white/10 dark:bg-zinc-900/40 backdrop-blur-xl p-5 animate-pulse">
            <div className="h-3 w-20 bg-zinc-200 dark:bg-zinc-800 rounded"></div>
            <div className="mt-3 h-8 w-32 bg-zinc-200 dark:bg-zinc-800 rounded"></div>
            <div className="mt-4 h-4 w-24 bg-zinc-200 dark:bg-zinc-800 rounded"></div>
          </div>
        )) : (
          <>
            <div className="relative overflow-hidden rounded-2xl border border-slate-200/60 bg-white/60 dark:border-white/10 dark:bg-zinc-900/40 backdrop-blur-xl p-6 shadow-xl shadow-slate-200/20 dark:shadow-black/40 transition-all hover:-translate-y-1 hover:shadow-2xl">
              <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400 relative z-10">Repo Allocation</p>
              <p className="mt-2 text-4xl font-bold tracking-tight text-zinc-900 dark:text-white tabular-nums relative z-10">{fmt(totalCost)}</p>
              {period && <p className="mt-3 text-xs font-medium text-zinc-500">{fmtMonth(period)}</p>}
            </div>
            <div className="relative overflow-hidden rounded-2xl border border-slate-200/60 bg-white/60 dark:border-white/10 dark:bg-zinc-900/40 backdrop-blur-xl p-6 shadow-xl shadow-slate-200/20 dark:shadow-black/40 transition-all hover:-translate-y-1 hover:shadow-2xl">
              <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400 relative z-10">Anchored Services</p>
              <p className="mt-2 text-4xl font-bold tracking-tight text-cyan-600 dark:text-cyan-400 tabular-nums relative z-10">{matchedCount}</p>
              <p className="mt-3 text-xs font-medium text-zinc-500 relative z-10">{resourceLevel ? 'Exact ARNs matched' : 'Computed blocks'}</p>
            </div>
            <div className="relative overflow-hidden rounded-2xl border border-slate-200/60 bg-white/60 dark:border-white/10 dark:bg-zinc-900/40 backdrop-blur-xl p-6 shadow-xl shadow-slate-200/20 dark:shadow-black/40 transition-all hover:-translate-y-1 hover:shadow-2xl">
              <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400 relative z-10">Ghost Instances</p>
              <p className={`mt-2 text-4xl font-bold tracking-tight tabular-nums relative z-10 ${unmatchedCount > 0 ? 'text-amber-500' : 'text-zinc-400 dark:text-zinc-600'}`}>{unmatchedCount}</p>
              <p className="mt-3 text-xs font-medium text-zinc-500 relative z-10">{resourceLevel ? 'Failed to bind namespace' : 'N/A'}</p>
            </div>
          </>
        )}
      </div>

      {/* Stacked dev/prod bar chart */}
      {(chartData.length > 0 || loading) && (
        <div className="rounded-2xl border border-slate-200/60 bg-white/60 dark:border-white/10 dark:bg-zinc-900/40 backdrop-blur-xl p-6 shadow-xl shadow-slate-200/20 dark:shadow-black/40 flex flex-col">
          <h2 className="text-sm font-bold text-zinc-900 dark:text-white">Environment Allocation map</h2>
          <p className="mb-6 mt-1 text-xs text-zinc-500 dark:text-zinc-400">Total cluster draw stacked (Dev vs Prod)</p>
          {loading ? (
            <div className="flex-1 min-h-[160px] bg-zinc-200/50 dark:bg-zinc-800/50 animate-pulse rounded-xl" />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 40)} className="flex-1">
              <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                <XAxis type="number" tickFormatter={(v: number) => `$${v}`} tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#71717a', fontWeight: 500 }} axisLine={false} tickLine={false} width={150} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="prod" name="Production" stackId="env" fill="#0284c7" radius={[0, 0, 0, 0]} barSize={12} />
                <Bar dataKey="dev" name="Development" stackId="env" fill="#06b6d4" radius={[0, 4, 4, 0]} barSize={12} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* Per-repo table */}
      {(services.length > 0 || loading) && (
        <div className="rounded-2xl border border-slate-200/60 bg-white/60 dark:border-white/10 dark:bg-zinc-900/40 backdrop-blur-xl shadow-xl shadow-slate-200/20 dark:shadow-black/40 overflow-hidden">
          <div className="border-b border-slate-100 px-6 py-5 dark:border-white/5 bg-white/50 dark:bg-zinc-900/50 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Repository Ledger</h2>
            {!loading && <p className="text-[10px] uppercase font-bold text-zinc-400">{lastPeriod ? `Delta vs ${fmtMonth(lastPeriod)}` : 'Periodic Delta'}</p>}
          </div>
          <div className="overflow-x-auto relative">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-zinc-800/20">
                  <th className="px-6 py-4 text-left text-[11px] font-bold uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400">Target</th>
                  <th className="px-6 py-4 text-right text-[11px] font-bold uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400">Sandbox (Dev)</th>
                  <th className="px-6 py-4 text-right text-[11px] font-bold uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400">Live (Prod)</th>
                  <th className="px-6 py-4 text-right text-[11px] font-bold uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400">Total Run Rate</th>
                  <th className="px-6 py-4 text-right text-[11px] font-bold uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400">Previous Run Rate</th>
                  <th className="px-6 py-4 text-right text-[11px] font-bold uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400">Net Delta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/50 dark:divide-white/5">
                {loading ? Array.from({ length: 4 }).map((_, i) => (
                  <tr key={`sk-tbl-${i}`} className="animate-pulse">
                    <td className="px-6 py-5"><div className="h-8 w-32 bg-zinc-200 dark:bg-zinc-800 rounded" /></td>
                    <td className="px-6 py-5"><div className="h-4 w-12 bg-zinc-200 dark:bg-zinc-800 rounded ml-auto" /></td>
                    <td className="px-6 py-5"><div className="h-4 w-12 bg-zinc-200 dark:bg-zinc-800 rounded ml-auto" /></td>
                    <td className="px-6 py-5"><div className="h-4 w-20 bg-zinc-200 dark:bg-zinc-800 rounded ml-auto" /></td>
                    <td className="px-6 py-5"><div className="h-4 w-20 bg-zinc-200 dark:bg-zinc-800 rounded ml-auto" /></td>
                    <td className="px-6 py-5"><div className="h-6 w-16 bg-zinc-200 dark:bg-zinc-800 rounded-full ml-auto" /></td>
                  </tr>
                )) : services.map((s) => (
                  <tr key={s.serviceId} className="hover:bg-white dark:hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4">
                      <Link to={`/catalog/services/${s.serviceId}`} className="font-semibold text-zinc-900 hover:text-cyan-600 dark:text-white dark:hover:text-cyan-400 block pb-1">{s.serviceName}</Link>
                      <span className="font-mono text-[10px] text-zinc-400 bg-zinc-100 dark:bg-zinc-800/50 px-1.5 py-0.5 rounded">{s.repoSlug || '-'}</span>
                    </td>
                    {s.matched ? (
                      <>
                        <td className="px-6 py-4 text-right tabular-nums text-zinc-600 dark:text-zinc-300 font-medium">
                          {s.environments.dev.thisCost > 0 ? fmt(s.environments.dev.thisCost) : <span className="text-zinc-300 dark:text-zinc-600">-</span>}
                        </td>
                        <td className="px-6 py-4 text-right tabular-nums text-zinc-600 dark:text-zinc-300 font-medium">
                          {s.environments.prod.thisCost > 0 ? fmt(s.environments.prod.thisCost) : <span className="text-zinc-300 dark:text-zinc-600">-</span>}
                        </td>
                        <td className="px-6 py-4 text-right tabular-nums font-bold text-zinc-900 dark:text-white">{fmt(s.thisCost)}</td>
                        <td className="px-6 py-4 text-right tabular-nums text-zinc-400 dark:text-zinc-500">{fmt(s.lastCost)}</td>
                        <td className="px-6 py-4 text-right"><ChangeChip pct={s.changePercent} /></td>
                      </>
                    ) : (
                      <td colSpan={5} className="px-6 py-4 text-right">
                        <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold tracking-wide text-amber-600 border border-amber-500/20">
                          <AlertCircle className="h-3 w-3" />
                          UNBOUND (NO INFRA MATCHED)
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page shell with tabs ──────────────────────────────────────────────────────

type Tab = 'infra-cost' | 'aws-costs';

export function CostOverviewPage() {
  const [tab, setTab] = useState<Tab>('infra-cost');

  return (
    <div className="space-y-6">
      <PageHeader title="Cost Intelligence" />

      {/* Unified segmented pill control */}
      <div className="inline-flex w-full sm:w-auto p-1 rounded-full bg-white/40 dark:bg-black/20 backdrop-blur-xl border border-slate-200/50 dark:border-white/5 relative z-10 shadow-sm shadow-zinc-200/20 dark:shadow-none">
        <button
          onClick={() => setTab('infra-cost')}
          className={`flex-1 sm:w-48 rounded-full px-4 py-2.5 text-sm font-bold transition-all duration-300 ${tab === 'infra-cost' ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/20' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-white'}`}
        >
          Tracked Repo Costs
        </button>
        <button
          onClick={() => setTab('aws-costs')}
          className={`flex-1 sm:w-48 rounded-full px-4 py-2.5 text-sm font-bold transition-all duration-300 ${tab === 'aws-costs' ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/20' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-white'}`}
        >
          AWS Global Costs
        </button>
      </div>

      <div className="relative z-10">
        {tab === 'aws-costs'  && <AwsCostsTab />}
        {tab === 'infra-cost' && <InfraCostTab />}
      </div>
    </div>
  );
}
