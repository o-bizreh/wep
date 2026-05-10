import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DataTable, FilterPanel, Badge, StatusIndicator, PageHeader, Spinner, type Column } from '@wep/ui';
import {
  ChevronLeft, ChevronRight, CheckCircle2, AlertTriangle, HelpCircle,
  Server, Github, Cloud, Loader2,
} from 'lucide-react';
import { catalogApi, type SyncStatus } from '../../lib/api';
import { useServices } from '../../lib/ServicesContext';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Service {
  serviceId: string;
  serviceName: string;
  repositoryUrl: string;
  runtimeType: string;
  ownerTeam: { teamId: string; teamName: string };
  environments: string[];
  healthStatus: { status: string };
  awsEnriched: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

/** How often to refresh services + status depending on sync phase */
function pollInterval(phase: SyncStatus['phase'] | undefined): number {
  if (phase === 'fetching-repos') return 800;   // rows appear as pages land in DynamoDB
  if (phase === 'aws-enrichment') return 1_500; // health columns fill in
  return 0; // idle / done / error — no polling
}

const ENV_LABEL: Record<string, string> = {
  production: 'Production',
  development: 'Development',
  staging: 'Staging',
};

// ── Progress banner ───────────────────────────────────────────────────────────

function SyncBanner({ status }: { status: SyncStatus }) {
  const { phase, reposSaved, awsEnriched, awsTotal, message, error } = status;

  if (phase === 'idle' || phase === 'done') return null;
  if (phase === 'error') {
    return (
      <div className="mb-4 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>Sync failed: {error}</span>
      </div>
    );
  }

  const isGitHub = phase === 'fetching-repos';
  const isAws = phase === 'aws-enrichment';
  const Icon = isGitHub ? Github : Cloud;

  const percent = isAws && awsTotal > 0
    ? Math.round((awsEnriched / awsTotal) * 100)
    : null;

  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-blue-100 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-950/20">
      {/* Progress bar */}
      <div className="h-0.5 bg-blue-100 dark:bg-blue-900/40">
        <div
          className="h-full bg-blue-500 transition-all duration-500"
          style={{ width: percent !== null ? `${percent}%` : '100%', opacity: percent === null ? 0.4 : 1 }}
        />
      </div>

      <div className="flex items-center gap-3 px-4 py-2.5">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600 dark:text-blue-400" />
        <Icon className="h-4 w-4 shrink-0 text-blue-500 dark:text-blue-400" />
        <span className="flex-1 text-sm text-blue-700 dark:text-blue-300">{message}</span>

        {isGitHub && reposSaved > 0 && (
          <span className="shrink-0 rounded-md bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            {reposSaved} saved
          </span>
        )}
        {isAws && awsTotal > 0 && (
          <span className="shrink-0 rounded-md bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            {awsEnriched} / {awsTotal}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Table columns ─────────────────────────────────────────────────────────────

const columns: Column<Service>[] = [
  {
    key: 'name',
    header: 'Service',
    render: (s) => (
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-zinc-100 to-zinc-200 shadow-sm dark:from-zinc-800 dark:to-zinc-900 border border-zinc-200/50 dark:border-white/5">
          <Server className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
        </div>
        <span className="font-bold text-zinc-900 dark:text-white group-hover:text-cyan-600 transition-colors">{s.serviceName}</span>
      </div>
    ),
  },
  {
    key: 'team',
    header: 'Owner',
    render: (s) => <span className="text-gray-600 dark:text-gray-400">{s.ownerTeam.teamName}</span>,
  },
  {
    key: 'runtime',
    header: 'Runtime',
    render: (s) => <Badge variant="runtime" value={s.runtimeType} />,
  },
  {
    key: 'environments',
    header: 'Environments',
    render: (s) => {
      if (!s.awsEnriched) return <Spinner size="sm" />;
      if (!s.environments.length) return <span className="text-gray-300 dark:text-gray-600">—</span>;
      return (
        <div className="flex gap-1">
          {s.environments.map((e) => (
            <Badge key={e} variant="environment" value={e}>{ENV_LABEL[e] ?? e}</Badge>
          ))}
        </div>
      );
    },
  },
  {
    key: 'health',
    header: 'Health',
    render: (s) =>
      !s.awsEnriched ? <Spinner size="sm" /> : <StatusIndicator status={s.healthStatus.status} />,
  },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { setFromExternal } = useServices();
  const [allServices, setAllServices] = useState<Service[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [healthFilter, setHealthFilter] = useState<'healthy' | 'degraded' | 'unknown' | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseRef = useRef<SyncStatus['phase'] | undefined>(undefined);

  const query       = searchParams.get('query') ?? '';
  const teamId      = searchParams.get('teamId') ?? '';
  const environment = searchParams.get('environment') ?? '';
  const page        = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));

  // ── Fetch helpers ───────────────────────────────────────────────────────────

  const fetchServices = useCallback(async () => {
    try {
      const params: Record<string, string> = { limit: '500' };
      if (query)       params['query']       = query;
      if (teamId)      params['teamId']      = teamId;
      if (environment) params['environment'] = environment;
      const result = await catalogApi.listServices(params);
      setAllServices(result.items as Service[]);
      return result.items.length;
    } catch (err) {
      console.error('Failed to fetch services:', err);
      return 0;
    }
  }, [query, teamId, environment]);

  const fetchSyncStatus = useCallback(async () => {
    try {
      const s = await catalogApi.syncStatus();
      setSyncStatus(s);
      return s;
    } catch {
      return null;
    }
  }, []);

  // ── Adaptive polling loop ────────────────────────────────────────────────────
  //
  // A single self-scheduling timeout that runs both fetches together and
  // adjusts its interval based on the current sync phase:
  //   fetching-repos  → 800 ms   (rows appear as DynamoDB pages land)
  //   aws-enrichment  → 1 500 ms (health columns fill in)
  //   idle/done/error → stops    (no background traffic)

  const stopPolling = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const scheduleNextTick = useCallback((phase: SyncStatus['phase'] | undefined) => {
    stopPolling();
    const ms = pollInterval(phase);
    if (!ms) return; // nothing to do
    timerRef.current = setTimeout(async () => {
      const [, status] = await Promise.all([fetchServices(), fetchSyncStatus()]);
      const nextPhase = status?.phase;
      phaseRef.current = nextPhase;

      if (nextPhase === 'done' || nextPhase === 'error') {
        setSyncing(false);
        await fetchServices(); // final flush
        return;
      }
      scheduleNextTick(nextPhase);
    }, ms);
  }, [fetchServices, fetchSyncStatus, stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // Publish to shared context whenever the list is updated (during sync polling too)
  useEffect(() => { setFromExternal(allServices); }, [allServices, setFromExternal]);

  // ── Initial load — also auto-resumes polling if a sync is already running ───

  useEffect(() => {
    let cancelled = false;
    setLoadingInitial(true);

    (async () => {
      const [serviceCount, status] = await Promise.all([fetchServices(), fetchSyncStatus()]);
      if (cancelled) return;
      setLoadingInitial(false);

      const phase = status?.phase;
      phaseRef.current = phase;

      if (phase === 'fetching-repos' || phase === 'aws-enrichment') {
        // Sync already running in another tab — resume polling
        setSyncing(true);
        scheduleNextTick(phase);
      } else if (serviceCount === 0) {
        // Empty table, no sync running — auto-start so data appears immediately
        setSyncing(true);
        try { await catalogApi.sync(); } catch { /* 202 is not an error */ }
        const freshStatus = await fetchSyncStatus();
        const freshPhase = freshStatus?.phase ?? 'fetching-repos';
        phaseRef.current = freshPhase;
        scheduleNextTick(freshPhase);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount only

  // Re-fetch services when filters change (without restarting the poll loop)
  useEffect(() => {
    if (!loadingInitial) fetchServices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, teamId, environment]);

  // ── Trigger sync ─────────────────────────────────────────────────────────────

  const handleRefresh = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);

    try {
      await catalogApi.sync();
    } catch {
      // 202 is not an error; swallow network errors too
    }

    // Give the server 300ms to flip its phase, then start the adaptive loop
    setTimeout(async () => {
      const status = await fetchSyncStatus();
      const phase = status?.phase ?? 'fetching-repos';
      phaseRef.current = phase;
      scheduleNextTick(phase);
    }, 300);
  }, [syncing, fetchSyncStatus, scheduleNextTick]);

  // ── Filtering + pagination ────────────────────────────────────────────────────

  const filteredServices = useMemo(() => {
    if (!healthFilter) return allServices;
    if (healthFilter === 'healthy')  return allServices.filter((s) => s.awsEnriched && s.healthStatus.status === 'healthy');
    if (healthFilter === 'degraded') return allServices.filter((s) => s.awsEnriched && s.healthStatus.status === 'degraded');
    return allServices.filter((s) => !s.awsEnriched || s.healthStatus.status === 'unknown');
  }, [allServices, healthFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredServices.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const pageItems  = useMemo(
    () => filteredServices.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredServices, safePage],
  );

  const pageNumbers = useMemo(() => {
    const pages: (number | '…')[] = [];
    for (let p = 1; p <= totalPages; p++) {
      if (p === 1 || p === totalPages || Math.abs(p - safePage) <= 2) {
        if (pages.length && (pages[pages.length - 1] as number) < p - 1) pages.push('…');
        pages.push(p);
      }
    }
    return pages;
  }, [totalPages, safePage]);

  const setPage = (p: number) => {
    const params = new URLSearchParams(searchParams);
    params.set('page', String(p));
    setSearchParams(params);
  };

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete('page');
    setSearchParams(params);
  };

  // ── Health stats ─────────────────────────────────────────────────────────────

  const enriched = useMemo(() => allServices.filter((s) => s.awsEnriched), [allServices]);
  const healthStats = useMemo(() => ({
    healthy:  enriched.filter((s) => s.healthStatus.status === 'healthy').length,
    degraded: enriched.filter((s) => s.healthStatus.status === 'degraded').length,
    unknown:  enriched.filter((s) => s.healthStatus.status === 'unknown').length,
  }), [enriched]);

  const activePhase = syncStatus?.phase;
  const isSyncRunning = syncing ||
    activePhase === 'fetching-repos' ||
    activePhase === 'aws-enrichment';

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div>
      <PageHeader
        title="Catalog"
        onRefresh={handleRefresh}
        refreshing={isSyncRunning || loadingInitial}
      />

      {/* Sync progress banner */}
      {syncStatus && <SyncBanner status={syncStatus} />}

      {/* Health stat cards — clickable to filter the table */}
      {!loadingInitial && allServices.length > 0 && (
        <div className="mb-5 grid grid-cols-4 gap-3">
          {(
            [
              {
                key: null,
                label: 'Total',
                value: allServices.length,
                icon: <Server className="h-4 w-4" />,
                iconColor: 'text-gray-500 bg-gray-100 dark:bg-gray-800',
                activeRing: 'ring-gray-400',
              },
              {
                key: 'healthy' as const,
                label: 'Healthy',
                value: healthStats.healthy,
                icon: <CheckCircle2 className="h-4 w-4" />,
                iconColor: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30',
                activeRing: 'ring-emerald-500',
              },
              {
                key: 'degraded' as const,
                label: 'Degraded',
                value: healthStats.degraded,
                icon: <AlertTriangle className="h-4 w-4" />,
                iconColor: 'text-amber-600 bg-amber-50 dark:bg-amber-950/30',
                activeRing: 'ring-amber-500',
              },
              {
                key: 'unknown' as const,
                label: 'Unknown',
                value: healthStats.unknown,
                icon: <HelpCircle className="h-4 w-4" />,
                iconColor: 'text-gray-400 bg-gray-50 dark:bg-gray-800/50',
                activeRing: 'ring-gray-400',
              },
            ] as const
          ).map((stat) => {
            const isActive = healthFilter === stat.key;
            return (
              <button
                key={stat.label}
                type="button"
                onClick={() => {
                  setHealthFilter(isActive ? null : stat.key);
                  // Reset to page 1 when filter changes
                  const params = new URLSearchParams(searchParams);
                  params.delete('page');
                  setSearchParams(params);
                }}
                className={`flex w-full items-center gap-3 rounded-2xl border bg-white/60 backdrop-blur-xl px-4 py-4 shadow-sm transition-all dark:bg-zinc-900/40 hover:-translate-y-0.5 ${
                  isActive
                    ? `ring-2 ${stat.activeRing} border-transparent shadow-lg shadow-${stat.activeRing.split('-')[1]}-500/20`
                    : 'border-slate-200/60 hover:border-cyan-500/30 hover:shadow-xl dark:border-white/10 dark:hover:border-cyan-500/30'
                }`}
              >
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${stat.iconColor}`}>
                  {stat.icon}
                </div>
                <div className="text-left">
                  <p className="text-xl font-bold text-gray-900 dark:text-white">{stat.value}</p>
                  <p className="text-xs text-gray-400">{stat.label}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <div className="mb-4">
        <FilterPanel
          searchValue={query}
          onSearchChange={(v) => updateFilter('query', v)}
          searchPlaceholder="Search services…"
          filters={[
            {
              key: 'environment',
              label: 'Environment',
              options: [
                { label: 'Production',  value: 'production'  },
                { label: 'Staging',     value: 'staging'     },
                { label: 'Development', value: 'development' },
              ],
            },
          ]}
          values={{ environment }}
          onFilterChange={updateFilter}
        />
      </div>

      {/* Table with live count header */}
      <div>
        {/* Table sub-header: count + enrichment progress */}
        {!loadingInitial && allServices.length > 0 && (
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {healthFilter ? (
                <>
                  <span>{filteredServices.length} of {allServices.length} services</span>
                  <button
                    type="button"
                    onClick={() => setHealthFilter(null)}
                    className="ml-2 text-blue-500 hover:underline"
                  >
                    Clear filter
                  </button>
                </>
              ) : (
                <>{allServices.length} {allServices.length === 1 ? 'service' : 'services'}</>
              )}
              {enriched.length < allServices.length && (
                <span className="ml-2 text-gray-400">
                  · {enriched.length} enriched with AWS
                  {isSyncRunning && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />}
                </span>
              )}
            </p>
            {isSyncRunning && syncStatus?.phase === 'fetching-repos' && (
              <p className="text-xs text-blue-500 dark:text-blue-400">
                Live — updating as repos are discovered
              </p>
            )}
          </div>
        )}

        <DataTable
          columns={columns}
          data={pageItems}
          loading={loadingInitial}
          keyExtractor={(s) => s.serviceId}
          getRowHref={(s) => `/catalog/services/${s.serviceId}`}
          emptyMessage={
            isSyncRunning
              ? 'Syncing — services will appear as they are discovered…'
              : 'No services found — click Refresh to sync from GitHub'
          }
        />
      </div>

      {/* Pagination */}
      {!loadingInitial && allServices.length > 0 && (
        <div className="mt-4 flex items-center justify-between pt-3">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Page {safePage} of {totalPages}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(safePage - 1)}
              disabled={safePage <= 1}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-gray-800"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {pageNumbers.map((p, i) =>
              p === '…' ? (
                <span key={`e-${i}`} className="px-2 text-gray-300 dark:text-gray-600">…</span>
              ) : (
                <button
                  key={p}
                  onClick={() => setPage(p as number)}
                  className={`min-w-[2rem] rounded-lg px-2 py-1 text-sm font-medium transition-colors ${
                    p === safePage
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
                  }`}
                >
                  {p}
                </button>
              ),
            )}
            <button
              onClick={() => setPage(safePage + 1)}
              disabled={safePage >= totalPages}
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
