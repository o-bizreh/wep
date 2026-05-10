import { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@wep/ui';
import { Server, Zap, Database, CheckCircle, XCircle, AlertCircle, Loader2, ChevronDown, RefreshCw, X, Search } from 'lucide-react';
import { infraApi, type MetricSeries } from '../../lib/api';
import { cacheGet, cacheSet, cacheClear } from '../../lib/cache';

type EcsService  = { type: 'ecs-service'; id: string; name: string; cluster: string; status: string; desiredCount: number; runningCount: number; environment: string | null; tags: Record<string, string | undefined> };
type LambdaFn    = { type: 'lambda';      id: string; name: string; runtime: string; memoryMb: number; timeoutSec: number; lastModified: string | null; environment: string | null; tags: Record<string, string | undefined> };
type RdsInstance = { type: 'rds';         id: string; name: string; engine: string; instanceClass: string; status: string; multiAz: boolean; environment: string | null; tags: Record<string, string | undefined> };
type AnyResource = EcsService | LambdaFn | RdsInstance;
type ResourceData = Awaited<ReturnType<typeof infraApi.getResources>>;

const CACHE_KEY = (env: string) => `infra-resources-${env || 'all'}`;

// ── Sparkline ──────────────────────────────────────────────────────────────
function Sparkline({ values, color = '#6366f1' }: { values: number[]; color?: string }) {
  if (values.length < 2) return <span className="text-xs text-gray-400">No data</span>;
  const w = 120; const h = 36; const pad = 2;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - 2 * pad);
    const y = h - pad - (v / max) * (h - 2 * pad);
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── Metrics Drawer ──────────────────────────────────────────────────────────
function MetricsDrawer({ resource, onClose }: { resource: AnyResource; onClose: () => void }) {
  const [metrics, setMetrics] = useState<Record<string, MetricSeries> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setError(null); setMetrics(null);
    const cluster = resource.type === 'ecs-service' ? resource.cluster : undefined;
    infraApi.getMetrics(resource.type, resource.name, cluster)
      .then((d) => setMetrics(d.metrics))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load metrics'))
      .finally(() => setLoading(false));
  }, [resource]);

  const metricColor: Record<string, string> = {
    cpu: '#f59e0b', memory: '#8b5cf6', invocations: '#6366f1',
    errors: '#ef4444', throttles: '#f97316', concurrency: '#10b981',
    connections: '#3b82f6',
  };

  const formatVal = (id: string, v: number) => {
    if (id === 'cpu') return `${v.toFixed(1)}%`;
    if (id === 'memory' && resource.type === 'rds') return `${(v / 1024 / 1024 / 1024).toFixed(1)} GB free`;
    if (id === 'memory') return `${v.toFixed(1)}%`; // ECS MemoryUtilization is a percentage
    return v % 1 === 0 ? String(v) : v.toFixed(2);
  };

  const latest = (series: MetricSeries) => series.values[series.values.length - 1] ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-xl h-full bg-white dark:bg-zinc-900 shadow-2xl flex flex-col">
        <div className="flex items-start justify-between px-6 py-5 border-b border-gray-100 dark:border-white/10">
          <div>
            <p className="font-mono text-sm font-semibold text-gray-900 dark:text-white">{resource.name}</p>
            <p className="text-xs text-gray-400 mt-0.5 capitalize">{resource.type.replace('-', ' ')} · last 24 hours · 5-min intervals</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
          ) : error ? (
            <div className="rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 px-4 py-3 text-sm text-red-600 dark:text-red-400">{error}</div>
          ) : metrics && Object.keys(metrics).length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Object.entries(metrics).map(([id, series]) => (
                <div key={id} className="rounded-2xl border border-slate-200/60 bg-white dark:border-white/10 dark:bg-zinc-900/40 shadow-xl shadow-slate-200/20 dark:shadow-black/40 p-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">{series.label}</p>
                  <p className="text-xl font-bold text-gray-900 dark:text-white mb-3">{formatVal(id, latest(series))}</p>
                  <Sparkline values={series.values} color={metricColor[id] ?? '#6366f1'} />
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>{series.timestamps[0] ? new Date(series.timestamps[0]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                    <span>{series.timestamps.at(-1) ? new Date(series.timestamps.at(-1)!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-center text-gray-400 py-12">No metric data available for the past 24 hours.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Status ──────────────────────────────────────────────────────────────────
function StatusDot({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === 'active' || s === 'available' || s === 'running') return <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />;
  if (s === 'inactive' || s === 'stopped' || s === 'failed') return <XCircle className="h-3.5 w-3.5 text-red-500" />;
  return <AlertCircle className="h-3.5 w-3.5 text-amber-400" />;
}

function Section({ icon, title, total, filtered, search, onSearch, children }: {
  icon: React.ReactNode; title: string; total: number; filtered: number;
  search: string; onSearch: (v: string) => void; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white dark:border-white/10 dark:bg-zinc-900/40 shadow-xl shadow-slate-200/20 dark:shadow-black/40 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 gap-4">
        <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-3 min-w-0">
          <span className="text-gray-400 shrink-0">{icon}</span>
          <span className="font-semibold text-gray-900 dark:text-white">{title}</span>
          <span className="rounded-full bg-gray-100 dark:bg-zinc-800 px-2 py-0.5 text-xs font-bold text-gray-500 dark:text-gray-400">
            {search ? `${filtered}/${total}` : total}
          </span>
        </button>
        <div className="flex items-center gap-3">
          <div className="relative w-48">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search…"
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-zinc-900 text-sm dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <ChevronDown onClick={() => setOpen((v) => !v)} className={`h-4 w-4 text-gray-400 cursor-pointer transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </div>
      {open && <div className="border-t border-gray-100 dark:border-white/10">{children}</div>}
    </div>
  );
}

function EcsTable({ services, onSelect }: { services: EcsService[]; onSelect: (r: AnyResource) => void }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="bg-gray-50/50 dark:bg-white/5">
        <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-gray-400">Service</th>
        <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-gray-400 hidden md:table-cell">Cluster</th>
        <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-gray-400">Status</th>
        <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-gray-400 hidden md:table-cell">Tasks</th>
        <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-gray-400 hidden lg:table-cell">Env</th>
      </tr></thead>
      <tbody className="divide-y divide-gray-100 dark:divide-white/5">
        {services.map((s) => (
          <tr key={s.id} onClick={() => onSelect(s)} className="hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer transition-colors">
            <td className="px-4 py-3 font-mono text-xs font-medium text-gray-900 dark:text-white">{s.name}</td>
            <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 hidden md:table-cell">{s.cluster}</td>
            <td className="px-4 py-3"><div className="flex items-center gap-1.5"><StatusDot status={s.status} /><span className="text-xs text-gray-500 capitalize">{s.status.toLowerCase()}</span></div></td>
            <td className="px-4 py-3 hidden md:table-cell"><span className={`text-xs font-mono ${s.runningCount < s.desiredCount ? 'text-amber-500' : 'text-emerald-500'}`}>{s.runningCount}/{s.desiredCount}</span></td>
            <td className="px-4 py-3 hidden lg:table-cell">{s.environment && <span className="rounded-md bg-indigo-50 dark:bg-indigo-950/30 px-2 py-0.5 text-xs text-indigo-600 dark:text-indigo-400">{s.environment}</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LambdaTable({ functions, onSelect }: { functions: LambdaFn[]; onSelect: (r: AnyResource) => void }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="bg-gray-50/50 dark:bg-white/5">
        <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-gray-400">Function</th>
        <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-gray-400 hidden md:table-cell">Runtime</th>
        <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-gray-400 hidden md:table-cell">Memory</th>
        <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-gray-400 hidden md:table-cell">Timeout</th>
        <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-gray-400 hidden lg:table-cell">Last Modified</th>
      </tr></thead>
      <tbody className="divide-y divide-gray-100 dark:divide-white/5">
        {functions.map((f) => (
          <tr key={f.id} onClick={() => onSelect(f)} className="hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer transition-colors">
            <td className="px-4 py-3 font-mono text-xs font-medium text-gray-900 dark:text-white">{f.name}</td>
            <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 hidden md:table-cell">{f.runtime}</td>
            <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 hidden md:table-cell">{f.memoryMb} MB</td>
            <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 hidden md:table-cell">{f.timeoutSec}s</td>
            <td className="px-4 py-3 text-xs text-gray-400 hidden lg:table-cell">{f.lastModified ? new Date(f.lastModified).toLocaleDateString() : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RdsTable({ instances, onSelect }: { instances: RdsInstance[]; onSelect: (r: AnyResource) => void }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="bg-gray-50/50 dark:bg-white/5">
        <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-gray-400">Instance</th>
        <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-gray-400 hidden md:table-cell">Engine</th>
        <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-gray-400 hidden md:table-cell">Class</th>
        <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-gray-400">Status</th>
        <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-gray-400 hidden lg:table-cell">Multi-AZ</th>
      </tr></thead>
      <tbody className="divide-y divide-gray-100 dark:divide-white/5">
        {instances.map((r) => (
          <tr key={r.id} onClick={() => onSelect(r)} className="hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer transition-colors">
            <td className="px-4 py-3 font-mono text-xs font-medium text-gray-900 dark:text-white">{r.name}</td>
            <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 hidden md:table-cell">{r.engine}</td>
            <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 hidden md:table-cell">{r.instanceClass}</td>
            <td className="px-4 py-3"><div className="flex items-center gap-1.5"><StatusDot status={r.status} /><span className="text-xs text-gray-500 capitalize">{r.status}</span></div></td>
            <td className="px-4 py-3 hidden lg:table-cell"><span className={`text-xs font-medium ${r.multiAz ? 'text-emerald-500' : 'text-gray-400'}`}>{r.multiAz ? 'Yes' : 'No'}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function InfraResourcesPage() {
  const [data, setData] = useState<ResourceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [env, setEnv] = useState('');
  const [selected, setSelected] = useState<AnyResource | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [ecsSearch, setEcsSearch] = useState('');
  const [lambdaSearch, setLambdaSearch] = useState('');
  const [rdsSearch, setRdsSearch] = useState('');

  const load = useCallback(async (bust = false) => {
    const key = CACHE_KEY(env);
    if (!bust) {
      const cached = cacheGet<ResourceData>(key);
      if (cached) { setData(cached); setLoading(false); return; }
    } else {
      cacheClear(key);
    }
    setError(null);
    try {
      const d = await infraApi.getResources(env || undefined);
      cacheSet(key, d);
      setData(d);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [env]);

  useEffect(() => { setLoading(true); void load(); }, [load]);

  const handleRefresh = () => { setRefreshing(true); void load(true); };

  const total = data ? data.ecsServices.length + data.lambdaFunctions.length + data.rdsInstances.length : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Resource Inventory"
        actions={
          <div className="flex items-center gap-3">
            <select value={env} onChange={(e) => setEnv(e.target.value)}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-zinc-900 text-sm dark:text-white px-3 py-2">
              <option value="">All environments</option>
              <option value="Production">Production</option>
              <option value="Development">Development</option>
            </select>
            <button onClick={handleRefresh} disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50 transition-colors">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        }
      />
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Live view of ECS, Lambda, and RDS in your AWS account. Cached for 24 hours — click Refresh to update. Click a row to see metrics.
      </p>

      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total',    value: total,                       icon: <Server className="h-5 w-5" /> },
            { label: 'ECS',      value: data.ecsServices.length,     icon: <Server className="h-5 w-5" /> },
            { label: 'Lambda',   value: data.lambdaFunctions.length, icon: <Zap className="h-5 w-5" /> },
            { label: 'RDS',      value: data.rdsInstances.length,    icon: <Database className="h-5 w-5" /> },
          ].map(({ label, value, icon }) => (
            <div key={label} className="rounded-2xl border border-slate-200/60 bg-white dark:border-white/10 dark:bg-zinc-900/40 px-5 py-4 shadow-xl shadow-slate-200/20 dark:shadow-black/40">
              <div className="flex items-center gap-2 text-gray-400 mb-2">{icon}<span className="text-xs font-semibold uppercase tracking-wider">{label}</span></div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div>
      ) : error ? (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 px-4 py-3 text-sm text-red-600 dark:text-red-400">{error}</div>
      ) : data ? (
        <div className="space-y-4">
          {data.ecsServices.length > 0 && (() => {
            const q = ecsSearch.toLowerCase();
            const filtered = data.ecsServices.filter((s) => !q || s.name.toLowerCase().includes(q) || s.cluster.toLowerCase().includes(q));
            return (
              <Section icon={<Server className="h-5 w-5" />} title="ECS Services" total={data.ecsServices.length} filtered={filtered.length} search={ecsSearch} onSearch={setEcsSearch}>
                {filtered.length > 0 ? <EcsTable services={filtered} onSelect={setSelected} /> : <p className="px-4 py-6 text-sm text-center text-gray-400">No services match "{ecsSearch}"</p>}
              </Section>
            );
          })()}
          {data.lambdaFunctions.length > 0 && (() => {
            const q = lambdaSearch.toLowerCase();
            const filtered = data.lambdaFunctions.filter((f) => !q || f.name.toLowerCase().includes(q) || f.runtime.toLowerCase().includes(q));
            return (
              <Section icon={<Zap className="h-5 w-5" />} title="Lambda Functions" total={data.lambdaFunctions.length} filtered={filtered.length} search={lambdaSearch} onSearch={setLambdaSearch}>
                {filtered.length > 0 ? <LambdaTable functions={filtered} onSelect={setSelected} /> : <p className="px-4 py-6 text-sm text-center text-gray-400">No functions match "{lambdaSearch}"</p>}
              </Section>
            );
          })()}
          {data.rdsInstances.length > 0 && (() => {
            const q = rdsSearch.toLowerCase();
            const filtered = data.rdsInstances.filter((r) => !q || r.name.toLowerCase().includes(q) || r.engine.toLowerCase().includes(q) || r.instanceClass.toLowerCase().includes(q));
            return (
              <Section icon={<Database className="h-5 w-5" />} title="RDS Instances" total={data.rdsInstances.length} filtered={filtered.length} search={rdsSearch} onSearch={setRdsSearch}>
                {filtered.length > 0 ? <RdsTable instances={filtered} onSelect={setSelected} /> : <p className="px-4 py-6 text-sm text-center text-gray-400">No instances match "{rdsSearch}"</p>}
              </Section>
            );
          })()}
          {total === 0 && <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 py-12 text-center text-sm text-gray-400">No resources found{env ? ` for environment "${env}"` : ''}.</div>}
        </div>
      ) : null}

      {selected && <MetricsDrawer resource={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
