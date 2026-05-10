import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Search, GitBranch, Users, Rocket, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { PageHeader } from '@wep/ui';
import {
  projectsApi,
  type ProjectListing,
  type ProjectMetrics,
  type ProjectSignal,
  type ProjectsListResponse,
} from '../../lib/api';
import { ProjectDetailDrawer } from './ProjectDetailDrawer';

const SIGNAL_META: Record<ProjectSignal, { label: string; emoji: string; classes: string; tooltip: string }> = {
  'high-activity':    { label: 'High activity',  emoji: '🔥', classes: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30',  tooltip: 'More than 20 PRs merged in the last 30 days. Either a critical or fast-moving project.' },
  'low-activity':     { label: 'Low activity',   emoji: '🐌', classes: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',     tooltip: '≤1 merged PR in 30 days and no recent activity in 14+ days.' },
  'stale':            { label: 'Stale',          emoji: '💀', classes: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/30',         tooltip: 'No push in 30+ days. Possibly unused — consider archiving if confirmed.' },
  'bus-factor-risk':  { label: 'Bus factor risk',emoji: '🚨', classes: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30',         tooltip: 'High activity but only 1 contributor. Pull more people in or you have a single point of failure.' },
  'deploy-failures':  { label: 'Deploy failures',emoji: '📉', classes: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30',             tooltip: 'Less than 80% of deploy runs succeeded in the last 30 days.' },
  'review-backlog':   { label: 'Review backlog', emoji: '⏰', classes: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30', tooltip: 'Oldest open PR has been waiting more than 14 days.' },
  'no-deploys':       { label: 'No deploys',     emoji: '🚫', classes: 'bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-500/30', tooltip: 'Active commits but zero deploys in 30 days. CI/CD might be blocked.' },
  'healthy':          { label: 'Healthy',        emoji: '🏆', classes: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30', tooltip: 'Active, multi-contributor, and shipping cleanly.' },
};

function SignalChip({ signal }: { signal: ProjectSignal }) {
  const meta = SIGNAL_META[signal];
  return (
    <span
      title={meta.tooltip}
      className={clsx('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border', meta.classes)}
    >
      <span aria-hidden>{meta.emoji}</span> {meta.label}
    </span>
  );
}

function relativeDays(daysAgo: number | null): string {
  if (daysAgo === null) return '—';
  if (daysAgo < 1) return 'today';
  if (daysAgo === 1) return '1 day ago';
  if (daysAgo < 30) return `${daysAgo} days ago`;
  if (daysAgo < 60) return '~1 month ago';
  return `${Math.floor(daysAgo / 30)} months ago`;
}

type MetricState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ProjectMetrics };

type SortKey = 'name' | 'activity' | 'commits' | 'contributors' | 'deploys' | 'success';

const SORT_LABELS: Record<SortKey, string> = {
  name:         'Name',
  activity:     'Last activity',
  commits:      '30d commits',
  contributors: 'Contributors',
  deploys:      'Deploys (30d)',
  success:      'Deploy success',
};

const FILTER_OPTIONS = [
  { value: 'all',      label: 'All' },
  { value: 'unhealthy',label: 'Unhealthy' },
  { value: 'stale',    label: 'Stale' },
  { value: 'healthy',  label: 'Healthy' },
] as const;
type FilterValue = (typeof FILTER_OPTIONS)[number]['value'];

const ROW_FETCH_CONCURRENCY = 8;

export function ProjectHealthPage() {
  const [list, setList] = useState<ProjectsListResponse | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Map<string, MetricState>>(new Map());
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterValue>('all');
  const [sortKey, setSortKey] = useState<SortKey>('activity');
  const [sortDesc, setSortDesc] = useState(true);
  const [drawerProject, setDrawerProject] = useState<ProjectMetrics | null>(null);
  const cancelRef = useRef<{ cancelled: boolean } | null>(null);

  const fetchAll = useCallback(async () => {
    // Cancel any in-flight fan-out from a previous load
    if (cancelRef.current) cancelRef.current.cancelled = true;
    const ctrl = { cancelled: false };
    cancelRef.current = ctrl;

    setListLoading(true);
    setListError(null);
    setList(null);
    setMetrics(new Map());

    let listing: ProjectsListResponse;
    try {
      listing = await projectsApi.list();
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

    // Pre-mark every repo as loading so skeleton rows render immediately.
    const initial = new Map<string, MetricState>();
    for (const r of listing.repos) initial.set(r.fullName, { status: 'loading' });
    setMetrics(initial);

    // Fan-out with bounded concurrency. Each repo's row updates independently
    // as its fetch lands.
    const queue = [...listing.repos];
    const workers = Array.from({ length: Math.min(ROW_FETCH_CONCURRENCY, queue.length) }, async () => {
      while (!ctrl.cancelled) {
        const repo = queue.shift();
        if (!repo) return;
        try {
          const data = await projectsApi.metrics(repo.owner, repo.repo);
          if (ctrl.cancelled) return;
          setMetrics((prev) => {
            const next = new Map(prev);
            next.set(repo.fullName, { status: 'ready', data });
            return next;
          });
        } catch (err) {
          if (ctrl.cancelled) return;
          const message = err instanceof Error ? err.message : String(err);
          setMetrics((prev) => {
            const next = new Map(prev);
            next.set(repo.fullName, { status: 'error', message });
            return next;
          });
        }
      }
    });
    await Promise.all(workers);
  }, []);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const readyRepos = useMemo(() => {
    if (!list) return [];
    const out: { listing: ProjectListing; data: ProjectMetrics }[] = [];
    for (const r of list.repos) {
      const state = metrics.get(r.fullName);
      if (state?.status === 'ready') out.push({ listing: r, data: state.data });
    }
    return out;
  }, [list, metrics]);

  const filteredRows = useMemo(() => {
    if (!list) return [];
    const q = search.trim().toLowerCase();
    return list.repos
      .filter((r) => {
        if (q && !r.repo.toLowerCase().includes(q) && !(r.language ?? '').toLowerCase().includes(q)) return false;
        if (filter !== 'all') {
          const state = metrics.get(r.fullName);
          if (state?.status !== 'ready') return false;
          const p = state.data;
          if (filter === 'stale') return p.isStale;
          if (filter === 'healthy') return p.signals.includes('healthy');
          if (filter === 'unhealthy') {
            return p.signals.some((s) => s === 'bus-factor-risk' || s === 'deploy-failures' || s === 'review-backlog' || s === 'no-deploys' || s === 'low-activity' || s === 'stale');
          }
        }
        return true;
      });
  }, [list, search, filter, metrics]);

  const sortedRows = useMemo(() => {
    // Loading and error rows sort to the end so the user sees ready data first.
    const arr = [...filteredRows];
    const dir = sortDesc ? -1 : 1;
    const stateOf = (r: ProjectListing): MetricState | undefined => metrics.get(r.fullName);
    arr.sort((a, b) => {
      const sa = stateOf(a);
      const sb = stateOf(b);
      const aReady = sa?.status === 'ready';
      const bReady = sb?.status === 'ready';
      if (aReady && !bReady) return -1;
      if (!aReady && bReady) return 1;
      if (!aReady && !bReady) return a.repo.localeCompare(b.repo);
      const pa = (sa as { status: 'ready'; data: ProjectMetrics }).data;
      const pb = (sb as { status: 'ready'; data: ProjectMetrics }).data;
      switch (sortKey) {
        case 'name':         return a.repo.localeCompare(b.repo) * (sortDesc ? -1 : 1) * -1;
        case 'activity':     return dir * ((pb.daysSinceActivity ?? 9999) - (pa.daysSinceActivity ?? 9999));
        case 'commits':      return dir * (pa.commits30d - pb.commits30d);
        case 'contributors': return dir * (pa.contributors30d - pb.contributors30d);
        case 'deploys':      return dir * (pa.deploys30d.total - pb.deploys30d.total);
        case 'success':      return dir * ((pa.deploySuccessRate30d ?? -1) - (pb.deploySuccessRate30d ?? -1));
      }
    });
    return arr;
  }, [filteredRows, sortKey, sortDesc, metrics]);

  const summary = useMemo(() => {
    if (!list) return null;
    const total = list.total;
    const archived = list.excludedArchived;
    const ready = readyRepos.length;
    const stale = readyRepos.filter(({ data }) => data.isStale).length;
    const unhealthy = readyRepos.filter(({ data }) =>
      data.signals.some((s) => s === 'bus-factor-risk' || s === 'deploy-failures' || s === 'review-backlog')
    ).length;
    const healthy = readyRepos.filter(({ data }) => data.signals.includes('healthy')).length;
    return { total, ready, healthy, unhealthy, stale, archived };
  }, [list, readyRepos]);

  const refresh = useCallback(() => { void fetchAll(); }, [fetchAll]);
  const fanoutBusy = !!list && readyRepos.length < list.repos.length && !listLoading;

  return (
    <div className="space-y-6">
      <PageHeader title="Project Health" onRefresh={refresh} refreshing={listLoading || fanoutBusy} />

      <div className="rounded-2xl border border-slate-200/60 bg-white/40 px-5 py-4 text-sm text-zinc-600 backdrop-blur dark:border-white/10 dark:bg-zinc-900/30 dark:text-zinc-300">
        <p className="font-semibold text-zinc-900 dark:text-white">What this page shows</p>
        <p className="mt-1 leading-relaxed">
          Per-repository signals over the <strong>last 30 days</strong>, derived from GitHub activity (commits, pull requests, workflow runs)
          and AWS catalog linkage. Use it to spot projects that need help (high activity / low contributors), broken pipelines (deploy failures),
          stale projects worth archiving, and review backlogs slowing the team down. Archived repos are excluded. Each row loads independently — click for full detail.
        </p>
      </div>

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <Stat label="Active projects" value={summary.total} sublabel={summary.ready < summary.total ? `${summary.ready} loaded` : undefined} />
          <Stat label="Healthy" value={summary.healthy} accent="emerald" />
          <Stat label="Need attention" value={summary.unhealthy} accent="rose" />
          <Stat label="Stale" value={summary.stale} accent="amber" />
          <Stat label="Archived (excluded)" value={summary.archived} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by repo or language…"
            className="w-full pl-10 pr-3 py-2 text-sm rounded-xl border border-slate-200 bg-white dark:bg-zinc-900 dark:border-white/10 dark:text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
          />
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-zinc-900/40 backdrop-blur p-1">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
                filter === opt.value
                  ? 'bg-cyan-500 text-white shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Sort:</label>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="px-2 py-1 text-xs rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-zinc-900 dark:text-white"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>{SORT_LABELS[k]}</option>
            ))}
          </select>
          <button
            onClick={() => setSortDesc(!sortDesc)}
            className="px-2 py-1 text-xs rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-zinc-900 dark:text-white hover:bg-slate-50 dark:hover:bg-zinc-800"
            title={sortDesc ? 'Descending' : 'Ascending'}
          >
            {sortDesc ? '↓' : '↑'}
          </button>
        </div>
        {fanoutBusy && summary && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-zinc-500">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading {summary.total - summary.ready} of {summary.total} projects…
          </span>
        )}
      </div>

      {listError && (
        <div className="rounded-2xl border border-rose-300 bg-rose-50 dark:bg-rose-950/20 dark:border-rose-500/30 p-6 text-rose-700 dark:text-rose-400 text-sm">
          {listError}
        </div>
      )}

      {listLoading && !list ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 rounded-2xl bg-zinc-100 dark:bg-zinc-800/40 animate-pulse" />
          ))}
        </div>
      ) : list ? (
        <div className="rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur shadow-xl shadow-slate-200/20 dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40 overflow-hidden">
          <table className="min-w-full divide-y divide-slate-200 dark:divide-white/5">
            <thead className="bg-slate-50/80 dark:bg-zinc-900">
              <tr className="text-left text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                <th className="px-5 py-3">Project</th>
                <th className="px-5 py-3">Signals</th>
                <th className="px-5 py-3 text-right">Activity · 30d</th>
                <th className="px-5 py-3">Contributors · 30d</th>
                <th className="px-5 py-3">Deploys · 30d</th>
                <th className="px-5 py-3">Top deployer</th>
                <th className="px-5 py-3 text-right">Last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {sortedRows.map((r) => {
                const state = metrics.get(r.fullName) ?? { status: 'loading' as const };
                return <ProjectRow key={r.fullName} listing={r} state={state} onClick={() => {
                  if (state.status === 'ready') setDrawerProject(state.data);
                }} />;
              })}
              {sortedRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-zinc-400">
                    No projects match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {list && (
        <p className="text-[10px] text-zinc-400 text-right">
          List generated {new Date(list.generatedAt).toLocaleString()} · per-repo metrics cached 5 min server-side.
        </p>
      )}

      <ProjectDetailDrawer
        open={!!drawerProject}
        project={drawerProject}
        onClose={() => setDrawerProject(null)}
      />
    </div>
  );
}

function ProjectRow({ listing, state, onClick }: { listing: ProjectListing; state: MetricState; onClick: () => void }) {
  const isStale = state.status === 'ready' && state.data.isStale;
  return (
    <tr
      onClick={state.status === 'ready' ? onClick : undefined}
      className={clsx(
        'hover:bg-slate-50 dark:hover:bg-white/5',
        state.status === 'ready' && 'cursor-pointer',
        isStale && 'opacity-70',
      )}
    >
      <td className="px-5 py-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-sm font-semibold text-cyan-600 dark:text-cyan-400 inline-flex items-center gap-1">
            {listing.repo}
            <a
              href={listing.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="hover:text-cyan-700"
              title="Open in GitHub"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          </span>
          <div className="flex items-center gap-2 text-[10px] text-zinc-400">
            {listing.language && <span className="font-mono">{listing.language}</span>}
            {listing.linkedServiceCount > 0 && (
              <Link
                to="/catalog"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-cyan-500 hover:text-cyan-600"
              >
                · {listing.linkedServiceCount} service{listing.linkedServiceCount === 1 ? '' : 's'}
              </Link>
            )}
          </div>
        </div>
      </td>
      <RowCells state={state} />
    </tr>
  );
}

function RowCells({ state }: { state: MetricState }) {
  if (state.status === 'loading') {
    return (
      <>
        <td className="px-5 py-3"><div className="h-3 w-24 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" /></td>
        <td className="px-5 py-3 text-right"><div className="h-3 w-12 ml-auto bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" /></td>
        <td className="px-5 py-3"><div className="h-3 w-20 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" /></td>
        <td className="px-5 py-3"><div className="h-3 w-24 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" /></td>
        <td className="px-5 py-3"><div className="h-3 w-24 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" /></td>
        <td className="px-5 py-3 text-right"><Loader2 className="h-3 w-3 ml-auto text-zinc-400 animate-spin" /></td>
      </>
    );
  }
  if (state.status === 'error') {
    return (
      <>
        <td colSpan={6} className="px-5 py-3 text-xs text-rose-600 dark:text-rose-400">
          Failed to load metrics: {state.message}
        </td>
      </>
    );
  }
  const p = state.data;
  return (
    <>
      <td className="px-5 py-3">
        <div className="flex flex-wrap gap-1 max-w-md">
          {p.signals.length === 0 ? (
            <span className="text-[10px] text-zinc-400 italic">no notable signals</span>
          ) : (
            p.signals.map((s) => <SignalChip key={s} signal={s} />)
          )}
        </div>
      </td>
      <td className="px-5 py-3 text-right">
        <div className="flex flex-col items-end">
          <span className="text-sm font-bold text-zinc-900 dark:text-white">{p.commits30d}</span>
          <span className="text-[10px] text-zinc-400 inline-flex items-center gap-1">
            <GitBranch className="h-3 w-3" /> commits · {p.mergedPrs30d} merged
          </span>
        </div>
      </td>
      <td className="px-5 py-3">
        <div className="flex flex-col">
          <span className="text-sm font-bold text-zinc-900 dark:text-white inline-flex items-center gap-1">
            <Users className="h-3 w-3 text-zinc-400" /> {p.contributors30d}
          </span>
          {p.topContributor && (
            <span className="text-[10px] text-zinc-400 truncate max-w-[160px]" title={p.topContributors.map((c) => `${c.login} (${c.count})`).join(', ')}>
              top: <span className="font-mono text-zinc-500 dark:text-zinc-400">{p.topContributor.login}</span>
            </span>
          )}
        </div>
      </td>
      <td className="px-5 py-3">
        <div className="flex flex-col">
          <span className="text-sm font-bold text-zinc-900 dark:text-white inline-flex items-center gap-1">
            <Rocket className="h-3 w-3 text-zinc-400" /> {p.deploys30d.total}
          </span>
          <span className="text-[10px] text-zinc-400">
            prod {p.deploys30d.production} · dev {p.deploys30d.development}
            {p.deploySuccessRate30d !== null && ` · ${p.deploySuccessRate30d}% ok`}
          </span>
        </div>
      </td>
      <td className="px-5 py-3">
        {p.topDeployer.production || p.topDeployer.development ? (
          <div className="flex flex-col gap-0.5">
            {p.topDeployer.production && (
              <div className="text-[10px]">
                <span className="font-bold text-emerald-600 dark:text-emerald-400 mr-1">PROD</span>
                <span className="font-mono text-zinc-700 dark:text-zinc-300">{p.topDeployer.production.login}</span>
                <span className="text-zinc-400"> ({p.topDeployer.production.count})</span>
              </div>
            )}
            {p.topDeployer.development && (
              <div className="text-[10px]">
                <span className="font-bold text-amber-600 dark:text-amber-400 mr-1">DEV</span>
                <span className="font-mono text-zinc-700 dark:text-zinc-300">{p.topDeployer.development.login}</span>
                <span className="text-zinc-400"> ({p.topDeployer.development.count})</span>
              </div>
            )}
          </div>
        ) : p.topDeployer.overall ? (
          <div className="text-[10px]">
            <span className="font-mono text-zinc-700 dark:text-zinc-300">{p.topDeployer.overall.login}</span>
            <span className="text-zinc-400"> ({p.topDeployer.overall.count})</span>
          </div>
        ) : (
          <span className="text-zinc-400 text-xs">—</span>
        )}
      </td>
      <td className="px-5 py-3 text-right">
        <span className={clsx('text-xs', p.isStale ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-zinc-500')}>
          {relativeDays(p.daysSinceActivity)}
        </span>
      </td>
    </>
  );
}

function Stat({ label, value, sublabel, accent }: { label: string; value: number; sublabel?: string; accent?: 'emerald' | 'rose' | 'amber' }) {
  const accentClasses = accent === 'emerald'
    ? 'text-emerald-600 dark:text-emerald-400'
    : accent === 'rose'
      ? 'text-rose-600 dark:text-rose-400'
      : accent === 'amber'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-zinc-900 dark:text-white';
  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white/60 px-5 py-4 shadow-xl shadow-slate-200/20 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className={clsx('mt-1 text-2xl font-bold', accentClasses)}>{value}</p>
      {sublabel && <p className="text-[10px] text-zinc-400 mt-0.5">{sublabel}</p>}
    </div>
  );
}
