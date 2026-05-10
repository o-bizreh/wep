import { useMemo, useState } from 'react';
import { PageHeader } from '@wep/ui';
import { Loader2, AlertCircle, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Link } from 'react-router-dom';
import { portfolioApi } from '../../lib/api';
import { useCachedQuery } from '../../lib/query-cache';

function fmtCurrency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

function pctChip(pct: number): JSX.Element {
  if (Math.abs(pct) < 0.5) return <span className="inline-flex items-center gap-0.5 text-xs font-bold text-zinc-400"><Minus className="h-3 w-3" />0%</span>;
  if (pct > 0) return <span className="inline-flex items-center gap-0.5 text-xs font-bold text-red-600 dark:text-red-400"><TrendingUp className="h-3 w-3" />+{pct.toFixed(1)}%</span>;
  return <span className="inline-flex items-center gap-0.5 text-xs font-bold text-emerald-600 dark:text-emerald-400"><TrendingDown className="h-3 w-3" />{pct.toFixed(1)}%</span>;
}

export function CostComparisonPage() {
  // Backend caches Cost Explorer for 30 min; we mirror with 20 min on the
  // client so revisits feel instant.
  const { data, isLoading, isFetching, error, refetch } = useCachedQuery(
    'portfolio:cost-comparison',
    () => portfolioApi.getCostComparison(),
    { staleTimeMs: 20 * 60_000 },
  );

  const [direction, setDirection] = useState<'all' | 'increased' | 'decreased'>('all');

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data.byService;
    if (direction === 'increased') list = list.filter((s) => s.change > 0);
    if (direction === 'decreased') list = list.filter((s) => s.change < 0);
    return list;
  }, [data, direction]);

  const chartData = filtered.slice(0, 15).map((s) => ({
    service: s.service.length > 22 ? s.service.slice(0, 22) + '…' : s.service,
    change: Math.round(s.change * 100) / 100,
  }));

  return (
    <div className="p-6">
      <PageHeader title="Cost Comparison" onRefresh={refetch} refreshing={isFetching} />
      {data && (
        <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
          Comparing <span className="font-semibold text-zinc-700 dark:text-zinc-300">{data.comparisonNote ?? `first ${data.daysElapsed} days`}</span> of{' '}
          <span className="font-semibold text-zinc-700 dark:text-zinc-300">{data.currentMonth}</span> vs the same period in{' '}
          <span className="font-semibold text-zinc-700 dark:text-zinc-300">{data.previousMonth}</span>
        </p>
      )}

      {data?.noCredentials && (
        <div className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-50/30 dark:bg-amber-500/5 p-6 text-center">
          <p className="text-sm">AWS credentials not configured. Add them in <Link to="/settings" className="text-cyan-600 font-semibold">Settings</Link>.</p>
        </div>
      )}

      {!!error && (
        <div className="mb-4 rounded-xl border border-red-500/20 bg-red-50 dark:bg-red-500/5 p-4">
          <AlertCircle className="inline h-4 w-4 text-red-500 mr-2" />
          <span className="text-sm text-red-600 dark:text-red-400">{error instanceof Error ? error.message : 'Failed to load'}</span>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-cyan-500" /></div>
      ) : data && !data.noCredentials ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-2xl border border-zinc-200/60 dark:border-white/10 bg-white/60 dark:bg-zinc-900/40 p-4">
              <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">{data.currentMonth}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{fmtCurrency(data.totalCurrent)}</p>
            </div>
            <div className="rounded-2xl border border-zinc-200/60 dark:border-white/10 bg-white/60 dark:bg-zinc-900/40 p-4">
              <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">{data.previousMonth}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{fmtCurrency(data.totalPrevious)}</p>
            </div>
            <div className="rounded-2xl border border-zinc-200/60 dark:border-white/10 bg-white/60 dark:bg-zinc-900/40 p-4">
              <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Change</p>
              <p className={`mt-1 text-2xl font-bold tabular-nums ${data.totalChange > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{data.totalChange > 0 ? '+' : ''}{fmtCurrency(data.totalChange)}</p>
            </div>
            <div className="rounded-2xl border border-zinc-200/60 dark:border-white/10 bg-white/60 dark:bg-zinc-900/40 p-4">
              <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">% Change</p>
              <div className="mt-1">{pctChip(data.totalChangePercentage)}</div>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200/60 dark:border-white/10 bg-white/60 dark:bg-zinc-900/40 p-6">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-zinc-500">Top 15 services by absolute change</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 80 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="service" type="category" tick={{ fontSize: 11 }} width={150} />
                <Tooltip formatter={(v: unknown) => fmtCurrency(typeof v === 'number' ? v : 0)} />
                <ReferenceLine x={0} stroke="#666" />
                <Bar dataKey="change" fill="#06b6d4" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="flex items-center gap-3">
            {(['all', 'increased', 'decreased'] as const).map((d) => (
              <button key={d} onClick={() => setDirection(d)}
                className={`rounded-lg px-3 py-1 text-xs font-semibold ${direction === d ? 'bg-cyan-500 text-white' : 'bg-zinc-100 dark:bg-zinc-800'}`}>
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>

          <div className="rounded-2xl border border-zinc-200/60 dark:border-white/10 bg-white/60 dark:bg-zinc-900/40 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-900/50 text-xs uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="text-left px-4 py-3">Service</th>
                  <th className="text-right px-4 py-3">{data.previousMonth}</th>
                  <th className="text-right px-4 py-3">{data.currentMonth}</th>
                  <th className="text-right px-4 py-3">Change</th>
                  <th className="text-right px-4 py-3">%</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.service} className="border-t border-zinc-200/40 dark:border-white/5">
                    <td className="px-4 py-2 font-medium truncate max-w-xs">{s.service}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(s.previousMonthCost)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(s.currentMonthCost)}</td>
                    <td className={`px-4 py-2 text-right tabular-nums font-semibold ${s.change > 0 ? 'text-red-600' : s.change < 0 ? 'text-emerald-600' : ''}`}>
                      {s.change > 0 ? '+' : ''}{fmtCurrency(s.change)}
                    </td>
                    <td className="px-4 py-2 text-right">{pctChip(s.changePercentage)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
