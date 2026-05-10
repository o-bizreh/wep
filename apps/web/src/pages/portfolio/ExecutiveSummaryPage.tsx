import { useMemo } from 'react';
import { PageHeader } from '@wep/ui';
import { Loader2, TrendingUp, TrendingDown, Minus, DollarSign, Lightbulb, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { costApi, portfolioApi, type PortfolioRecommendation } from '../../lib/api';
import { useCachedQuery, peekQuery } from '../../lib/query-cache';

function fmtCurrency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function ChangeChip({ pct }: { pct: number }): JSX.Element {
  if (Math.abs(pct) < 0.5) return <span className="inline-flex items-center gap-1 text-xs font-bold text-zinc-400"><Minus className="h-3 w-3" />0%</span>;
  if (pct > 0) return <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600 dark:text-red-400"><TrendingUp className="h-3 w-3" />+{pct.toFixed(1)}%</span>;
  return <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400"><TrendingDown className="h-3 w-3" />{pct.toFixed(1)}%</span>;
}

export function ExecutiveSummaryPage() {
  // Three independent queries — they share cache keys with the other portfolio
  // pages, so visiting Executive Summary after Recommendations / Budgets is
  // instant. Each query has its own TTL matching that page's data freshness.
  const overviewQuery = useCachedQuery('costs:overview', () => costApi.getOverview(), { staleTimeMs: 10 * 60_000 });
  const budgetsQuery = useCachedQuery('portfolio:budgets:status', () => portfolioApi.getBudgetStatuses(), { staleTimeMs: 5 * 60_000 });

  // Recommendations are now lazy-loaded per service on the Recommendations page.
  // Don't trigger a 30 s+ scan from here — read whatever is already cached and
  // tell the user to go scan if nothing is.
  const recsScanned = (['lambda', 'ecs', 'rds', 'dynamodb'] as const).some(
    (s) => !!peekQuery(`portfolio:recommendations:${s}`),
  );
  const recs: PortfolioRecommendation[] = (['lambda', 'ecs', 'rds', 'dynamodb'] as const).flatMap(
    (s) => peekQuery<{ recommendations: PortfolioRecommendation[] }>(`portfolio:recommendations:${s}`)?.recommendations ?? [],
  );

  const overview = overviewQuery.data ?? null;
  const statuses = budgetsQuery.data?.statuses ?? [];
  // Only block on the overview query — it drives the spend tiles. Budgets and
  // recommendations populate independently.
  const isLoading = overviewQuery.isLoading && !overview;
  const isFetching = overviewQuery.isFetching || budgetsQuery.isFetching;
  const error = overviewQuery.error ?? budgetsQuery.error;
  const refetch = () => {
    overviewQuery.refetch();
    budgetsQuery.refetch();
  };

  const totalSpend = overview?.currentMonth?.total ?? 0;
  const lastSpend = overview?.lastMonth?.total ?? 0;
  const pct = overview?.changePercent ?? 0;
  const potentialSavings = useMemo(() => recs.reduce((s, r) => s + r.estimatedMonthlySavings, 0), [recs]);
  const overBudget = statuses.filter((s) => s.percentUsed >= 100).length;
  const atRisk = statuses.filter((s) => s.percentUsed >= s.alertThreshold && s.percentUsed < 100).length;
  const topServices = (overview?.byService ?? []).slice(0, 5);
  const trend = (overview?.dailyTrend ?? []).map((d) => ({ date: d.date.slice(5), cost: d.cost }));
  const highSeverity = recs.filter((r) => r.severity === 'high').slice(0, 5);

  return (
    <div className="p-6">
      <PageHeader title="Executive Summary" onRefresh={refetch} refreshing={isFetching} />

      {!!error && <div className="mb-4 rounded-xl border border-red-500/20 bg-red-50 dark:bg-red-500/5 p-4 text-sm">{error instanceof Error ? error.message : 'Failed to load'}</div>}

      {isLoading && !overview ? (
        <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-cyan-500" /></div>
      ) : (
        <div className="space-y-6">
          {/* Top KPIs */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-zinc-200/60 dark:border-white/10 bg-white/60 dark:bg-zinc-900/40 backdrop-blur-xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="h-4 w-4 text-cyan-500" />
                <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">This Month</p>
              </div>
              <p className="text-3xl font-bold tabular-nums">{fmtCurrency(totalSpend)}</p>
              <div className="mt-2 flex items-center gap-2"><ChangeChip pct={pct} /><span className="text-xs text-zinc-500">vs prior</span></div>
            </div>
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-500/5 backdrop-blur-xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <Lightbulb className="h-4 w-4 text-emerald-500" />
                <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">Potential Savings</p>
              </div>
              <p className="text-3xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                {recsScanned ? `${fmtCurrency(potentialSavings)}/mo` : '—'}
              </p>
              <p className="mt-2 text-xs text-zinc-500">
                {recsScanned
                  ? `${recs.length} active recommendations`
                  : <Link to="/costs/recommendations" className="text-cyan-600 hover:underline">Run a scan →</Link>}
              </p>
            </div>
            <div className="rounded-2xl border border-amber-500/30 bg-amber-50/30 dark:bg-amber-500/5 backdrop-blur-xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <Wallet className="h-4 w-4 text-amber-500" />
                <p className="text-[11px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-400">Budgets</p>
              </div>
              <p className="text-3xl font-bold tabular-nums text-amber-700 dark:text-amber-400">{statuses.length}</p>
              <p className="mt-2 text-xs">{overBudget} over · {atRisk} at risk</p>
            </div>
            <div className="rounded-2xl border border-zinc-200/60 dark:border-white/10 bg-white/60 dark:bg-zinc-900/40 backdrop-blur-xl p-5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Last Month</p>
              <p className="text-3xl font-bold tabular-nums">{fmtCurrency(lastSpend)}</p>
              <p className="mt-2 text-xs text-zinc-500">{overview?.lastMonth?.period ?? '—'}</p>
            </div>
          </div>

          {/* Spend trend */}
          {trend.length > 0 && (
            <div className="rounded-2xl border border-zinc-200/60 dark:border-white/10 bg-white/60 dark:bg-zinc-900/40 p-6">
              <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-zinc-500">Daily spend trend (current month)</h2>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trend}>
                  <defs>
                    <linearGradient id="execTrend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                  <Tooltip formatter={(v: unknown) => (typeof v === 'number' ? v : 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} />
                  <Area type="monotone" dataKey="cost" stroke="#06b6d4" strokeWidth={2} fill="url(#execTrend)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Top services */}
            <div className="rounded-2xl border border-zinc-200/60 dark:border-white/10 bg-white/60 dark:bg-zinc-900/40 p-6">
              <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-zinc-500">Top spending services</h2>
              {topServices.length === 0 ? <p className="text-sm text-zinc-500">No data.</p> : (
                <ul className="space-y-2">
                  {topServices.map((s) => (
                    <li key={s.service} className="flex items-center justify-between text-sm">
                      <span className="truncate flex-1 mr-2">{s.service}</span>
                      <span className="font-semibold tabular-nums">{fmtCurrency(s.cost)}</span>
                      <span className="ml-3 w-20 text-right"><ChangeChip pct={s.changePercent} /></span>
                    </li>
                  ))}
                </ul>
              )}
              <Link to="/costs" className="mt-3 block text-xs font-semibold text-cyan-600 hover:underline">View all →</Link>
            </div>

            {/* Top recommendations */}
            <div className="rounded-2xl border border-zinc-200/60 dark:border-white/10 bg-white/60 dark:bg-zinc-900/40 p-6">
              <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-zinc-500">High-severity recommendations</h2>
              {!recsScanned ? (
                <p className="text-sm text-zinc-500">
                  No scan run yet. <Link to="/costs/recommendations" className="text-cyan-600 hover:underline font-semibold">Open Recommendations</Link> and click a service to scan it.
                </p>
              ) : highSeverity.length === 0 ? <p className="text-sm text-zinc-500">No high-severity recommendations.</p> : (
                <ul className="space-y-3">
                  {highSeverity.map((r) => (
                    <li key={r.id} className="text-sm">
                      <div className="flex items-start gap-2">
                        <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-semibold bg-red-500/10 text-red-700 dark:text-red-300 ring-1 ring-inset ring-red-500/30">{r.service}</span>
                        <span className="flex-1 truncate">{r.title}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <Link to="/costs/recommendations" className="mt-3 block text-xs font-semibold text-cyan-600 hover:underline">View all →</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
