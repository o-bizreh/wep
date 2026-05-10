import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, ReferenceArea, AreaChart, Area } from 'recharts';
import { Loader2, Flame, RotateCcw, Moon, AlertTriangle, TrendingUp, TrendingDown, Minus, X, ExternalLink } from 'lucide-react';
import { clsx } from 'clsx';
import { PageHeader } from '@wep/ui';
import {
  qualityApi,
  type QualityReposResponse,
  type QualityRepoResponse,
  type QualityWeekBucket,
  type QualityRepoListing,
  type QualityRevertCommitArtifact,
  type QualityHotfixDeployArtifact,
  type QualityFailedDeployArtifact,
  type QualityRedeployArtifact,
} from '../../lib/api';

const WEEK_OPTIONS: { value: number; label: string }[] = [
  { value: 4,  label: '4 weeks'  },
  { value: 8,  label: '8 weeks'  },
  { value: 12, label: '12 weeks' },
];

const ROW_FETCH_CONCURRENCY = 4;

type RepoState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: QualityRepoResponse };

interface AggregatedWeek {
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
  // Derived
  hotfixRate: number | null;       // hotfixDeploys / totalDeploys * 100
  failureRate: number | null;      // failedDeploys / completedDeploys * 100
}

function emptyAggregated(template: QualityWeekBucket): AggregatedWeek {
  return {
    weekStart: template.weekStart,
    weekEnd: template.weekEnd,
    prodDeploys: 0, totalDeploys: 0, succeededDeploys: 0, completedDeploys: 0,
    failedDeploys: 0, hotfixDeploys: 0, sameDayRedeploys: 0, revertCommits: 0,
    hotfixRate: null, failureRate: null,
  };
}

function formatWeekLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function aggregate(states: Map<string, RepoState>, template: QualityWeekBucket[] | null): AggregatedWeek[] {
  if (!template || template.length === 0) return [];
  const out = template.map(emptyAggregated);
  for (const state of states.values()) {
    if (state.status !== 'ready') continue;
    const weeks = state.data.weeks;
    for (let i = 0; i < weeks.length && i < out.length; i++) {
      const src = weeks[i]!;
      const dst = out[i]!;
      dst.prodDeploys      += src.prodDeploys;
      dst.totalDeploys     += src.totalDeploys;
      dst.succeededDeploys += src.succeededDeploys;
      dst.completedDeploys += src.completedDeploys;
      dst.failedDeploys    += src.failedDeploys;
      dst.hotfixDeploys    += src.hotfixDeploys;
      dst.sameDayRedeploys += src.sameDayRedeploys;
      dst.revertCommits    += src.revertCommits;
    }
  }
  // Derive rates
  for (const w of out) {
    w.hotfixRate = w.totalDeploys > 0
      ? Math.round((w.hotfixDeploys / w.totalDeploys) * 1000) / 10
      : null;
    w.failureRate = w.completedDeploys > 0
      ? Math.round((w.failedDeploys / w.completedDeploys) * 1000) / 10
      : null;
  }
  return out;
}

// ── Metric definitions for the per-repo drawer ───────────────────────────────

type MetricKey = 'hotfix' | 'redeploy' | 'failure' | 'revert';

interface MetricSpec {
  key: MetricKey;
  title: string;
  subtitle: string;
  isRate: boolean;
  rateUnit?: string;
  /** Numerator picker (raw count per week, even for rate metrics) */
  count: (w: QualityWeekBucket) => number;
  /** Denominator picker (rate metrics only) */
  denom?: (w: QualityWeekBucket) => number;
}

const METRICS: Record<MetricKey, MetricSpec> = {
  hotfix:   { key: 'hotfix',   title: 'Hotfix rate',          subtitle: 'Hotfix deploys / total deploys',                isRate: true,  rateUnit: '%', count: (w) => w.hotfixDeploys, denom: (w) => w.totalDeploys },
  redeploy: { key: 'redeploy', title: 'Same-day re-deploy',   subtitle: 'Prod deploys < 4h apart on the same repo',      isRate: false, count: (w) => w.sameDayRedeploys },
  failure:  { key: 'failure',  title: 'Deploy failure rate',  subtitle: 'Failed runs / completed runs',                  isRate: true,  rateUnit: '%', count: (w) => w.failedDeploys, denom: (w) => w.completedDeploys },
  revert:   { key: 'revert',   title: 'Revert commits',       subtitle: 'Commits whose message starts with "Revert"',    isRate: false, count: (w) => w.revertCommits },
};

