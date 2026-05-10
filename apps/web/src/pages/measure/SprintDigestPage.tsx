import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ExternalLink, Search, Rocket, GitPullRequest, Users, AlertTriangle, Clock, TrendingUp, TrendingDown, Minus, Flame, Moon, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { PageHeader } from '@wep/ui';
import {
  sprintApi,
  type SprintWindowKind,
  type SprintReposResponse,
  type SprintRepoResponse,
  type SprintRepoListing,
  type SprintShippedPr,
  type SprintDeployEntry,
} from '../../lib/api';

const WINDOW_OPTIONS: { value: SprintWindowKind; label: string }[] = [
  { value: '1w', label: '1 week' },
  { value: '2w', label: '2 weeks' },
  { value: '4w', label: '4 weeks' },
  { value: 'custom', label: 'Custom' },
];

type Tab = 'shipped' | 'deploys' | 'load';

const TABS: { value: Tab; label: string; icon: React.ReactNode }[] = [
  { value: 'shipped', label: 'Shipped',   icon: <GitPullRequest className="h-4 w-4" /> },
  { value: 'deploys', label: 'Deploys',   icon: <Rocket         className="h-4 w-4" /> },
  { value: 'load',    label: 'Team Load', icon: <Users          className="h-4 w-4" /> },
];

// Lower than Project Health (which is 8) because each Sprint Digest repo
// triggers ~4 paginated GitHub calls vs ~3 for Project Health, and the page
// often runs alongside other GitHub-heavy views. Keeps total API rate sane.
const ROW_FETCH_CONCURRENCY = 4;

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function ago(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

type RepoState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: SprintRepoResponse };

interface AccumulatedSummary {
  mergedPrs: number;
  totalDeploys: number;
  prodDeploys: number;
  succeededDeploys: number;
  completedDeploys: number;
  hotfixDeploys: number;
  offHoursProdDeploys: number;
  cycleTimesHours: number[];
}

interface AccumulatedEngineer {
  login: string;
  prsMerged: number;
  commits: number;
  deploysTriggered: number;
  reposTouched: number;
  repos: string[];
  openPrCount: number;
  oldestOpenPrAgeDays: number | null;
  offHoursCommits: number;
  offHoursDeploys: number;
}

interface AccumulatedView {
  summary: AccumulatedSummary;
  prevSummary: AccumulatedSummary;
  shipped: SprintShippedPr[];
  deploys: SprintDeployEntry[];
  engineers: AccumulatedEngineer[];
}

const EMPTY_SUMMARY = (): AccumulatedSummary => ({
  mergedPrs: 0, totalDeploys: 0, prodDeploys: 0, succeededDeploys: 0, completedDeploys: 0,
  hotfixDeploys: 0, offHoursProdDeploys: 0, cycleTimesHours: [],
});

function percentile(arr: number[], p: number): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1));
  return Math.round(sorted[idx]! * 10) / 10;
}

