import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@wep/ui';
import { catalogApi, fetchApi } from '../../lib/api';

type PromotionService = {
  serviceId: string;
  serviceName: string;
  ownerTeam: { teamId: string; teamName: string };
  runtimeType: string;
  environments: string[];
  lastSyncedAt: string;
};

type EnvDeployment = {
  branch: string | null;
  actor: string | null;
  completedAt: string;
  htmlUrl: string;
};

type DeploymentData = {
  environments: Record<string, EnvDeployment>;
};

const ENV_CLASSES: Record<string, string> = {
  production:  'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/30 dark:text-emerald-400',
  development: 'bg-orange-50 text-orange-700 ring-orange-600/20 dark:bg-orange-950/30 dark:text-orange-400',
  staging:     'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950/30 dark:text-amber-400',
};

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function isPromotionPending(envData: Record<string, EnvDeployment>): boolean {
  const devEnv = envData['development'] ?? envData['staging'];
  const prodEnv = envData['production'];
  if (!devEnv || !prodEnv) return false;
  return new Date(devEnv.completedAt) > new Date(prodEnv.completedAt);
}

function hasNoProdDeployment(envData: Record<string, EnvDeployment>): boolean {
  const devEnv = envData['development'] ?? envData['staging'];
  const prodEnv = envData['production'];
  return !!devEnv && !prodEnv;
}

// Fetch deployment data for a batch of service IDs concurrently, updating cache via callback.
async function prefetchBatch(
  ids: string[],
  abortSignal: AbortSignal,
  onResult: (id: string, data: DeploymentData) => void,
): Promise<void> {
  await Promise.allSettled(
    ids.map(async (id) => {
      if (abortSignal.aborted) return;
      try {
        const data = await fetchApi<DeploymentData>(`/catalog/services/${id}/last-deployments`);
        if (!abortSignal.aborted) onResult(id, data);
      } catch {
        if (!abortSignal.aborted) onResult(id, { environments: {} });
      }
    }),
  );
}

const PAGE_SIZE = 20;
const PREFETCH_CONCURRENCY = 5;

type FilterMode = 'all' | 'promotion-ready' | 'deployed' | 'never-deployed';