function deltaTrend(weeks: AggregatedWeek[], pick: (w: AggregatedWeek) => number | null): { last: number | null; prev: number | null; deltaPct: number | null } {
  if (weeks.length < 2) return { last: null, prev: null, deltaPct: null };
  const last = pick(weeks[weeks.length - 1]!);
  const prev = pick(weeks[weeks.length - 2]!);
  if (last === null || prev === null) return { last, prev, deltaPct: null };
  if (prev === 0 && last === 0) return { last, prev, deltaPct: 0 };
  if (prev === 0) return { last, prev, deltaPct: null };
  return { last, prev, deltaPct: Math.round(((last - prev) / prev) * 1000) / 10 };
}

interface DrawerSelection {
  metric: MetricKey;
  /** Initial week index to focus on; -1 means "all weeks". */
  initialWeekIdx: number;
}

export function QualityTrendPage() {
  const [weeks, setWeeks] = useState<number>(12);
  const [list, setList] = useState<QualityReposResponse | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [repoStates, setRepoStates] = useState<Map<string, RepoState>>(new Map());
  const [drawer, setDrawer] = useState<DrawerSelection | null>(null);
  const cancelRef = useRef<{ cancelled: boolean } | null>(null);

  const fetchAll = useCallback(async () => {
    if (cancelRef.current) cancelRef.current.cancelled = true;
    const ctrl = { cancelled: false };
    cancelRef.current = ctrl;

    setListLoading(true);
    setListError(null);
    setList(null);
    setRepoStates(new Map());

    let listing: QualityReposResponse;
    try {
      listing = await qualityApi.repos(weeks);
    } catch (err) {
      if (!ctrl.cancelled) {
        setListError(err instanceof Error ? err.message : String(err));
        setListLoading(false);
      }
      return;
    }
    if (ctrl.cancelled) return;
    setList(listing);
    setListLoading(false);

    const initial = new Map<string, RepoState>();
    for (const r of listing.repos) initial.set(r.fullName, { status: 'loading' });
    setRepoStates(initial);

    const queue = [...listing.repos];
    const workers = Array.from({ length: Math.min(ROW_FETCH_CONCURRENCY, queue.length) }, async () => {
      while (!ctrl.cancelled) {
        const r = queue.shift();
        if (!r) return;
        try {
          const data = await qualityApi.repo(r.owner, r.repo, weeks);
          if (ctrl.cancelled) return;
          setRepoStates((prev) => {
            const next = new Map(prev);
            next.set(r.fullName, { status: 'ready', data });
            return next;
          });
        } catch (err) {
          if (ctrl.cancelled) return;
          const message = err instanceof Error ? err.message : String(err);
          setRepoStates((prev) => {
            const next = new Map(prev);
            next.set(r.fullName, { status: 'error', message });
            return next;
          });
        }
      }
    });
    await Promise.all(workers);
  }, [weeks]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  // Use the first ready repo's weeks as the bucket template (all repos share boundaries)
  const template = useMemo(() => {
    for (const s of repoStates.values()) {
      if (s.status === 'ready' && s.data.weeks.length > 0) return s.data.weeks;
    }
    return null;
  }, [repoStates]);

  const aggregated = useMemo(() => aggregate(repoStates, template), [repoStates, template]);

  const counts = useMemo(() => {
    const total = list?.repos.length ?? 0;
    let ready = 0;
    let errored = 0;
    for (const s of repoStates.values()) {
      if (s.status === 'ready') ready++;
      if (s.status === 'error') errored++;
    }
    return { total, ready, errored, loading: total - ready - errored };
  }, [list, repoStates]);

  const fanoutBusy = !!list && counts.loading > 0;
  const refresh = useCallback(() => { void fetchAll(); }, [fetchAll]);

  const hotfixTrend     = deltaTrend(aggregated, (w) => w.hotfixRate);
  const failureTrend    = deltaTrend(aggregated, (w) => w.failureRate);
  const redeployTrend   = deltaTrend(aggregated, (w) => w.sameDayRedeploys);
  const revertsTrend    = deltaTrend(aggregated, (w) => w.revertCommits);

  return (
    <div className="space-y-6">
      <PageHeader title="Quality Trend" onRefresh={refresh} refreshing={listLoading || fanoutBusy} />

      <div className="rounded-2xl border border-slate-200/60 bg-white/40 px-5 py-4 text-sm text-zinc-600 backdrop-blur dark:border-white/10 dark:bg-zinc-900/30 dark:text-zinc-300">
        <p className="font-semibold text-zinc-900 dark:text-white">What this page shows</p>
        <p className="mt-1 leading-relaxed">
          Leading indicators of <strong>system quality over time</strong> — derived from GitHub Actions runs and commit history across every non-archived repo.
          If hotfix rate or same-day re-deploys spike for 2–3 weeks running, the team is in firefighting mode and should pull a feature off the next sprint to stabilise.
          None of these metrics judge individuals.
        </p>
      </div>

      {/* Window selector */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-1 rounded-xl border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-zinc-900/40 backdrop-blur p-1">
          {WEEK_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setWeeks(opt.value)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
                weeks === opt.value
                  ? 'bg-cyan-500 text-white shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {list && (
          <span className="text-xs text-zinc-500 ml-auto">
            {new Date(list.windowStart).toLocaleDateString()} → {new Date(list.windowEnd).toLocaleDateString()}
            <span className="text-zinc-400"> · {counts.total} repos</span>
            {fanoutBusy && (
              <span className="ml-2 inline-flex items-center gap-1 text-zinc-400">
                <Loader2 className="h-3 w-3 animate-spin" /> {counts.ready}/{counts.total}
              </span>
            )}
          </span>
        )}
      </div>

      {listError && (
        <div className="rounded-2xl border border-rose-300 bg-rose-50 dark:bg-rose-950/20 dark:border-rose-500/30 p-6 text-rose-700 dark:text-rose-400 text-sm">
          {listError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <TrendChart
          title={METRICS.hotfix.title} subtitle={METRICS.hotfix.subtitle}
          icon={<Flame className="h-4 w-4 text-rose-500" />}
          data={aggregated} dataKey="hotfixRate" unit="%"
          color="#f43f5e" goodDirection="down" delta={hotfixTrend}
          loadingMore={fanoutBusy}
          fallbackKey="hotfixDeploys" fallbackUnit=""
          onOpenBreakdown={(idx) => setDrawer({ metric: 'hotfix', initialWeekIdx: idx ?? aggregated.length - 1 })}
        />
        <TrendChart
          title={METRICS.redeploy.title} subtitle={METRICS.redeploy.subtitle}
          icon={<RotateCcw className="h-4 w-4 text-amber-500" />}
          data={aggregated} dataKey="sameDayRedeploys" unit=""
          color="#f59e0b" goodDirection="down" delta={redeployTrend}
          loadingMore={fanoutBusy}
          onOpenBreakdown={(idx) => setDrawer({ metric: 'redeploy', initialWeekIdx: idx ?? aggregated.length - 1 })}
        />
        <TrendChart
          title={METRICS.failure.title} subtitle={METRICS.failure.subtitle}
          icon={<AlertTriangle className="h-4 w-4 text-red-500" />}
          data={aggregated} dataKey="failureRate" unit="%"
          color="#ef4444" goodDirection="down" delta={failureTrend}
          loadingMore={fanoutBusy}
          fallbackKey="failedDeploys" fallbackUnit=""
          onOpenBreakdown={(idx) => setDrawer({ metric: 'failure', initialWeekIdx: idx ?? aggregated.length - 1 })}
        />
        <TrendChart
          title={METRICS.revert.title} subtitle={METRICS.revert.subtitle}
          icon={<Moon className="h-4 w-4 text-zinc-500" />}
          data={aggregated} dataKey="revertCommits" unit=""
          color="#71717a" goodDirection="down" delta={revertsTrend}
          loadingMore={fanoutBusy}
          onOpenBreakdown={(idx) => setDrawer({ metric: 'revert', initialWeekIdx: idx ?? aggregated.length - 1 })}
        />
      </div>

      <RepoBreakdownDrawer
        selection={drawer}
        onClose={() => setDrawer(null)}
        list={list}
        repoStates={repoStates}
        loadingMore={fanoutBusy}
      />

      {list && (
        <p className="text-[10px] text-zinc-400 text-right">
          List generated {new Date(list.generatedAt).toLocaleString()} · per-repo data cached 30 min server-side.
          {list.excludedQuiet > 0 && ` · ${list.excludedQuiet} repos skipped (quiet)`}
        </p>
      )}
    </div>
  );
}

interface TrendChartProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  data: AggregatedWeek[];
  dataKey: keyof AggregatedWeek;
  unit: string;
  color: string;
  goodDirection: 'up' | 'down';
  delta: { last: number | null; prev: number | null; deltaPct: number | null };
  loadingMore: boolean;
  /** Fallback raw count to show alongside a rate (e.g. hotfix count under hotfix rate). */
  fallbackKey?: keyof AggregatedWeek;
  fallbackUnit?: string;
  /** Called when the user clicks the card or a chart point. weekIdx is the
   *  bucket they clicked; undefined means a generic card click → default to
   *  the latest week. */
  onOpenBreakdown: (weekIdx?: number) => void;
}

function TrendChart({ title, subtitle, icon, data, dataKey, unit, color, goodDirection, delta, loadingMore, fallbackKey, fallbackUnit, onOpenBreakdown }: TrendChartProps) {
  let deltaTone: 'good' | 'bad' | 'neutral' = 'neutral';
  if (delta.deltaPct !== null && delta.deltaPct !== 0) {
    const isUp = delta.deltaPct > 0;
    deltaTone = (goodDirection === 'up' && isUp) || (goodDirection === 'down' && !isUp) ? 'good' : 'bad';
  }
  const deltaClass = deltaTone === 'good' ? 'text-emerald-600 dark:text-emerald-400'
    : deltaTone === 'bad' ? 'text-rose-600 dark:text-rose-400'
      : 'text-zinc-400';
  const DeltaIcon = delta.deltaPct === null ? Minus : delta.deltaPct > 0 ? TrendingUp : delta.deltaPct < 0 ? TrendingDown : Minus;

  const lastValue = delta.last;
  // Highlight the last bucket as "this week so far" if it's narrower than full
  const lastWeekIdx = data.length - 1;

  const handleChartClick = (e: { activeLabel?: string | number }) => {
    const lbl = e?.activeLabel;
    if (lbl === undefined || lbl === null) {
      onOpenBreakdown();
      return;
    }
    const idx = data.findIndex((d) => d.weekStart === String(lbl));
    onOpenBreakdown(idx >= 0 ? idx : undefined);
  };

  return (
    <button
      onClick={() => onOpenBreakdown()}
      className="text-left w-full rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur shadow-xl shadow-slate-200/20 dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40 p-5 hover:border-cyan-500/40 dark:hover:border-cyan-500/30 hover:shadow-2xl hover:-translate-y-0.5 transition-all"
      title="Click to see which repos contributed"
    >
      <div className="flex items-start justify-between mb-1">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-bold text-zinc-900 dark:text-white tracking-tight">{title}</h3>
        </div>
        <div className="flex items-center gap-2">
          {loadingMore && <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />}
          <span className="text-[10px] text-zinc-400 group-hover:text-cyan-500">View by repo →</span>
        </div>
      </div>
      <p className="text-[10px] text-zinc-400 mb-3">{subtitle}</p>

      <div className="flex items-baseline gap-3 mb-2">
        <span className="text-3xl font-black text-zinc-900 dark:text-white tracking-tighter">
          {lastValue === null ? '—' : `${lastValue}${unit}`}
        </span>
        {delta.deltaPct !== null && (
          <span className={clsx('inline-flex items-center gap-0.5 text-xs font-bold', deltaClass)}>
            <DeltaIcon className="h-3 w-3" />
            {delta.deltaPct > 0 ? '+' : ''}{delta.deltaPct}% vs last week
          </span>
        )}
      </div>

      <div
        className="h-32 -mx-1"
        onClick={(e) => e.stopPropagation()}  // prevent the chart click from also bubbling to the card
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            onClick={handleChartClick}
          >
            <XAxis dataKey="weekStart" hide />
            <YAxis hide domain={[0, 'dataMax + 1']} />
            <Tooltip
              contentStyle={{ backgroundColor: '#18181b', border: 'none', borderRadius: '10px', fontSize: '11px', color: '#fff', padding: '6px 10px' }}
              itemStyle={{ color }}
              labelStyle={{ color: '#71717a', fontSize: '10px' }}
              labelFormatter={(label) => `Week of ${formatWeekLabel(String(label ?? ''))} · click to see repos`}
              formatter={(value, _name, item) => {
                const v = Number(value ?? 0);
                const payload = (item as { payload?: AggregatedWeek } | undefined)?.payload;
                const fallback = fallbackKey && payload ? payload[fallbackKey] : null;
                const main = `${v}${unit}`;
                if (fallback !== null && fallback !== undefined && fallbackKey) {
                  return [`${main} (${fallback}${fallbackUnit ?? ''})`, title];
                }
                return [main, title];
              }}
            />
            {data.length > 0 && (
              <ReferenceArea
                x1={data[lastWeekIdx]!.weekStart}
                x2={data[lastWeekIdx]!.weekEnd}
                strokeOpacity={0}
                fill={color}
                fillOpacity={0.05}
              />
            )}
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={{ r: 3, fill: color }} activeDot={{ r: 5 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </button>
  );
}

// ── Per-repo breakdown drawer ───────────────────────────────────────────────

interface RepoBreakdownDrawerProps {
  selection: DrawerSelection | null;
  onClose: () => void;
  list: QualityReposResponse | null;
  repoStates: Map<string, RepoState>;
  loadingMore: boolean;
}

function RepoBreakdownDrawer({ selection, onClose, list, repoStates, loadingMore }: RepoBreakdownDrawerProps) {
  const [weekIdx, setWeekIdx] = useState<number>(-1);  // -1 means "all weeks"

  // When the drawer opens, pin to the week the user clicked
  useEffect(() => {
    if (!selection) return;
    setWeekIdx(selection.initialWeekIdx);
  }, [selection]);

  // Esc to close
  useEffect(() => {
    if (!selection) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selection, onClose]);

  if (!selection || !list) return null;

  const spec = METRICS[selection.metric];
  const listingByRepo = new Map<string, QualityRepoListing>();
  for (const r of list.repos) listingByRepo.set(r.fullName, r);

  // Build a per-repo summary using the readiest weeks template available.
  type Row = {
    listing: QualityRepoListing;
    weeks: QualityWeekBucket[];
    selectedCount: number;
    selectedDenom: number;
    totalCount: number;
    totalDenom: number;
  };

  const rows: Row[] = [];
  let weekTemplate: QualityWeekBucket[] = [];
  for (const [fullName, state] of repoStates.entries()) {
    if (state.status !== 'ready') continue;
    const data = state.data;
    if (weekTemplate.length === 0 && data.weeks.length > 0) weekTemplate = data.weeks;
    const listing = listingByRepo.get(fullName);
    if (!listing) continue;
    let totalCount = 0;
    let totalDenom = 0;
    for (const w of data.weeks) {
      totalCount += spec.count(w);
      if (spec.denom) totalDenom += spec.denom(w);
    }
    let selectedCount = 0;
    let selectedDenom = 0;
    if (weekIdx >= 0 && weekIdx < data.weeks.length) {
      const w = data.weeks[weekIdx]!;
      selectedCount = spec.count(w);
      if (spec.denom) selectedDenom = spec.denom(w);
    } else {
      selectedCount = totalCount;
      selectedDenom = totalDenom;
    }
    rows.push({ listing, weeks: data.weeks, selectedCount, selectedDenom, totalCount, totalDenom });
  }

  // Only repos that contributed something to the selected slice
  const filtered = rows.filter((r) => r.selectedCount > 0);
  filtered.sort((a, b) => b.selectedCount - a.selectedCount);

  const totalSelected = filtered.reduce((s, r) => s + r.selectedCount, 0);
  const totalSelectedDenom = filtered.reduce((s, r) => s + r.selectedDenom, 0);

  const focusLabel = weekIdx === -1
    ? `All ${weekTemplate.length} weeks`
    : weekTemplate[weekIdx]
      ? `Week of ${formatWeekLabel(weekTemplate[weekIdx]!.weekStart)}${weekIdx === weekTemplate.length - 1 ? ' (this week so far)' : ''}`
      : '—';

  return (
    <>
      <div className="fixed inset-0 z-40 bg-zinc-900/30 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose} />
      <aside className="fixed top-0 right-0 z-50 h-screen w-full md:w-2/3 lg:w-3/5 bg-white dark:bg-zinc-950 border-l border-slate-200 dark:border-white/10 shadow-2xl shadow-black/20 animate-in slide-in-from-right duration-300 flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-slate-200 dark:border-white/5">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-zinc-900 dark:text-white tracking-tight">{spec.title} · which repos</h2>
            <p className="text-xs text-zinc-500 mt-0.5">{spec.subtitle}</p>
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <select
                value={weekIdx}
                onChange={(e) => setWeekIdx(Number(e.target.value))}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-zinc-900 dark:text-white"
              >
                <option value={-1}>All weeks</option>
                {weekTemplate.map((w, i) => (
                  <option key={w.weekStart} value={i}>
                    Week of {formatWeekLabel(w.weekStart)}{i === weekTemplate.length - 1 ? ' (this week)' : ''}
                  </option>
                ))}
              </select>
              <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">{focusLabel}</span>
              <span className="text-xs text-zinc-700 dark:text-zinc-300">
                <span className="font-bold">{totalSelected}</span> {spec.isRate ? `of ${totalSelectedDenom}` : ''} · {filtered.length} repo{filtered.length === 1 ? '' : 's'}
              </span>
              {loadingMore && <span className="text-[10px] text-zinc-400 inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> still aggregating</span>}
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-400 hover:text-zinc-700 dark:hover:text-white transition-colors" title="Close (Esc)">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-12 text-center text-sm text-zinc-400">
              No repos contributed to this metric in {focusLabel.toLowerCase()}.
            </div>
          ) : (
            <>
              {/* Per-repo summary */}
              <div className="px-6 pt-5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-2">By repo</p>
              </div>
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 dark:bg-zinc-900 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                  <tr>
                    <th className="px-6 py-3 text-left">Repo</th>
                    <th className="px-4 py-3 text-right">{focusLabel.startsWith('All') ? 'Total' : 'In window'}</th>
                    <th className="px-4 py-3 text-right">All weeks</th>
                    <th className="px-4 py-3 text-left">Per-week trend</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {filtered.map((row) => (
                    <RepoBreakdownRow key={row.listing.fullName} row={row} spec={spec} />
                  ))}
                </tbody>
              </table>

              {/* Flat artifact list — the actual events */}
              <ArtifactList
                metric={selection.metric}
                repoStates={repoStates}
                weekIdx={weekIdx}
                weekTemplate={weekTemplate}
              />
            </>
          )}
        </div>
      </aside>
    </>
  );
}

interface ArtifactListProps {
  metric: MetricKey;
  repoStates: Map<string, RepoState>;
  weekIdx: number;
  weekTemplate: QualityWeekBucket[];
}

function ArtifactList({ metric, repoStates, weekIdx, weekTemplate }: ArtifactListProps) {
  // Derive the (start, end) for the selected slice.
  let sliceStart: number | null = null;
  let sliceEnd: number | null = null;
  if (weekIdx >= 0 && weekIdx < weekTemplate.length) {
    sliceStart = new Date(weekTemplate[weekIdx]!.weekStart).getTime();
    sliceEnd = new Date(weekTemplate[weekIdx]!.weekEnd).getTime();
  }
  const inSlice = (iso: string): boolean => {
    if (sliceStart === null || sliceEnd === null) return true;
    const t = new Date(iso).getTime();
    return t >= sliceStart && t < sliceEnd;
  };

  // Collect artifacts across all ready repos that fall in the slice.
  const reverts: Array<QualityRevertCommitArtifact & { repo: string }> = [];
  const hotfixes: Array<QualityHotfixDeployArtifact & { repo: string }> = [];
  const failures: Array<QualityFailedDeployArtifact & { repo: string }> = [];
  const redeploys: Array<QualityRedeployArtifact & { repo: string }> = [];

  for (const state of repoStates.values()) {
    if (state.status !== 'ready') continue;
    const repo = state.data.repo;
    const arts = state.data.artifacts;
    if (metric === 'revert') {
      for (const a of arts.revertCommits) if (inSlice(a.date)) reverts.push({ ...a, repo });
    } else if (metric === 'hotfix') {
      for (const a of arts.hotfixDeploys) if (inSlice(a.startedAt)) hotfixes.push({ ...a, repo });
    } else if (metric === 'failure') {
      for (const a of arts.failedDeploys) if (inSlice(a.startedAt)) failures.push({ ...a, repo });
    } else if (metric === 'redeploy') {
      for (const a of arts.sameDayRedeploys) if (inSlice(a.startedAt)) redeploys.push({ ...a, repo });
    }
  }

  // Newest first
  reverts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  hotfixes.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  failures.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  redeploys.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  const total =
    metric === 'revert'   ? reverts.length :
    metric === 'hotfix'   ? hotfixes.length :
    metric === 'failure'  ? failures.length :
                            redeploys.length;

  if (total === 0) return null;

  return (
    <div className="mt-2 border-t border-slate-200 dark:border-white/5">
      <div className="px-6 pt-5 pb-2 flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
          {METRIC_ARTIFACT_LABEL[metric]} · {total}
        </p>
        <p className="text-[10px] text-zinc-400">click any row to verify on GitHub</p>
      </div>
      {metric === 'revert'   && <RevertArtifactTable items={reverts} />}
      {metric === 'hotfix'   && <DeployArtifactTable items={hotfixes} />}
      {metric === 'failure'  && <DeployArtifactTable items={failures} />}
      {metric === 'redeploy' && <RedeployArtifactTable items={redeploys} />}
    </div>
  );
}

function RevertArtifactTable({ items }: { items: Array<QualityRevertCommitArtifact & { repo: string }> }) {
  return (
    <table className="min-w-full text-xs">
      <thead className="bg-slate-50 dark:bg-zinc-900 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
        <tr>
          <th className="px-4 py-2 text-left">When</th>
          <th className="px-4 py-2 text-left">Repo</th>
          <th className="px-4 py-2 text-left">Branch</th>
          <th className="px-4 py-2 text-left">SHA</th>
          <th className="px-4 py-2 text-left">Author</th>
          <th className="px-4 py-2 text-left">Message</th>
          <th className="px-4 py-2 text-right">GitHub</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-white/5">
        {items.map((c) => (
          <tr key={`${c.repo}-${c.sha}`} className="hover:bg-slate-50 dark:hover:bg-white/5">
            <td className="px-4 py-2 text-zinc-400 whitespace-nowrap">{new Date(c.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} <span className="text-zinc-300">{new Date(c.date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span></td>
            <td className="px-4 py-2 font-mono text-zinc-500 truncate max-w-[140px]" title={c.repo}>{c.repo}</td>
            <td className="px-4 py-2 font-mono text-[11px] text-zinc-500">{c.branch}</td>
            <td className="px-4 py-2 font-mono text-[11px] text-zinc-500">{c.shortSha}</td>
            <td className="px-4 py-2 font-mono text-zinc-500">{c.authorLogin ?? c.authorName ?? 'unknown'}</td>
            <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300 truncate max-w-[280px]" title={c.message}>{c.message}</td>
            <td className="px-4 py-2 text-right">
              <a href={c.htmlUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-cyan-600 dark:text-cyan-400 hover:text-cyan-700">
                Open <ExternalLink className="h-3 w-3" />
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DeployArtifactTable({ items }: { items: Array<(QualityHotfixDeployArtifact | QualityFailedDeployArtifact) & { repo: string }> }) {
  return (
    <table className="min-w-full text-xs">
      <thead className="bg-slate-50 dark:bg-zinc-900 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
        <tr>
          <th className="px-4 py-2 text-left">When</th>
          <th className="px-4 py-2 text-left">Repo</th>
          <th className="px-4 py-2 text-left">Branch</th>
          <th className="px-4 py-2 text-left">Workflow</th>
          <th className="px-4 py-2 text-left">Actor</th>
          <th className="px-4 py-2 text-left">Outcome</th>
          <th className="px-4 py-2 text-right">GitHub</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-white/5">
        {items.map((d, i) => (
          <tr key={`${d.repo}-${d.startedAt}-${i}`} className="hover:bg-slate-50 dark:hover:bg-white/5">
            <td className="px-4 py-2 text-zinc-400 whitespace-nowrap">{new Date(d.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} <span className="text-zinc-300">{new Date(d.startedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span></td>
            <td className="px-4 py-2 font-mono text-zinc-500 truncate max-w-[140px]" title={d.repo}>{d.repo}</td>
            <td className="px-4 py-2 font-mono text-[11px] text-zinc-500 truncate max-w-[180px]" title={d.branch}>{d.branch || '—'}</td>
            <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300 truncate max-w-[200px]" title={d.workflowName}>{d.workflowName}</td>
            <td className="px-4 py-2 font-mono text-zinc-500">{d.actor ?? 'unknown'}</td>
            <td className="px-4 py-2">
              <span className={clsx('px-2 py-0.5 rounded text-[10px] font-bold',
                d.conclusion === 'success' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : d.conclusion === 'failure' || d.conclusion === 'timed_out' ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                  : 'bg-zinc-500/10 text-zinc-500')}>
                {d.conclusion}
              </span>
            </td>
            <td className="px-4 py-2 text-right">
              <a href={d.htmlUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-cyan-600 dark:text-cyan-400 hover:text-cyan-700">
                Run <ExternalLink className="h-3 w-3" />
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const REDEPLOY_REASON_META: Record<QualityRedeployArtifact['reason'], { label: string; classes: string; tooltip: string }> = {
  'manual-re-run': { label: 'Manual re-run', classes: 'bg-blue-500/10 text-blue-600 dark:text-blue-400', tooltip: 'Someone hit "Re-run" on this workflow (run_attempt > 1).' },
  'same-sha':      { label: 'Same SHA',      classes: 'bg-amber-500/10 text-amber-700 dark:text-amber-400', tooltip: 'Same commit was deployed again to prod within 4h — likely a flaky deploy retried.' },
  'fix-forward':   { label: 'Fix-forward',   classes: 'bg-rose-500/10 text-rose-600 dark:text-rose-400', tooltip: 'A failed prod deploy was followed within 4h by this successful deploy (with a different fix).' },
};

function RedeployArtifactTable({ items }: { items: Array<QualityRedeployArtifact & { repo: string }> }) {
  return (
    <table className="min-w-full text-xs">
      <thead className="bg-slate-50 dark:bg-zinc-900 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
        <tr>
          <th className="px-4 py-2 text-left">When</th>
          <th className="px-4 py-2 text-left">Repo</th>
          <th className="px-4 py-2 text-left">Branch</th>
          <th className="px-4 py-2 text-left">SHA</th>
          <th className="px-4 py-2 text-left">Actor</th>
          <th className="px-4 py-2 text-left">Why flagged</th>
          <th className="px-4 py-2 text-right">Previous run</th>
          <th className="px-4 py-2 text-right">GitHub</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-white/5">
        {items.map((d, i) => {
          const meta = REDEPLOY_REASON_META[d.reason];
          return (
            <tr key={`${d.repo}-${d.startedAt}-${i}`} className="hover:bg-slate-50 dark:hover:bg-white/5">
              <td className="px-4 py-2 text-zinc-400 whitespace-nowrap">{new Date(d.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} <span className="text-zinc-300">{new Date(d.startedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span></td>
              <td className="px-4 py-2 font-mono text-zinc-500 truncate max-w-[140px]" title={d.repo}>{d.repo}</td>
              <td className="px-4 py-2 font-mono text-[11px] text-zinc-500">{d.branch}</td>
              <td className="px-4 py-2 font-mono text-[11px] text-zinc-500">{d.shortSha}</td>
              <td className="px-4 py-2 font-mono text-zinc-500">{d.actor ?? 'unknown'}</td>
              <td className="px-4 py-2">
                <span title={meta.tooltip} className={clsx('inline-flex px-2 py-0.5 rounded text-[10px] font-bold', meta.classes)}>
                  {meta.label}
                </span>
              </td>
              <td className="px-4 py-2 text-right text-zinc-400">
                {d.prevHtmlUrl && d.prevStartedAt ? (
                  <a href={d.prevHtmlUrl} target="_blank" rel="noopener noreferrer" className="hover:text-cyan-600 inline-flex items-center gap-1" title={`${d.prevConclusion ?? 'unknown'} · ${d.prevShortSha ?? ''}`}>
                    {d.gapMinutes !== null ? `${d.gapMinutes}m before` : 'see run'} <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span className="text-zinc-300">—</span>
                )}
              </td>
              <td className="px-4 py-2 text-right">
                <a href={d.htmlUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-cyan-600 dark:text-cyan-400 hover:text-cyan-700">
                  Run <ExternalLink className="h-3 w-3" />
                </a>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const METRIC_ARTIFACT_LABEL: Record<MetricKey, string> = {
  hotfix:   'Hotfix deploy runs',
  redeploy: 'Re-deploy events (the second prod deploy)',
  failure:  'Failed deploy runs',
  revert:   'Revert commits',
};

function RepoBreakdownRow({ row, spec }: {
  row: { listing: QualityRepoListing; weeks: QualityWeekBucket[]; selectedCount: number; selectedDenom: number; totalCount: number; totalDenom: number };
  spec: MetricSpec;
}) {
  const sparkData = row.weeks.map((w) => ({ x: w.weekStart, value: spec.count(w) }));
  const formatRate = (count: number, denom: number): string => {
    if (!spec.isRate) return `${count}`;
    if (denom === 0) return `${count} (—)`;
    const rate = Math.round((count / denom) * 1000) / 10;
    return `${rate}% (${count}/${denom})`;
  };
  return (
    <tr className="hover:bg-slate-50 dark:hover:bg-white/5">
      <td className="px-6 py-3">
        <a
          href={row.listing.htmlUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-mono text-zinc-700 dark:text-zinc-300 hover:text-cyan-600"
        >
          {row.listing.repo}
          <ExternalLink className="h-3 w-3" />
        </a>
        {row.listing.language && <p className="text-[10px] text-zinc-400 mt-0.5">{row.listing.language}</p>}
      </td>
      <td className="px-4 py-3 text-right font-mono">
        <span className={clsx('font-bold', row.selectedCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-zinc-500')}>
          {formatRate(row.selectedCount, row.selectedDenom)}
        </span>
      </td>
      <td className="px-4 py-3 text-right font-mono text-zinc-500">
        {formatRate(row.totalCount, row.totalDenom)}
      </td>
      <td className="px-4 py-3">
        <div className="h-7 w-32">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`spark-${row.listing.fullName}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"  stopColor="#f43f5e" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="value" stroke="#f43f5e" strokeWidth={1.5} fillOpacity={1} fill={`url(#spark-${row.listing.fullName})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </td>
    </tr>
  );
}