function aggregate(states: Map<string, RepoState>): AccumulatedView {
  const summary = EMPTY_SUMMARY();
  const prevSummary = EMPTY_SUMMARY();
  const shipped: SprintShippedPr[] = [];
  const deploys: SprintDeployEntry[] = [];
  type EngBucket = {
    login: string;
    prsMerged: number;
    commits: number;
    deploysTriggered: number;
    repos: Set<string>;
    openPrCount: number;
    oldestOpenPrAgeDays: number | null;
    offHoursCommits: number;
    offHoursDeploys: number;
  };
  const engineers = new Map<string, EngBucket>();

  for (const state of states.values()) {
    if (state.status !== 'ready') continue;
    const d = state.data;
    summary.mergedPrs            += d.current.mergedPrs;
    summary.totalDeploys         += d.current.totalDeploys;
    summary.prodDeploys          += d.current.prodDeploys;
    summary.succeededDeploys     += d.current.succeededDeploys;
    summary.completedDeploys     += d.current.completedDeploys;
    summary.hotfixDeploys        += d.current.hotfixDeploys;
    summary.offHoursProdDeploys  += d.current.offHoursProdDeploys;
    summary.cycleTimesHours.push(...d.current.cycleTimesHours);

    prevSummary.mergedPrs            += d.previous.mergedPrs;
    prevSummary.totalDeploys         += d.previous.totalDeploys;
    prevSummary.prodDeploys          += d.previous.prodDeploys;
    prevSummary.succeededDeploys     += d.previous.succeededDeploys;
    prevSummary.completedDeploys     += d.previous.completedDeploys;
    prevSummary.hotfixDeploys        += d.previous.hotfixDeploys;
    prevSummary.offHoursProdDeploys  += d.previous.offHoursProdDeploys;
    prevSummary.cycleTimesHours.push(...d.previous.cycleTimesHours);

    shipped.push(...d.shipped);
    deploys.push(...d.deploys);

    for (const [login, stat] of Object.entries(d.engineerStats)) {
      let bucket = engineers.get(login);
      if (!bucket) {
        bucket = {
          login, prsMerged: 0, commits: 0, deploysTriggered: 0, repos: new Set(),
          openPrCount: 0, oldestOpenPrAgeDays: null,
          offHoursCommits: 0, offHoursDeploys: 0,
        };
        engineers.set(login, bucket);
      }
      bucket.prsMerged       += stat.prsMerged;
      bucket.commits         += stat.commits;
      bucket.deploysTriggered+= stat.deploysTriggered;
      bucket.openPrCount     += stat.openPrCount;
      bucket.offHoursCommits += stat.offHoursCommits;
      bucket.offHoursDeploys += stat.offHoursDeploys;
      if (stat.oldestOpenPrAgeDays !== null && (bucket.oldestOpenPrAgeDays === null || stat.oldestOpenPrAgeDays > bucket.oldestOpenPrAgeDays)) {
        bucket.oldestOpenPrAgeDays = stat.oldestOpenPrAgeDays;
      }
      bucket.repos.add(d.repo);
    }
  }

  shipped.sort((a, b) => new Date(b.mergedAt).getTime() - new Date(a.mergedAt).getTime());
  deploys.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  const engineersList: AccumulatedEngineer[] = [...engineers.values()]
    .map((b) => ({
      login: b.login,
      prsMerged: b.prsMerged,
      commits: b.commits,
      deploysTriggered: b.deploysTriggered,
      reposTouched: b.repos.size,
      repos: [...b.repos].sort(),
      openPrCount: b.openPrCount,
      oldestOpenPrAgeDays: b.oldestOpenPrAgeDays,
      offHoursCommits: b.offHoursCommits,
      offHoursDeploys: b.offHoursDeploys,
    }))
    .sort((a, b) => (b.prsMerged + b.commits + b.deploysTriggered) - (a.prsMerged + a.commits + a.deploysTriggered));

  return { summary, prevSummary, shipped, deploys, engineers: engineersList };
}

interface QualityStripStats {
  mergedPrs: number;
  totalDeploys: number;
  prodDeploys: number;
  deploySuccessRate: number | null;
  hotfixDeploys: number;
  offHoursProdDeploys: number;
  cycleTimeP50Hours: number | null;
  cycleTimeP90Hours: number | null;
}

function qualityFromAccumulated(s: AccumulatedSummary): QualityStripStats {
  return {
    mergedPrs: s.mergedPrs,
    totalDeploys: s.totalDeploys,
    prodDeploys: s.prodDeploys,
    deploySuccessRate: s.completedDeploys > 0
      ? Math.round((s.succeededDeploys / s.completedDeploys) * 1000) / 10 : null,
    hotfixDeploys: s.hotfixDeploys,
    offHoursProdDeploys: s.offHoursProdDeploys,
    cycleTimeP50Hours: percentile(s.cycleTimesHours, 0.5),
    cycleTimeP90Hours: percentile(s.cycleTimesHours, 0.9),
  };
}