export function PromotionTrackerPage() {
  const [services, setServices] = useState<PromotionService[]>([]);
  const [loading, setLoading] = useState(true);
  const [prefetching, setPrefetching] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [page, setPage] = useState(1);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [deploymentCache, setDeploymentCache] = useState<Map<string, DeploymentData>>(new Map());
  const [loadingDeployments, setLoadingDeployments] = useState<Set<string>>(new Set());
  const prefetchAbort = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setPage(1);
    // Cancel any in-flight prefetch from a previous load
    prefetchAbort.current?.abort();
    catalogApi.getPromotionServices()
      .then((data) => setServices(data.services))
      .catch(() => setServices([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // After services are loaded, background-prefetch all deployment data in batches.
  // This populates "Promotion pending" badges without waiting for user clicks.
  useEffect(() => {
    if (services.length === 0) return;

    prefetchAbort.current?.abort();
    const ctrl = new AbortController();
    prefetchAbort.current = ctrl;

    // Reset cache on a fresh load so stale data from a previous refresh is cleared.
    setDeploymentCache(new Map());
    setPrefetching(true);

    (async () => {
      for (let i = 0; i < services.length; i += PREFETCH_CONCURRENCY) {
        if (ctrl.signal.aborted) break;
        const batch = services.slice(i, i + PREFETCH_CONCURRENCY).map((s) => s.serviceId);
        await prefetchBatch(batch, ctrl.signal, (id, data) => {
          setDeploymentCache((prev) => new Map(prev).set(id, data));
        });
      }
      if (!ctrl.signal.aborted) setPrefetching(false);
    })();

    return () => { ctrl.abort(); };
  }, [services]);

  function toggleRow(serviceId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) {
        next.delete(serviceId);
      } else {
        next.add(serviceId);
        // If prefetch hasn't reached this service yet, fetch it immediately on expand.
        if (!deploymentCache.has(serviceId)) {
          setLoadingDeployments((ld) => new Set(ld).add(serviceId));
          fetchApi<DeploymentData>(`/catalog/services/${serviceId}/last-deployments`)
            .then((data) => setDeploymentCache((cache) => new Map(cache).set(serviceId, data)))
            .catch(() => setDeploymentCache((cache) => new Map(cache).set(serviceId, { environments: {} })))
            .finally(() => setLoadingDeployments((ld) => { const s = new Set(ld); s.delete(serviceId); return s; }));
        }
      }
      return next;
    });
  }

  const promotionReadyIds = new Set(
    [...deploymentCache.entries()]
      .filter(([, d]) => isPromotionPending(d.environments) || hasNoProdDeployment(d.environments))
      .map(([id]) => id),
  );
  const deployedIds = new Set(
    [...deploymentCache.entries()]
      .filter(([, d]) => Object.keys(d.environments).length > 0)
      .map(([id]) => id),
  );

  // Only meaningful once prefetch has settled for a service (cache entry exists with empty environments)
  const neverDeployedIds = new Set(
    services
      .filter((svc) => {
        const cached = deploymentCache.get(svc.serviceId);
        return cached !== undefined && Object.keys(cached.environments).length === 0;
      })
      .map((svc) => svc.serviceId),
  );

  const filteredServices = services.filter((svc) => {
    if (filterMode === 'promotion-ready') return promotionReadyIds.has(svc.serviceId);
    if (filterMode === 'deployed') return deployedIds.has(svc.serviceId);
    if (filterMode === 'never-deployed') return neverDeployedIds.has(svc.serviceId);
    return true;
  });

  function selectFilter(mode: FilterMode) {
    setFilterMode((prev) => (prev === mode ? 'all' : mode));
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Environment Promotion"
        actions={
          <div className="flex items-center gap-3">
            {prefetching && (
              <span className="flex items-center gap-1.5 text-xs text-gray-400">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                Scanning deployments…
              </span>
            )}
            <button
              onClick={load}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              Refresh
            </button>
          </div>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        {/* Total services */}
        <button
          onClick={() => selectFilter('all')}
          className={`rounded-xl border p-4 text-left transition-all shadow-sm ${
            filterMode === 'all'
              ? 'border-blue-500 bg-blue-50 dark:border-blue-500 dark:bg-blue-950/30'
              : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800/50'
          }`}
        >
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">Total Services</p>
          <p className={`mt-1 text-3xl font-bold ${filterMode === 'all' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-white'}`}>
            {services.length}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">multi-environment</p>
        </button>

        {/* Deployed */}
        <button
          onClick={() => selectFilter('deployed')}
          className={`rounded-xl border p-4 text-left transition-all shadow-sm ${
            filterMode === 'deployed'
              ? 'border-blue-500 bg-blue-50 dark:border-blue-500 dark:bg-blue-950/30'
              : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800/50'
          }`}
        >
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">Deployed</p>
          <div className="mt-1 flex items-end gap-2">
            <p className={`text-3xl font-bold ${filterMode === 'deployed' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-white'}`}>
              {prefetching && deployedIds.size === 0 ? '—' : deployedIds.size}
            </p>
            {prefetching && <span className="mb-1 h-3 w-3 animate-spin rounded-full border border-gray-300 border-t-transparent" />}
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">have deployment records</p>
        </button>

        {/* Promotion ready */}
        <button
          onClick={() => selectFilter('promotion-ready')}
          className={`rounded-xl border p-4 text-left transition-all shadow-sm ${
            filterMode === 'promotion-ready'
              ? 'border-amber-500 bg-amber-50 dark:border-amber-500 dark:bg-amber-950/30'
              : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800/50'
          }`}
        >
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">Promotion Ready</p>
          <div className="mt-1 flex items-end gap-2">
            <p className={`text-3xl font-bold ${
              filterMode === 'promotion-ready'
                ? 'text-amber-600 dark:text-amber-400'
                : promotionReadyIds.size > 0
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-gray-900 dark:text-white'
            }`}>
              {prefetching && promotionReadyIds.size === 0 ? '—' : promotionReadyIds.size}
            </p>
            {prefetching && <span className="mb-1 h-3 w-3 animate-spin rounded-full border border-gray-300 border-t-transparent" />}
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">dev ahead of production</p>
        </button>

        {/* Never deployed */}
        <button
          onClick={() => selectFilter('never-deployed')}
          className={`rounded-xl border p-4 text-left transition-all shadow-sm ${
            filterMode === 'never-deployed'
              ? 'border-gray-500 bg-gray-100 dark:border-gray-500 dark:bg-gray-800/60'
              : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800/50'
          }`}
        >
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">Never Deployed</p>
          <div className="mt-1 flex items-end gap-2">
            <p className={`text-3xl font-bold ${filterMode === 'never-deployed' ? 'text-gray-700 dark:text-gray-300' : 'text-gray-900 dark:text-white'}`}>
              {prefetching && neverDeployedIds.size === 0 ? '—' : neverDeployedIds.size}
            </p>
            {prefetching && <span className="mb-1 h-3 w-3 animate-spin rounded-full border border-gray-300 border-t-transparent" />}
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">no deployment records found</p>
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200/60 bg-white/60 shadow-xl shadow-slate-200/20 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
        ) : filteredServices.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">
            {services.length === 0 ? 'No multi-environment services found.' : 'No services match the selected filter.'}
          </div>
        ) : (
          <>
            <table className="min-w-full divide-y divide-gray-100 dark:divide-gray-800">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-400">
                  <th className="px-5 py-3">Service</th>
                  <th className="px-5 py-3">Owner Team</th>
                  <th className="px-5 py-3">Environments</th>
                  <th className="px-5 py-3">Last Synced</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {filteredServices.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((svc) => {
                  const isExpanded = expandedIds.has(svc.serviceId);
                  const depData = deploymentCache.get(svc.serviceId);
                  const isLoadingDep = loadingDeployments.has(svc.serviceId);
                  const pending = depData
                    ? isPromotionPending(depData.environments) || hasNoProdDeployment(depData.environments)
                    : false;

                  return (
                    <>
                      <tr
                        key={svc.serviceId}
                        onClick={() => toggleRow(svc.serviceId)}
                        className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50"
                      >
                        <td className="px-5 py-3 text-sm font-medium">
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400 text-xs">{isExpanded ? '▾' : '▸'}</span>
                            <span className="text-gray-900 dark:text-white">{svc.serviceName}</span>
                            {/* Show badge immediately once prefetch resolves for this service */}
                            {pending && (
                              <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950/30 dark:text-amber-400">
                                Promotion pending
                              </span>
                            )}
                            {/* Spinner while this specific service is being prefetched */}
                            {!depData && prefetching && (
                              <span className="h-3 w-3 animate-spin rounded-full border border-gray-300 border-t-transparent" />
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-sm text-gray-600 dark:text-gray-300">{svc.ownerTeam.teamName}</td>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap gap-1">
                            {svc.environments.map((env) => (
                              <span
                                key={env}
                                className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${ENV_CLASSES[env] ?? 'bg-gray-50 text-gray-600 ring-gray-500/10'}`}
                              >
                                {env}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-sm text-gray-500 dark:text-gray-400">
                          {formatRelativeTime(svc.lastSyncedAt)}
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr key={`${svc.serviceId}-expanded`} className="bg-gray-50/50 dark:bg-gray-800/30">
                          <td colSpan={4} className="px-8 py-4">
                            {isLoadingDep ? (
                              <div className="flex items-center gap-2 text-sm text-gray-400">
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                                Loading deployment data…
                              </div>
                            ) : !depData || Object.keys(depData.environments).length === 0 ? (
                              <div className="flex items-center justify-between">
                                <p className="text-sm text-gray-400">No deployment data available.</p>
                                <Link
                                  to={`/catalog/services/${svc.serviceId}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                                >
                                  View service →
                                </Link>
                              </div>
                            ) : (
                              <div className="space-y-3">
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                  {Object.entries(depData.environments).map(([env, dep]) => (
                                    <div key={env} className="rounded-lg border border-gray-100 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
                                      <div className="mb-2">
                                        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${ENV_CLASSES[env] ?? 'bg-gray-50 text-gray-600 ring-gray-500/10'}`}>
                                          {env}
                                        </span>
                                      </div>
                                      <div className="space-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                                        {dep.branch && <p><span className="text-gray-400">Branch:</span> {dep.branch}</p>}
                                        {dep.actor  && <p><span className="text-gray-400">By:</span> {dep.actor}</p>}
                                        <p><span className="text-gray-400">When:</span> {formatRelativeTime(dep.completedAt)}</p>
                                        <a
                                          href={dep.htmlUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-block text-blue-600 hover:underline"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          View on GitHub ↗
                                        </a>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <div className="flex justify-end">
                                  <Link
                                    to={`/catalog/services/${svc.serviceId}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                                  >
                                    View service →
                                  </Link>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination */}
            {filteredServices.length > PAGE_SIZE && (
              <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3 dark:border-gray-800">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredServices.length)} of {filteredServices.length} services
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="rounded px-2.5 py-1 text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-800"
                  >
                    ‹ Prev
                  </button>
                  {Array.from({ length: Math.ceil(filteredServices.length / PAGE_SIZE) }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === Math.ceil(filteredServices.length / PAGE_SIZE) || Math.abs(p - page) <= 1)
                    .reduce<(number | '…')[]>((acc, p, idx, arr) => {
                      if (idx > 0 && typeof arr[idx - 1] === 'number' && (p as number) - (arr[idx - 1] as number) > 1) acc.push('…');
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((p, idx) =>
                      p === '…' ? (
                        <span key={`ellipsis-${idx}`} className="px-1 text-sm text-gray-400">…</span>
                      ) : (
                        <button
                          key={p}
                          onClick={() => setPage(p as number)}
                          className={`rounded px-2.5 py-1 text-sm font-medium transition-colors ${
                            page === p
                              ? 'bg-blue-600 text-white'
                              : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
                          }`}
                        >
                          {p}
                        </button>
                      )
                    )}
                  <button
                    onClick={() => setPage((p) => Math.min(Math.ceil(filteredServices.length / PAGE_SIZE), p + 1))}
                    disabled={page === Math.ceil(filteredServices.length / PAGE_SIZE)}
                    className="rounded px-2.5 py-1 text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-800"
                  >
                    Next ›
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
