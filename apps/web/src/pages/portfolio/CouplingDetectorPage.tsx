import { useMemo, useState } from 'react';
import { PageHeader } from '@wep/ui';
import { Loader2, AlertCircle, Network, ArrowRight, ChevronDown, ChevronRight, ChevronLeft } from 'lucide-react';
import { portfolioApi, fetchApi } from '../../lib/api';
import { useCachedQuery, peekQuery } from '../../lib/query-cache';

type Coupling = { source: string; target: string; type: string; detail: string; port?: string };
type CouplingResponse = {
  clusterName: string;
  services: string[];
  couplings: Coupling[];
  dependsOn: Record<string, string[]>;
  dependedBy: Record<string, string[]>;
};

function cacheKey(cluster: string): string {
  return `portfolio:coupling:${cluster}`;
}

/**
 * One cluster row. Collapses by default; lazy-fetches on first expand. Counts
 * shown next to the cluster name only render when the cache already has data
 * — we don't want to issue a fetch just to populate a header badge.
 */
function ClusterRow({ cluster, expanded, onToggle }: {
  cluster: { name: string; arn: string };
  expanded: boolean;
  onToggle: () => void;
}) {
  // Synchronous peek into the cache. Returns undefined for clusters the user
  // has never expanded; in that case we render no count badges. Re-runs on
  // every render, which is fine — peekQuery is just a Map.get().
  const cached = peekQuery<CouplingResponse>(cacheKey(cluster.name));

  // Hook is always called, but only fires when the row is expanded. Once it
  // has populated the cache, future renders pick the value up via peekQuery
  // even after the row is collapsed.
  const query = useCachedQuery(
    cacheKey(cluster.name),
    () => portfolioApi.getCoupling(cluster.name),
    { staleTimeMs: 5 * 60_000, enabled: expanded },
  );
  const data: CouplingResponse | null = query.data ?? cached ?? null;

  const couplingByTarget = useMemo(() => {
    if (!data) return new Map<string, Coupling[]>();
    const m = new Map<string, Coupling[]>();
    for (const c of data.couplings) {
      const list = m.get(c.target) ?? [];
      list.push(c);
      m.set(c.target, list);
    }
    return m;
  }, [data]);

  const sharedInfra = useMemo(() => {
    return [...couplingByTarget.entries()]
      .filter(([_, list]) => new Set(list.map((c) => c.source)).size > 1)
      .map(([target, list]) => ({
        target,
        type: list[0]?.type ?? '',
        consumers: [...new Set(list.map((c) => c.source))],
      }))
      .sort((a, b) => b.consumers.length - a.consumers.length);
  }, [couplingByTarget]);

  return (
    <div className="rounded-2xl border border-zinc-200/60 dark:border-white/10 bg-white/60 dark:bg-zinc-900/40 backdrop-blur-xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40 transition"
      >
        <div className="flex items-center gap-3 min-w-0">
          {expanded
            ? <ChevronDown className="h-4 w-4 flex-none text-zinc-400" />
            : <ChevronRight className="h-4 w-4 flex-none text-zinc-400" />}
          <Network className="h-4 w-4 flex-none text-cyan-500" />
          <span className="font-semibold text-zinc-900 dark:text-white truncate">{cluster.name}</span>
        </div>
        <div className="flex items-center gap-2 flex-none">
          {/* Count badges only render when the data is already fetched. */}
          {cached ? (
            <>
              <span className="rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                {cached.services.length} services
              </span>
              <span className="rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                {cached.couplings.length} couplings
              </span>
              <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                sharedInfra.length > 0
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300'
                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300'
              }`}>
                {sharedInfra.length} shared
              </span>
            </>
          ) : query.isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin text-cyan-500" />
          ) : null}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-zinc-200/60 dark:border-white/10 p-4">
          {query.isLoading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin text-cyan-500" />
            </div>
          ) : query.error ? (
            <div className="rounded-xl border border-red-500/20 bg-red-50 dark:bg-red-500/5 p-3">
              <AlertCircle className="inline h-4 w-4 text-red-500 mr-2" />
              <span className="text-sm text-red-600 dark:text-red-400">
                {query.error instanceof Error ? query.error.message : 'Failed to load'}
              </span>
            </div>
          ) : data ? (
            <ExpandedView data={data} sharedInfra={sharedInfra} />
          ) : null}
        </div>
      )}
    </div>
  );
}

const CONSUMERS_PREVIEW = 5;
const SERVICES_PAGE = 15;
const INFRA_PAGE = 10;

function ConsumerChips({ consumers }: { consumers: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? consumers : consumers.slice(0, CONSUMERS_PREVIEW);
  const hidden = consumers.length - CONSUMERS_PREVIEW;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {visible.map((c) => (
        <span
          key={c}
          className="inline-flex items-center rounded-md border border-zinc-200/60 dark:border-white/10 bg-white dark:bg-zinc-800/70 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 shadow-sm"
        >
          {c}
        </span>
      ))}
      {!expanded && hidden > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="inline-flex items-center rounded-md border border-zinc-200/60 dark:border-white/10 bg-zinc-100 dark:bg-zinc-700/60 px-2 py-0.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 hover:text-cyan-600 dark:hover:text-cyan-400 transition"
        >
          +{hidden} more
        </button>
      )}
      {expanded && consumers.length > CONSUMERS_PREVIEW && (
        <button
          onClick={() => setExpanded(false)}
          className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold text-zinc-400 hover:text-zinc-600 transition"
        >
          Show less
        </button>
      )}
    </div>
  );
}

function ExpandedView({ data, sharedInfra }: {
  data: CouplingResponse;
  sharedInfra: Array<{ target: string; type: string; consumers: string[] }>;
}) {
  const [serviceFilter, setServiceFilter] = useState('');
  const [servicePage, setServicePage] = useState(1);
  const [infraPage, setInfraPage] = useState(1);
  const [drawer, setDrawer] = useState<string | null>(null);

  const filteredServices = useMemo(() => {
    const f = serviceFilter.toLowerCase();
    return data.services.filter((s) => !f || s.toLowerCase().includes(f));
  }, [data, serviceFilter]);

  const totalServicePages = Math.ceil(filteredServices.length / SERVICES_PAGE);
  const pagedServices = filteredServices.slice(
    (servicePage - 1) * SERVICES_PAGE,
    servicePage * SERVICES_PAGE,
  );

  function handleServiceSearch(v: string) {
    setServiceFilter(v);
    setServicePage(1);
  }

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Left: stats + shared infra ── */}
        <div className="lg:col-span-2 space-y-5">
          {/* KPI row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-zinc-200/60 dark:border-white/10 bg-zinc-50/40 dark:bg-zinc-900/30 p-3">
              <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Services</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{data.services.length}</p>
            </div>
            <div className="rounded-xl border border-zinc-200/60 dark:border-white/10 bg-zinc-50/40 dark:bg-zinc-900/30 p-3">
              <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Couplings</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{data.couplings.length}</p>
            </div>
            <div className="rounded-xl border border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/5 p-3">
              <p className="text-[11px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-400">Shared Infra</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-amber-700 dark:text-amber-400">{sharedInfra.length}</p>
            </div>
          </div>

          {/* Shared infrastructure table */}
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500">
                Shared infrastructure <span className="text-zinc-400 normal-case font-medium">(≥2 consumers)</span>
              </h3>
              {sharedInfra.length > 0 && (
                <span className="text-xs text-zinc-500">{sharedInfra.length} resources</span>
              )}
            </div>
            {sharedInfra.length === 0 ? (
              <p className="text-sm text-zinc-500">No shared infrastructure detected.</p>
            ) : (() => {
              const totalInfraPages = Math.ceil(sharedInfra.length / INFRA_PAGE);
              const pagedInfra = sharedInfra.slice((infraPage - 1) * INFRA_PAGE, infraPage * INFRA_PAGE);
              return (
                <div className="overflow-hidden rounded-xl border border-zinc-200/60 dark:border-white/10">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200/60 dark:border-white/10 bg-zinc-50/80 dark:bg-zinc-900/60">
                        <th className="py-2 pl-3 pr-2 text-left text-[11px] font-bold uppercase tracking-widest text-zinc-500">Resource</th>
                        <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-widest text-zinc-500 w-28">Type</th>
                        <th className="pl-2 pr-3 py-2 text-right text-[11px] font-bold uppercase tracking-widest text-zinc-500 w-20">Consumers</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200/50 dark:divide-white/5">
                      {pagedInfra.map((s) => (
                        <tr key={s.target} className="hover:bg-zinc-50/60 dark:hover:bg-white/[0.02] transition-colors align-top">
                          <td className="py-2.5 pl-3 pr-2">
                            <p className="font-semibold text-zinc-900 dark:text-white text-[13px] break-all leading-snug">{s.target}</p>
                            <ConsumerChips consumers={s.consumers} />
                          </td>
                          <td className="px-2 py-2.5 align-top">
                            <span className="inline-flex items-center rounded-md bg-amber-100/60 dark:bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300 ring-1 ring-inset ring-amber-500/20">
                              {s.type}
                            </span>
                          </td>
                          <td className="pl-2 pr-3 py-2.5 text-right align-top">
                            <span className="inline-flex items-center justify-center rounded-full bg-amber-100 dark:bg-amber-500/20 px-2.5 py-0.5 text-xs font-bold text-amber-800 dark:text-amber-300">
                              {s.consumers.length}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {totalInfraPages > 1 && (
                    <div className="flex items-center justify-between border-t border-zinc-200/60 dark:border-white/10 bg-zinc-50/60 dark:bg-zinc-900/30 px-3 py-2">
                      <span className="text-xs text-zinc-500">
                        {(infraPage - 1) * INFRA_PAGE + 1}–{Math.min(infraPage * INFRA_PAGE, sharedInfra.length)} of {sharedInfra.length}
                      </span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setInfraPage((p) => Math.max(1, p - 1))}
                          disabled={infraPage === 1}
                          className="flex h-6 w-6 items-center justify-center rounded border border-zinc-200 dark:border-white/10 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <ChevronLeft className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => setInfraPage((p) => Math.min(totalInfraPages, p + 1))}
                          disabled={infraPage === totalInfraPages}
                          className="flex h-6 w-6 items-center justify-center rounded border border-zinc-200 dark:border-white/10 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <ChevronRight className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {/* ── Right: services list ── */}
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-zinc-500">Services in cluster</h3>
            <input
              type="text"
              placeholder="Filter services…"
              value={serviceFilter}
              onChange={(e) => handleServiceSearch(e.target.value)}
              className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-sm dark:border-white/10 dark:bg-zinc-900"
            />
          </div>

          <div className="overflow-hidden rounded-xl border border-zinc-200/60 dark:border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200/60 dark:border-white/10 bg-zinc-50/80 dark:bg-zinc-900/60">
                  <th className="py-2 pl-3 pr-2 text-left text-[11px] font-bold uppercase tracking-widest text-zinc-500">Service</th>
                  <th className="px-2 py-2 text-center text-[11px] font-bold uppercase tracking-widest text-zinc-500 w-10" title="Outbound">Out</th>
                  <th className="pl-2 pr-3 py-2 text-center text-[11px] font-bold uppercase tracking-widest text-zinc-500 w-10" title="Inbound">In</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200/50 dark:divide-white/5">
                {pagedServices.map((s) => {
                  const out = data.dependsOn[s]?.length ?? 0;
                  const inn = data.dependedBy[s]?.length ?? 0;
                  return (
                    <tr
                      key={s}
                      onClick={() => setDrawer(s)}
                      className="cursor-pointer hover:bg-zinc-50/80 dark:hover:bg-white/[0.03] transition-colors"
                    >
                      <td className="py-2 pl-3 pr-2">
                        <span className="block truncate font-medium text-zinc-800 dark:text-zinc-200 text-[13px]">{s}</span>
                      </td>
                      <td className="px-2 py-2 text-center">
                        <span className={`inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                          out > 0 ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' : 'text-zinc-400'
                        }`}>{out}</span>
                      </td>
                      <td className="pl-2 pr-3 py-2 text-center">
                        <span className={`inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                          inn > 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'text-zinc-400'
                        }`}>{inn}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Services pagination */}
            {totalServicePages > 1 && (
              <div className="flex items-center justify-between border-t border-zinc-200/60 dark:border-white/10 bg-zinc-50/60 dark:bg-zinc-900/30 px-3 py-2">
                <span className="text-xs text-zinc-500">
                  {(servicePage - 1) * SERVICES_PAGE + 1}–{Math.min(servicePage * SERVICES_PAGE, filteredServices.length)} of {filteredServices.length}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setServicePage((p) => Math.max(1, p - 1))}
                    disabled={servicePage === 1}
                    className="flex h-6 w-6 items-center justify-center rounded border border-zinc-200 dark:border-white/10 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30"
                  >
                    <ChevronLeft className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => setServicePage((p) => Math.min(totalServicePages, p + 1))}
                    disabled={servicePage === totalServicePages}
                    className="flex h-6 w-6 items-center justify-center rounded border border-zinc-200 dark:border-white/10 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30"
                  >
                    <ChevronRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Drawer */}
      {drawer && (
        <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white dark:bg-zinc-950 shadow-2xl border-l border-zinc-200 dark:border-white/10 overflow-y-auto">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200/60 dark:border-white/10 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-md px-6 py-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Service detail</p>
              <h3 className="text-base font-bold text-zinc-900 dark:text-white break-all">{drawer}</h3>
            </div>
            <button
              onClick={() => setDrawer(null)}
              className="ml-3 flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-zinc-200 dark:border-white/10 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
            >
              ✕
            </button>
          </div>
          <div className="p-6 space-y-6">
            <section>
              <h4 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-zinc-500">
                Depends on <span className="text-zinc-400 normal-case font-medium">({(data.dependsOn[drawer] ?? []).length})</span>
              </h4>
              {(data.dependsOn[drawer] ?? []).length === 0 ? (
                <p className="text-sm text-zinc-500">No outbound dependencies.</p>
              ) : (
                <ul className="space-y-1.5">
                  {(data.dependsOn[drawer] ?? []).map((t) => (
                    <li key={t} className="flex items-center gap-2 rounded-lg border border-zinc-200/60 dark:border-white/10 px-3 py-2 text-sm">
                      <ArrowRight className="h-3.5 w-3.5 text-blue-400 flex-none" />
                      <span className="font-medium text-zinc-800 dark:text-zinc-200 break-all">{t}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h4 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-zinc-500">
                Depended on by <span className="text-zinc-400 normal-case font-medium">({(data.dependedBy[drawer] ?? []).length})</span>
              </h4>
              {(data.dependedBy[drawer] ?? []).length === 0 ? (
                <p className="text-sm text-zinc-500">No inbound dependencies.</p>
              ) : (
                <ul className="space-y-1.5">
                  {(data.dependedBy[drawer] ?? []).map((t) => (
                    <li key={t} className="flex items-center gap-2 rounded-lg border border-zinc-200/60 dark:border-white/10 px-3 py-2 text-sm">
                      <ArrowRight className="h-3.5 w-3.5 rotate-180 text-emerald-400 flex-none" />
                      <span className="font-medium text-zinc-800 dark:text-zinc-200 break-all">{t}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  );
}

export function CouplingDetectorPage() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  // Cluster list rarely changes — cache for 10 minutes.
  const clustersQuery = useCachedQuery(
    'aws-resources:ecs:clusters',
    () => fetchApi<Array<{ name: string; arn: string }>>('/aws-resources/ecs/clusters'),
    { staleTimeMs: 10 * 60_000 },
  );
  const clusters = clustersQuery.data ?? [];

  const filteredClusters = useMemo(() => {
    const f = search.toLowerCase();
    return f ? clusters.filter((c) => c.name.toLowerCase().includes(f)) : clusters;
  }, [clusters, search]);

  const toggle = (name: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  return (
    <div className="p-6">
      <PageHeader title="Coupling Detector" onRefresh={clustersQuery.refetch} refreshing={clustersQuery.isFetching} />

      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
        One row per ECS cluster. Click a row to scan it; counts appear here once the data is cached.
      </p>

      <input
        type="text"
        placeholder="Filter clusters…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 w-full max-w-md rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm dark:border-white/10 dark:bg-zinc-900"
      />

      {!!clustersQuery.error && (
        <div className="mb-4 rounded-xl border border-red-500/20 bg-red-50 dark:bg-red-500/5 p-4">
          <AlertCircle className="inline h-4 w-4 text-red-500 mr-2" />
          <span className="text-sm text-red-600 dark:text-red-400">
            {clustersQuery.error instanceof Error ? clustersQuery.error.message : 'Failed to load clusters'}
          </span>
        </div>
      )}

      {clustersQuery.isLoading && clusters.length === 0 ? (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-6 w-6 animate-spin text-cyan-500" />
        </div>
      ) : filteredClusters.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 dark:border-white/10 p-12 text-center">
          <Network className="mx-auto h-10 w-10 text-zinc-400" />
          <p className="mt-3 text-sm text-zinc-500">
            {search ? 'No clusters match the filter.' : 'No ECS clusters found in this account/region.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredClusters.map((c) => (
            <ClusterRow
              key={c.arn}
              cluster={c}
              expanded={expanded.has(c.name)}
              onToggle={() => toggle(c.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