export function SprintDigestPage() {
  const [windowKind, setWindowKind] = useState<SprintWindowKind>('2w');
  const [customStart, setCustomStart] = useState(ago(14));
  const [customEnd, setCustomEnd] = useState(todayIso());
  const [list, setList] = useState<SprintReposResponse | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [repoStates, setRepoStates] = useState<Map<string, RepoState>>(new Map());
  const [tab, setTab] = useState<Tab>('shipped');
  const [search, setSearch] = useState('');
  const cancelRef = useRef<{ cancelled: boolean } | null>(null);

  const fetchAll = useCallback(async () => {
    if (cancelRef.current) cancelRef.current.cancelled = true;
    const ctrl = { cancelled: false };
    cancelRef.current = ctrl;

    setListLoading(true);
    setListError(null);
    setList(null);
    setRepoStates(new Map());

    let listing: SprintReposResponse;
    try {
      listing = await sprintApi.repos(windowKind, customStart, customEnd);
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
          const data = await sprintApi.repo(r.owner, r.repo, windowKind, customStart, customEnd);
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
  }, [windowKind, customStart, customEnd]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const view = useMemo(() => aggregate(repoStates), [repoStates]);

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

  const currentQuality = qualityFromAccumulated(view.summary);
  const previousQuality = qualityFromAccumulated(view.prevSummary);

  return (
    <div className="space-y-6">
      <PageHeader title="Sprint Digest" onRefresh={refresh} refreshing={listLoading || fanoutBusy} />

      <div className="rounded-2xl border border-slate-200/60 bg-white/40 px-5 py-4 text-sm text-zinc-600 backdrop-blur dark:border-white/10 dark:bg-zinc-900/30 dark:text-zinc-300">
        <p className="font-semibold text-zinc-900 dark:text-white">What this page shows</p>
        <p className="mt-1 leading-relaxed">
          A cross-repository view of what your engineering team shipped in the selected window. Numbers and lists update live as each repo's data lands.
          Use it during sprint review or retro: scan <strong>Shipped</strong> for PR titles + branch names (recognise your tickets),
          <strong> Deploys</strong> for what landed in prod, and <strong>Engineers</strong> for who carried the load.
        </p>
      </div>

      {/* Window selector */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-1 rounded-xl border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-zinc-900/40 backdrop-blur p-1">
          {WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setWindowKind(opt.value)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
                windowKind === opt.value
                  ? 'bg-cyan-500 text-white shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {windowKind === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="px-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-zinc-900 dark:text-white" />
            <span className="text-zinc-400">→</span>
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="px-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-zinc-900 dark:text-white" />
          </div>
        )}
        {list && (
          <span className="text-xs text-zinc-500 ml-auto">
            {new Date(list.windowStart).toLocaleDateString()} → {new Date(list.windowEnd).toLocaleDateString()}
            <span className="text-zinc-400"> · {list.windowDays}d · {counts.total} repos</span>
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

      <QualityStrip current={currentQuality} previous={previousQuality} ready={counts.ready} total={counts.total} />

      {/* Tabs */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 rounded-xl border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-zinc-900/40 backdrop-blur p-1">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={clsx(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
                tab === t.value
                  ? 'bg-cyan-500 text-white shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200',
              )}
            >
              {t.icon}
              {t.label}
              <span className={clsx('px-1.5 py-0.5 rounded-full text-[9px] font-bold', tab === t.value ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-zinc-800 text-zinc-500')}>
                {t.value === 'shipped' ? view.shipped.length : t.value === 'deploys' ? view.deploys.length : view.engineers.length}
              </span>
              {t.value === 'load' && view.engineers.some((e) => isStuck(e) || isOverloaded(e, view.engineers)) && (
                <span title="Some engineers may need help" className="ml-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" />
              )}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === 'shipped' ? 'Search PR title, branch, author, repo…' : tab === 'deploys' ? 'Search branch, actor, repo…' : 'Search engineer…'}
            className="w-full pl-10 pr-3 py-2 text-sm rounded-xl border border-slate-200 bg-white dark:bg-zinc-900 dark:border-white/10 dark:text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
          />
        </div>
        {fanoutBusy && counts.ready < counts.total && (
          <span className="text-xs text-zinc-500 inline-flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> still loading {counts.loading} repos…
          </span>
        )}
      </div>

      {tab === 'shipped' && <ShippedTable items={view.shipped} search={search} loadingMore={fanoutBusy} />}
      {tab === 'deploys' && <DeploysTable items={view.deploys} search={search} loadingMore={fanoutBusy} />}
      {tab === 'load'    && <TeamLoadTable items={view.engineers} search={search} />}

      {list && (
        <p className="text-[10px] text-zinc-400 text-right">
          List generated {new Date(list.generatedAt).toLocaleString()} · per-repo data cached 5 min server-side.
          {list.excludedQuiet > 0 && ` · ${list.excludedQuiet} repos skipped (quiet)`}
        </p>
      )}
    </div>
  );
}

// ── Quality strip ────────────────────────────────────────────────────────────

interface DeltaCardProps {
  label: string;
  value: string | number;
  delta: number | null;
  goodDirection: 'up' | 'down';
  icon: React.ReactNode;
  partial: boolean;
  sublabel?: string;
}

function DeltaCard({ label, value, delta, goodDirection, icon, partial, sublabel }: DeltaCardProps) {
  let deltaTone: 'good' | 'bad' | 'neutral' = 'neutral';
  if (delta !== null && delta !== 0) {
    const isUp = delta > 0;
    deltaTone = (goodDirection === 'up' && isUp) || (goodDirection === 'down' && !isUp) ? 'good' : 'bad';
  }
  const deltaClass = deltaTone === 'good' ? 'text-emerald-600 dark:text-emerald-400'
    : deltaTone === 'bad' ? 'text-rose-600 dark:text-rose-400'
      : 'text-zinc-400';
  const DeltaIcon = delta === null ? Minus : delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white/60 px-4 py-3 shadow-xl shadow-slate-200/20 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40 relative">
      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-400">
        <span className="flex items-center gap-1">{icon} {label}</span>
        {delta !== null && (
          <span className={clsx('inline-flex items-center gap-0.5', deltaClass)}>
            <DeltaIcon className="h-3 w-3" />
            {delta === 0 ? '0' : `${delta > 0 ? '+' : ''}${delta}`}
          </span>
        )}
      </div>
      <p className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">{value}</p>
      {sublabel && <p className="text-[10px] text-zinc-400 mt-0.5">{sublabel}</p>}
      {partial && (
        <span className="absolute top-2 right-2 inline-flex items-center text-zinc-400" title="Still aggregating remaining repos">
          <Loader2 className="h-3 w-3 animate-spin" />
        </span>
      )}
    </div>
  );
}

interface QualityStripProps {
  current: QualityStripStats;
  previous: QualityStripStats;
  ready: number;
  total: number;
}

function QualityStrip({ current, previous, ready, total }: QualityStripProps) {
  const partial = ready < total;
  const delta = (a: number | null, b: number | null): number | null => {
    if (a === null && b === null) return null;
    return Math.round(((a ?? 0) - (b ?? 0)) * 10) / 10;
  };
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
      <DeltaCard label="Merged PRs"      icon={<GitPullRequest className="h-3 w-3" />} value={current.mergedPrs}                                                            delta={delta(current.mergedPrs, previous.mergedPrs)}              goodDirection="up"   partial={partial} />
      <DeltaCard label="Prod deploys"    icon={<Rocket         className="h-3 w-3" />} value={current.prodDeploys}                                                          delta={delta(current.prodDeploys, previous.prodDeploys)}          goodDirection="up"   partial={partial} />
      <DeltaCard label="Success rate"    icon={<Rocket         className="h-3 w-3" />} value={current.deploySuccessRate === null ? '—' : `${current.deploySuccessRate}%`}    delta={delta(current.deploySuccessRate, previous.deploySuccessRate)} goodDirection="up" partial={partial} />
      <DeltaCard label="Hotfixes"        icon={<Flame          className="h-3 w-3" />} value={current.hotfixDeploys}                                                        delta={delta(current.hotfixDeploys, previous.hotfixDeploys)}      goodDirection="down" partial={partial} />
      <DeltaCard label="Off-hours prod"  icon={<Moon           className="h-3 w-3" />} value={current.offHoursProdDeploys}                                                  delta={delta(current.offHoursProdDeploys, previous.offHoursProdDeploys)} goodDirection="down" partial={partial} />
      <DeltaCard label="Cycle p50"       icon={<Clock          className="h-3 w-3" />} value={current.cycleTimeP50Hours === null ? '—' : `${current.cycleTimeP50Hours}h`}    delta={delta(current.cycleTimeP50Hours, previous.cycleTimeP50Hours)} goodDirection="down" partial={partial} />
      <DeltaCard label="Cycle p90"       icon={<Clock          className="h-3 w-3" />} value={current.cycleTimeP90Hours === null ? '—' : `${current.cycleTimeP90Hours}h`}    delta={delta(current.cycleTimeP90Hours, previous.cycleTimeP90Hours)} goodDirection="down" partial={partial} />
    </div>
  );
}

// ── Shipped tab ──────────────────────────────────────────────────────────────

function ShippedTable({ items, search, loadingMore }: { items: SprintShippedPr[]; search: string; loadingMore: boolean }) {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((p) =>
      p.title.toLowerCase().includes(q) ||
      p.branch.toLowerCase().includes(q) ||
      p.author.toLowerCase().includes(q) ||
      p.repo.toLowerCase().includes(q),
    );
  }, [items, search]);

  if (items.length === 0 && !loadingMore) {
    return <EmptyState message="No PRs were merged in this window." />;
  }

  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur shadow-xl shadow-slate-200/20 dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40 overflow-hidden">
      <table className="min-w-full text-xs">
        <thead className="bg-slate-50/80 dark:bg-zinc-900 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
          <tr>
            <th className="px-4 py-2.5 text-left">Repo</th>
            <th className="px-4 py-2.5 text-left">PR</th>
            <th className="px-4 py-2.5 text-left">Branch</th>
            <th className="px-4 py-2.5 text-left">Author</th>
            <th className="px-4 py-2.5 text-right">Merged</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-white/5">
          {filtered.map((pr) => (
            <tr key={`${pr.repo}-${pr.number}`} className="hover:bg-slate-50 dark:hover:bg-white/5">
              <td className="px-4 py-2.5 font-mono text-zinc-500 truncate max-w-[160px]" title={pr.repo}>{pr.repo}</td>
              <td className="px-4 py-2.5">
                <a href={pr.htmlUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-zinc-700 dark:text-zinc-300 hover:text-cyan-600">
                  <span className="font-mono text-zinc-400">#{pr.number}</span>
                  <span className="font-medium">{pr.title}</span>
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              </td>
              <td className="px-4 py-2.5 font-mono text-[11px] text-zinc-500 truncate max-w-[200px]" title={pr.branch}>{pr.branch}</td>
              <td className="px-4 py-2.5 font-mono text-zinc-500">{pr.author}</td>
              <td className="px-4 py-2.5 text-right text-zinc-400">{relativeTime(pr.mergedAt)}</td>
            </tr>
          ))}
          {filtered.length === 0 && search && (
            <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-zinc-400">No PRs match "{search}".</td></tr>
          )}
          {filtered.length === 0 && !search && loadingMore && (
            <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-zinc-400 inline-flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Waiting for the first repo to land…</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Deploys tab ──────────────────────────────────────────────────────────────

function DeploysTable({ items, search, loadingMore }: { items: SprintDeployEntry[]; search: string; loadingMore: boolean }) {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((d) =>
      d.repo.toLowerCase().includes(q) ||
      d.branch.toLowerCase().includes(q) ||
      d.actor.toLowerCase().includes(q) ||
      d.workflowName.toLowerCase().includes(q),
    );
  }, [items, search]);

  if (items.length === 0 && !loadingMore) {
    return <EmptyState message="No workflow runs in this window." />;
  }

  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur shadow-xl shadow-slate-200/20 dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40 overflow-hidden">
      <table className="min-w-full text-xs">
        <thead className="bg-slate-50/80 dark:bg-zinc-900 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
          <tr>
            <th className="px-4 py-2.5 text-left">When</th>
            <th className="px-4 py-2.5 text-left">Repo</th>
            <th className="px-4 py-2.5 text-left">Workflow</th>
            <th className="px-4 py-2.5 text-left">Branch</th>
            <th className="px-4 py-2.5 text-left">Env</th>
            <th className="px-4 py-2.5 text-left">Actor</th>
            <th className="px-4 py-2.5 text-left">Outcome</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-white/5">
          {filtered.map((d) => (
            <tr key={`${d.repo}-${d.startedAt}-${d.workflowName}`} className={clsx('hover:bg-slate-50 dark:hover:bg-white/5', d.isOffHours && 'bg-amber-50/40 dark:bg-amber-950/10')}>
              <td className="px-4 py-2.5 text-zinc-400 whitespace-nowrap">{relativeTime(d.startedAt)}</td>
              <td className="px-4 py-2.5 font-mono text-zinc-500 truncate max-w-[160px]" title={d.repo}>{d.repo}</td>
              <td className="px-4 py-2.5">
                <a href={d.htmlUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-zinc-700 dark:text-zinc-300 hover:text-cyan-600">
                  <span className="font-medium">{d.workflowName}</span>
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              </td>
              <td className="px-4 py-2.5 font-mono text-[11px] text-zinc-500 truncate max-w-[200px]" title={d.branch}>
                {d.isHotfix && <span className="inline-flex items-center gap-0.5 mr-1 text-rose-600 dark:text-rose-400 font-bold"><Flame className="h-3 w-3" /></span>}
                {d.branch || '—'}
              </td>
              <td className="px-4 py-2.5">
                {d.env === 'production' && <span className="font-bold text-emerald-600 dark:text-emerald-400">PROD</span>}
                {d.env === 'development' && <span className="font-bold text-amber-600 dark:text-amber-400">DEV</span>}
                {d.env === 'unknown' && <span className="text-zinc-400">—</span>}
                {d.isOffHours && <span title="Off-hours / weekend deploy" className="ml-1 inline-flex items-center text-amber-600 dark:text-amber-400"><Moon className="h-3 w-3" /></span>}
              </td>
              <td className="px-4 py-2.5 font-mono text-zinc-500">{d.actor}</td>
              <td className="px-4 py-2.5"><ConclusionPill conclusion={d.conclusion} /></td>
            </tr>
          ))}
          {filtered.length === 0 && search && (
            <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-zinc-400">No deploys match "{search}".</td></tr>
          )}
          {filtered.length === 0 && !search && loadingMore && (
            <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-zinc-400 inline-flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Waiting for the first repo to land…</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ConclusionPill({ conclusion }: { conclusion: string }) {
  if (conclusion === 'success') return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">success</span>;
  if (conclusion === 'failure' || conclusion === 'timed_out') return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400">{conclusion}</span>;
  return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-zinc-500/10 text-zinc-500 dark:text-zinc-400">{conclusion}</span>;
}

// ── Team Load tab ────────────────────────────────────────────────────────────

const STUCK_PR_DAYS = 14;
const OVERLOAD_LOAD_SHARE_PCT = 25;
const OVERLOAD_OFFHOURS_RATIO = 0.25;
const OVERLOAD_REPOS_TOUCHED = 5;

function totalActivity(e: AccumulatedEngineer): number {
  return e.prsMerged + e.commits + e.deploysTriggered;
}

function offHoursRatio(e: AccumulatedEngineer): number {
  const denom = e.commits + e.deploysTriggered;
  if (denom === 0) return 0;
  return (e.offHoursCommits + e.offHoursDeploys) / denom;
}

function isStuck(e: AccumulatedEngineer): boolean {
  return e.oldestOpenPrAgeDays !== null && e.oldestOpenPrAgeDays >= STUCK_PR_DAYS;
}

function isOverloaded(e: AccumulatedEngineer, all: AccumulatedEngineer[]): boolean {
  const sumActivity = all.reduce((s, x) => s + totalActivity(x), 0);
  const share = sumActivity > 0 ? (totalActivity(e) / sumActivity) * 100 : 0;
  if (share >= OVERLOAD_LOAD_SHARE_PCT) return true;
  if (offHoursRatio(e) >= OVERLOAD_OFFHOURS_RATIO && totalActivity(e) >= 5) return true;
  if (e.reposTouched >= OVERLOAD_REPOS_TOUCHED) return true;
  return false;
}

function TeamLoadTable({ items, search }: { items: AccumulatedEngineer[]; search: string }) {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((e) =>
      e.login.toLowerCase().includes(q) ||
      e.repos.some((r) => r.toLowerCase().includes(q)),
    );
  }, [items, search]);

  const totalActivityAll = items.reduce((s, e) => s + totalActivity(e), 0);

  if (items.length === 0) {
    return <EmptyState message="No engineer activity in this window yet." />;
  }

  return (
    <>
      <div className="rounded-2xl border border-cyan-200/40 bg-cyan-50/40 dark:bg-cyan-950/10 dark:border-cyan-500/20 px-5 py-4 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
        <p className="font-semibold text-zinc-900 dark:text-white text-sm">Reading this tab</p>
        <p className="mt-1">
          This is a snapshot of <strong>workload distribution</strong> in the selected window — not a performance comparison.
          Use the chips to spot two things you can act on:
        </p>
        <ul className="mt-2 ml-5 list-disc space-y-0.5">
          <li><span className="font-bold text-amber-700 dark:text-amber-400">🚨 Possibly overloaded</span> — share &gt;25%, or working off-hours, or touching 5+ repos. Check if they need help or if something can shift to someone else.</li>
          <li><span className="font-bold text-rose-700 dark:text-rose-400">⏳ Possibly stuck</span> — has an open PR that's been waiting 14+ days. Pair, unblock, or split the work.</li>
        </ul>
        <p className="mt-2">Light load isn't a flag — quiet windows and onboarding ramp-up are normal.</p>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur shadow-xl shadow-slate-200/20 dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40 overflow-hidden">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50/80 dark:bg-zinc-900 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
            <tr>
              <th className="px-4 py-2.5 text-left">Engineer</th>
              <th className="px-4 py-2.5 text-left">Signals</th>
              <th className="px-4 py-2.5 text-left">Load share</th>
              <th className="px-4 py-2.5 text-right" title="Currently-open PRs by this engineer (snapshot, not window-bounded)">Open PRs</th>
              <th className="px-4 py-2.5 text-right" title="Age of their oldest currently-open PR">Stuck PR</th>
              <th className="px-4 py-2.5 text-right" title="Off-hours commits + deploys (UTC outside 09–18 or weekends)">Off-hours</th>
              <th className="px-4 py-2.5 text-right">Merged</th>
              <th className="px-4 py-2.5 text-right">Commits</th>
              <th className="px-4 py-2.5 text-right">Deploys</th>
              <th className="px-4 py-2.5 text-right">Repos</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-white/5">
            {filtered.map((e) => {
              const share = totalActivityAll > 0 ? (totalActivity(e) / totalActivityAll) * 100 : 0;
              const stuck = isStuck(e);
              const overloaded = isOverloaded(e, items);
              const offHoursTotal = e.offHoursCommits + e.offHoursDeploys;
              return (
                <tr key={e.login} className="hover:bg-slate-50 dark:hover:bg-white/5">
                  <td className="px-4 py-2.5 font-mono text-zinc-700 dark:text-zinc-300">{e.login}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {overloaded && (
                        <span title="Load share >25%, off-hours work, or touching 5+ repos" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30">
                          🚨 Possibly overloaded
                        </span>
                      )}
                      {stuck && (
                        <span title={`Oldest open PR is ${e.oldestOpenPrAgeDays} days old`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30">
                          ⏳ Possibly stuck
                        </span>
                      )}
                      {!overloaded && !stuck && <span className="text-[10px] text-zinc-400 italic">—</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 min-w-[180px]">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1 h-2 bg-slate-100 dark:bg-zinc-800 rounded-full overflow-hidden max-w-[140px]">
                        <div className={clsx('absolute inset-y-0 left-0', overloaded ? 'bg-amber-500/70' : 'bg-cyan-500/60')} style={{ width: `${Math.min(100, share)}%` }} />
                      </div>
                      <span className="tabular-nums text-zinc-500 w-12 text-right">{share.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{e.openPrCount}</td>
                  <td className={clsx('px-4 py-2.5 text-right tabular-nums', stuck ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-zinc-500')}>
                    {e.oldestOpenPrAgeDays === null ? '—' : `${e.oldestOpenPrAgeDays}d`}
                  </td>
                  <td className={clsx('px-4 py-2.5 text-right tabular-nums', offHoursTotal > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-500')} title={`${e.offHoursCommits} off-hours commits + ${e.offHoursDeploys} off-hours deploys`}>
                    {offHoursTotal > 0 ? offHoursTotal : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{e.prsMerged}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{e.commits}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{e.deploysTriggered}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums" title={e.repos.join(', ')}>{e.reposTouched}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && search && (
              <tr><td colSpan={10} className="px-4 py-12 text-center text-sm text-zinc-400">No engineers match "{search}".</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 dark:border-white/10 p-12 text-center">
      <AlertTriangle className="h-6 w-6 mx-auto text-zinc-400" />
      <p className="mt-2 text-sm text-zinc-500">{message}</p>
    </div>
  );
}
