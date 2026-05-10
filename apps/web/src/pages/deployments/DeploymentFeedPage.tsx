import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { FilterPanel, PageHeader, Spinner } from '@wep/ui';
import {
  CheckCircle2, XCircle, Clock, MinusCircle, RotateCcw,
  ExternalLink, ChevronLeft, ChevronRight, Search, Settings2, RefreshCw,
} from 'lucide-react';
import { catalogApi } from '../../lib/api';
import { useServices } from '../../lib/ServicesContext';

// ── Types ─────────────────────────────────────────────────────────────────────

type FeedItem = Awaited<ReturnType<typeof catalogApi.getDeploymentFeed>>['items'][number];

interface ServiceOption {
  serviceId: string;
  serviceName: string;
  repositoryUrl: string;
  ownerTeam?: { teamName: string };
  topics?: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function dateLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

const CONCLUSION_STYLE: Record<string, { icon: React.ReactNode; classes: string }> = {
  success:     { icon: <CheckCircle2 className="h-4 w-4" />, classes: 'text-emerald-600 dark:text-emerald-400' },
  failure:     { icon: <XCircle      className="h-4 w-4" />, classes: 'text-red-600 dark:text-red-400' },
  cancelled:   { icon: <MinusCircle  className="h-4 w-4" />, classes: 'text-gray-400 dark:text-gray-500' },
  timed_out:   { icon: <Clock        className="h-4 w-4" />, classes: 'text-amber-600 dark:text-amber-400' },
  skipped:     { icon: <RotateCcw    className="h-4 w-4" />, classes: 'text-gray-400 dark:text-gray-500' },
  in_progress: { icon: <Clock        className="h-4 w-4" />, classes: 'text-blue-600 dark:text-blue-400' },
};

function StatusIcon({ conclusion, status }: { conclusion: string | null; status: string }) {
  const key = conclusion ?? (status === 'in_progress' ? 'in_progress' : 'in_progress');
  const cfg = CONCLUSION_STYLE[key] ?? CONCLUSION_STYLE['in_progress']!;
  return <span className={cfg.classes}>{cfg.icon}</span>;
}

// ── Repo picker ───────────────────────────────────────────────────────────────

function RepoPicker({
  services,
  currentWatched,
  onSave,
  saving,
}: {
  services: ServiceOption[];
  currentWatched: string[];
  onSave: (ids: string[]) => void;
  saving: boolean;
}) {
  const [selected, setSelected]   = useState<Set<string>>(new Set(currentWatched));
  const [search, setSearch]       = useState('');
  const [teamFilter, setTeamFilter] = useState('');

  const teams = useMemo(() => {
    const set = new Set<string>();
    for (const s of services) if (s.ownerTeam?.teamName) set.add(s.ownerTeam.teamName);
    return [...set].sort();
  }, [services]);

  const filtered = useMemo(() => {
    return services.filter((s) => {
      const matchSearch = !search || s.serviceName.toLowerCase().includes(search.toLowerCase());
      const matchTeam   = !teamFilter || s.ownerTeam?.teamName === teamFilter;
      return matchSearch && matchTeam;
    });
  }, [services, search, teamFilter]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Choose repos to monitor</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Select the repositories whose deployments you want to track here. Your selection is saved to your AWS identity.
        </p>
      </div>

      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search repos…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-800 placeholder-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
          />
        </div>
        {teams.length > 0 && (
          <select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white py-2 pl-3 pr-8 text-sm text-gray-700 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
          >
            <option value="">All teams</option>
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <span className="text-sm text-gray-400">{selected.size} selected</span>
      </div>

      {/* Repo list */}
      <div className="mb-5 divide-y divide-slate-100/50 dark:divide-white/5 overflow-hidden rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/20 backdrop-blur-xl bg-white/60 dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40">
        {filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-400">No repos match your search.</p>
        )}
        {filtered.map((svc) => (
          <label
            key={svc.serviceId}
            className="flex cursor-pointer items-center gap-4 px-5 py-4 transition-colors hover:bg-white dark:hover:bg-zinc-800/50"
          >
            <input
              type="checkbox"
              checked={selected.has(svc.serviceId)}
              onChange={() => toggle(svc.serviceId)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{svc.serviceName}</p>
              {svc.ownerTeam?.teamName && (
                <p className="text-xs text-gray-400 dark:text-gray-500">{svc.ownerTeam.teamName}</p>
              )}
            </div>
            <a
              href={svc.repositoryUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex-shrink-0 text-gray-300 hover:text-gray-600 dark:text-gray-600 dark:hover:text-gray-300"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </label>
        ))}
      </div>

      <button
        onClick={() => onSave([...selected])}
        disabled={selected.size === 0 || saving}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saving ? <Spinner size="sm" /> : null}
        Watch {selected.size} repo{selected.size !== 1 ? 's' : ''}
      </button>
    </div>
  );
}

// ── Feed view ─────────────────────────────────────────────────────────────────

export function DeploymentFeedPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Shared services cache — populated by CatalogPage if visited first,
  // otherwise fetched here on demand.
  const { services: contextServices, ensureLoaded, loading: servicesLoading } = useServices();

  // Preferences state
  const [watchedRepos, setWatchedRepos]   = useState<string[] | null>(null); // null = loading
  const [prefsLoading, setPrefsLoading]   = useState(true);
  const [saving, setSaving]               = useState(false);
  const [showPicker, setShowPicker]       = useState(false);

  // Feed state
  const [feedData, setFeedData]         = useState<Awaited<ReturnType<typeof catalogApi.getDeploymentFeed>> | null>(null);
  const [feedLoading, setFeedLoading]   = useState(false);
  const [feedPage, setFeedPage]         = useState(1);

  const environment = searchParams.get('environment') ?? '';

  // Trigger services load (no-op if CatalogPage already loaded them)
  useEffect(() => { ensureLoaded(); }, [ensureLoaded]);

  // Load preferences on mount
  useEffect(() => {
    setPrefsLoading(true);
    catalogApi.getDeploymentPreferences()
      .then((prefs) => setWatchedRepos(prefs.watchedRepos))
      .catch(() => setWatchedRepos([]))
      .finally(() => setPrefsLoading(false));
  }, []);

  const fetchFeed = useCallback(async (page: number) => {
    setFeedLoading(true);
    try {
      const result = await catalogApi.getDeploymentFeed({
        page,
        ...(environment ? { environment } : {}),
      });
      setFeedData(result);
      setFeedPage(page);
    } catch (err) {
      console.error('Failed to fetch deployment feed:', err);
    } finally {
      setFeedLoading(false);
    }
  }, [environment]);

  // Fetch feed once preferences are known and user has watched repos
  useEffect(() => {
    if (watchedRepos && watchedRepos.length > 0) {
      void fetchFeed(1);
    }
  }, [watchedRepos, fetchFeed]);

  const savePreferences = useCallback(async (ids: string[]) => {
    setSaving(true);
    try {
      await catalogApi.saveDeploymentPreferences(ids);
      setWatchedRepos(ids);
      setShowPicker(false);
      if (ids.length > 0) void fetchFeed(1);
    } catch (err) {
      console.error('Failed to save preferences:', err);
    } finally {
      setSaving(false);
    }
  }, [fetchFeed]);

  const groups = useMemo(() => {
    if (!feedData) return [];
    const map = new Map<string, FeedItem[]>();
    for (const item of feedData.items) {
      const label = dateLabel(item.startedAt);
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(item);
    }
    return Array.from(map.entries());
  }, [feedData]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (prefsLoading || servicesLoading) {
    return (
      <div>
        <PageHeader title="Deployments" refreshing />
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      </div>
    );
  }

  // No repos selected yet — show picker
  if (!showPicker && (watchedRepos === null || watchedRepos.length === 0)) {
    return (
      <div>
        <PageHeader title="Deployments" />
        <RepoPicker
          services={contextServices as ServiceOption[]}
          currentWatched={[]}
          onSave={savePreferences}
          saving={saving}
        />
      </div>
    );
  }

  // Picker open (changing selection)
  if (showPicker) {
    return (
      <div>
        <div className="mb-5 flex items-center justify-between">
          <PageHeader title="Deployments" />
          <button
            onClick={() => setShowPicker(false)}
            className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            Cancel
          </button>
        </div>
        <RepoPicker
          services={contextServices as ServiceOption[]}
          currentWatched={watchedRepos ?? []}
          onSave={savePreferences}
          saving={saving}
        />
      </div>
    );
  }

  // Feed view
  const totalPages = feedData ? Math.ceil(feedData.totalItems / feedData.pageSize) : 1;

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <PageHeader title="Deployments" />
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchFeed(feedPage)}
            disabled={feedLoading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${feedLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={() => setShowPicker(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800"
            title="Change monitored repos"
          >
            <Settings2 className="h-4 w-4" />
            {watchedRepos?.length ?? 0} repos
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="mb-5">
        <FilterPanel
          filters={[{
            key: 'environment',
            label: 'Environment',
            options: [
              { label: 'Production',  value: 'production' },
              { label: 'Development', value: 'development' },
            ],
          }]}
          values={{ environment }}
          onFilterChange={(key, value) => {
            const params = new URLSearchParams(searchParams);
            if (value) params.set(key, value); else params.delete(key);
            setSearchParams(params);
          }}
        />
      </div>

      {/* Loading skeleton */}
      {feedLoading && (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-[72px] animate-pulse rounded-2xl border border-slate-200/60 bg-white/60 dark:border-white/10 dark:bg-zinc-900/40 backdrop-blur-xl" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!feedLoading && feedData?.items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="font-medium text-gray-500 dark:text-gray-400">No deployments found</p>
          <p className="mt-1 text-sm text-gray-400">
            {environment ? `No ${environment} deployments for your watched repos.` : 'No deployments yet for your watched repos.'}
          </p>
        </div>
      )}

      {/* Feed */}
      {!feedLoading && groups.map(([label, groupItems]) => (
        <div key={label} className="mb-6">
          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">{label}</p>
          <div className="divide-y divide-slate-100/50 dark:divide-white/5 overflow-hidden rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur-xl shadow-xl shadow-slate-200/20 dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40">
            {groupItems.map((item) => (
              <div
                key={`${item.serviceId}-${item.runId}`}
                className="flex items-center gap-5 px-5 py-4 transition-colors hover:bg-white dark:hover:bg-zinc-800/50"
              >
                <StatusIcon conclusion={item.conclusion} status={item.status} />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/catalog/services/${item.serviceId}`}
                      className="text-sm font-semibold text-gray-800 hover:text-blue-600 dark:text-gray-100 dark:hover:text-blue-400"
                    >
                      {item.serviceName}
                    </Link>
                    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                      item.environment === 'production'
                        ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/30 dark:text-emerald-400'
                        : 'bg-orange-50 text-orange-700 ring-orange-600/20 dark:bg-orange-950/30 dark:text-orange-400'
                    }`}>
                      {item.environment === 'production' ? 'Production' : 'Development'}
                    </span>
                  </div>
                  {item.commitMessage && (
                    <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{item.commitMessage}</p>
                  )}
                </div>

                <div className="hidden min-w-0 flex-col items-end sm:flex">
                  <span className="max-w-[160px] truncate text-xs text-gray-500 dark:text-gray-400">{item.branch}</span>
                  {item.actor && <span className="text-xs text-gray-400 dark:text-gray-500">{item.actor}</span>}
                </div>

                <span className="hidden w-14 text-right text-xs tabular-nums text-gray-400 dark:text-gray-500 md:block">
                  {formatDuration(item.durationSeconds)}
                </span>

                <span className="w-16 text-right text-xs text-gray-400 dark:text-gray-500">
                  {formatRelativeTime(item.startedAt)}
                </span>

                <a
                  href={item.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 text-gray-300 hover:text-gray-600 dark:text-gray-600 dark:hover:text-gray-300"
                  title="Open in GitHub Actions"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Pagination */}
      {!feedLoading && feedData && feedData.totalItems > feedData.pageSize && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-gray-400">
            Page {feedPage} of {totalPages} · {feedData.totalItems} total runs
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => fetchFeed(feedPage - 1)}
              disabled={feedPage <= 1 || feedLoading}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-gray-800"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => fetchFeed(feedPage + 1)}
              disabled={!feedData.hasMore || feedLoading}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-gray-800"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
