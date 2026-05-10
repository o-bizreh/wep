import { useState, useEffect, useCallback } from 'react';
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { ExternalLink, X, AlertTriangle, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { PageHeader } from '@wep/ui';
import {
  errorsApi,
  type ErrorsCategory,
  type ErrorsCategoryMeta,
  type ErrorsCategoryResult,
  type ErrorsWindow,
} from '../../lib/api';

const WINDOW_OPTIONS: { value: ErrorsWindow; label: string }[] = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d',  label: 'Last 7 days'   },
];

function formatBucket(bucket: string, window: ErrorsWindow): string {
  // 24h buckets: yyyy-mm-ddTHH → "HH:00"
  // 7d  buckets: yyyy-mm-dd     → "Mon DD"
  if (window === '24h') {
    const hour = bucket.slice(11, 13);
    return `${hour}:00`;
  }
  const d = new Date(`${bucket}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface ChartCardProps {
  meta: ErrorsCategoryMeta;
  state: { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: ErrorsCategoryResult };
  window: ErrorsWindow;
  onClick: () => void;
}

function ChartCard({ meta, state, window, onClick }: ChartCardProps) {
  // While loading, show a skeleton-ish placeholder card with the title visible.
  if (state.status === 'loading') {
    return (
      <div className="relative flex flex-col rounded-3xl border border-slate-200/50 dark:border-white/5 bg-white/40 dark:bg-zinc-900/30 backdrop-blur-2xl shadow-xl shadow-slate-200/20 dark:shadow-black/40 overflow-hidden">
        <div className="px-5 pt-5 pb-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-white tracking-tight truncate">{meta.label}</h3>
              <p className="text-[10px] font-mono text-zinc-400 mt-0.5 uppercase tracking-wide truncate">{meta.metric}</p>
            </div>
            <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border bg-zinc-100 dark:bg-zinc-800 text-zinc-400 border-zinc-200 dark:border-zinc-700 inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading
            </span>
          </div>
          <div className="mt-3 h-9 w-28 bg-zinc-200 dark:bg-zinc-800 rounded-lg animate-pulse" />
        </div>
        <div className="flex-1 min-h-[80px] m-3 mt-2 bg-zinc-100 dark:bg-zinc-800/40 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="relative flex flex-col rounded-3xl border border-rose-300/60 dark:border-rose-500/30 bg-rose-50/40 dark:bg-rose-950/10 px-5 py-5">
        <h3 className="text-sm font-bold text-zinc-900 dark:text-white tracking-tight truncate">{meta.label}</h3>
        <p className="text-[10px] font-mono text-zinc-400 mt-0.5 uppercase tracking-wide truncate">{meta.metric}</p>
        <p className="mt-3 text-xs text-rose-700 dark:text-rose-400 line-clamp-3">Failed: {state.message}</p>
      </div>
    );
  }

  const service = state.data;
  const { totalErrors, chart, label, metric, resources } = service;
  const hasErrors = totalErrors > 0;
  const trouble = resources.length;

  const data = chart.map((p) => ({ ...p, fmt: formatBucket(p.bucket, window) }));

  return (
    <button
      onClick={onClick}
      className={clsx(
        'group relative flex flex-col text-left rounded-3xl border bg-white/60 dark:bg-zinc-900/40 backdrop-blur-2xl shadow-xl shadow-slate-200/20 dark:shadow-black/40 overflow-hidden transition-all hover:shadow-2xl hover:-translate-y-1',
        hasErrors
          ? 'border-rose-300/60 dark:border-rose-500/30 hover:border-rose-400 dark:hover:border-rose-400'
          : 'border-slate-200/50 dark:border-white/5 hover:border-cyan-500/40 dark:hover:border-cyan-500/30',
      )}
    >
      <div className="px-5 pt-5 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-zinc-900 dark:text-white tracking-tight truncate">{label}</h3>
            <p className="text-[10px] font-mono text-zinc-400 mt-0.5 uppercase tracking-wide truncate">{metric}</p>
          </div>
          <span className={clsx(
            'shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border',
            hasErrors
              ? 'bg-rose-500/10 text-rose-600 border-rose-500/30 dark:text-rose-400'
              : 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30 dark:text-emerald-400',
          )}>
            {hasErrors ? `${trouble} affected` : 'Healthy'}
          </span>
        </div>
        <div className="flex items-baseline gap-2 mt-3">
          <span className="text-3xl font-black text-zinc-900 dark:text-white tracking-tighter">
            {totalErrors.toLocaleString()}
          </span>
          <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">errors</span>
        </div>
      </div>
      <div className="flex-1 min-h-[80px] -mb-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`grad-${service.category}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"  stopColor={hasErrors ? '#f43f5e' : '#10b981'} stopOpacity={0.3} />
                <stop offset="100%" stopColor={hasErrors ? '#f43f5e' : '#10b981'} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="fmt" hide />
            <YAxis hide />
            <Tooltip
              contentStyle={{ backgroundColor: '#18181b', border: 'none', borderRadius: '10px', fontSize: '11px', color: '#fff', padding: '6px 10px' }}
              itemStyle={{ color: hasErrors ? '#fb7185' : '#34d399' }}
              labelStyle={{ color: '#71717a', fontSize: '10px' }}
              formatter={(value) => [Number(value ?? 0).toLocaleString(), 'Errors']}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={hasErrors ? '#f43f5e' : '#10b981'}
              strokeWidth={2}
              fillOpacity={1}
              fill={`url(#grad-${service.category})`}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </button>
  );
}

interface DrawerProps {
  service: ErrorsCategoryResult | null;
  onClose: () => void;
  windowSel: ErrorsWindow;
}

function ResourceDrawer({ service, onClose, windowSel }: DrawerProps) {
  // Esc-to-close
  useEffect(() => {
    if (!service) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service]);

  if (!service) return null;

  const windowLabel = WINDOW_OPTIONS.find((o) => o.value === windowSel)?.label ?? windowSel;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-zinc-900/30 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
      />
      {/* Panel */}
      <aside className="fixed top-0 right-0 z-50 h-screen w-full md:w-1/2 bg-white dark:bg-zinc-950 border-l border-slate-200 dark:border-white/10 shadow-2xl shadow-black/20 animate-in slide-in-from-right duration-300 flex flex-col">
        <div className="flex items-start justify-between px-6 py-5 border-b border-slate-200 dark:border-white/5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0" />
              <h2 className="text-lg font-bold text-zinc-900 dark:text-white tracking-tight truncate">{service.label}</h2>
            </div>
            <p className="text-xs text-zinc-500 mt-1 font-mono">{service.metric}</p>
            <p className="text-[10px] text-zinc-400 mt-2 uppercase tracking-wider font-bold">
              {windowLabel} · {service.totalErrors.toLocaleString()} total · {service.resources.length} resources affected
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-400 hover:text-zinc-700 dark:hover:text-white transition-colors"
            title="Close (Esc)"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {service.resources.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-400 px-6">
              <p className="text-base font-medium">No resources had errors in this window.</p>
              <p className="text-xs mt-1">Try the 7-day window or check back later.</p>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-slate-200 dark:divide-white/5">
              <thead className="bg-slate-50 dark:bg-zinc-900 sticky top-0">
                <tr className="text-left text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                  <th className="px-6 py-3">Resource</th>
                  <th className="px-6 py-3 text-right">Errors</th>
                  <th className="px-6 py-3 text-right">AWS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {service.resources.map((r) => (
                  <tr key={r.name} className="hover:bg-slate-50 dark:hover:bg-white/5">
                    <td className="px-6 py-3 text-sm font-mono text-zinc-800 dark:text-zinc-200 break-all">{r.name}</td>
                    <td className="px-6 py-3 text-right">
                      <span className="inline-flex items-center rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400 px-2 py-0.5 text-xs font-bold">
                        {r.errors.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-right">
                      <a
                        href={r.consoleUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-600 dark:text-cyan-400 hover:text-cyan-700"
                        title="Open in AWS console"
                      >
                        Console <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </aside>
    </>
  );
}

type CardState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ErrorsCategoryResult };

export function ErrorsPage() {
  const [categories, setCategories] = useState<ErrorsCategoryMeta[] | null>(null);
  const [windowSel, setWindow] = useState<ErrorsWindow>('24h');
  const [byCategory, setByCategory] = useState<Record<string, CardState>>({});
  const [drawer, setDrawer] = useState<ErrorsCategoryResult | null>(null);

  const anyLoading = Object.values(byCategory).some((s) => s.status === 'loading');

  const loadAll = useCallback((cats: ErrorsCategoryMeta[], w: ErrorsWindow) => {
    // Reset all to loading immediately so the user sees activity.
    const initial: Record<string, CardState> = {};
    for (const c of cats) initial[c.category] = { status: 'loading' };
    setByCategory(initial);

    // Fan out per-category requests; each card replaces its own state when its
    // request lands. Independent failures don't block other cards.
    for (const c of cats) {
      errorsApi.getCategory(c.category, w)
        .then((res) => {
          setByCategory((prev) => ({ ...prev, [c.category]: { status: 'ready', data: res } }));
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          setByCategory((prev) => ({ ...prev, [c.category]: { status: 'error', message } }));
        });
    }
  }, []);

  // Bootstrap the category list once
  useEffect(() => {
    errorsApi.getCategories()
      .then((res) => {
        setCategories(res.categories);
      })
      .catch((err) => { console.error('Errors bootstrap failed:', err); });
  }, []);

  // Whenever categories or window changes, fan out
  useEffect(() => {
    if (categories) loadAll(categories, windowSel);
  }, [categories, windowSel, loadAll]);

  const refresh = useCallback(() => {
    if (categories) loadAll(categories, windowSel);
  }, [categories, windowSel, loadAll]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Errors"
        onRefresh={refresh}
        refreshing={anyLoading}
        actions={
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-zinc-900/40 backdrop-blur p-1">
            {WINDOW_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setWindow(opt.value)}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
                  windowSel === opt.value
                    ? 'bg-cyan-500 text-white shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        }
      />

      <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-3xl">
        Production-tagged failure metrics aggregated across the account. Each tile loads independently — click any card to see which resources had errors.
      </p>

      {!categories ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-60 rounded-3xl bg-zinc-100 dark:bg-zinc-800/40 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {categories.map((meta) => {
            const state = byCategory[meta.category] ?? { status: 'loading' as const };
            return (
              <ChartCard
                key={meta.category}
                meta={meta}
                state={state}
                window={windowSel}
                onClick={() => {
                  if (state.status === 'ready') setDrawer(state.data);
                }}
              />
            );
          })}
        </div>
      )}

      <ResourceDrawer
        service={drawer}
        onClose={() => setDrawer(null)}
        windowSel={windowSel}
      />
    </div>
  );
}
