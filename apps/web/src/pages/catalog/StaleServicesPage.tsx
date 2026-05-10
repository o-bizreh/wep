import { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@wep/ui';
import { catalogApi } from '../../lib/api';

type StaleService = {
  serviceId: string;
  serviceName: string;
  ownerTeam: { teamId: string; teamName: string };
  runtimeType: string;
  environments: string[];
  lastSyncedAt: string;
  daysSinceSync: number;
  healthStatus: string;
  staleReasons: string[];
};

type DaysFilter = 'all' | '>30' | '>60';

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86_400_000);
  if (d < 1) return 'today';
  if (d === 1) return '1 day ago';
  return `${d} days ago`;
}

function formatAbsoluteDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

function stalenessBadge(days: number) {
  if (days < 30) {
    return (
      <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/30 dark:text-emerald-400">
        {days}d
      </span>
    );
  }
  if (days <= 60) {
    return (
      <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950/30 dark:text-amber-400">
        {days}d
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950/30 dark:text-red-400">
      {days}d
    </span>
  );
}

const ENV_CLASSES: Record<string, string> = {
  production:  'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/30 dark:text-emerald-400',
  development: 'bg-orange-50 text-orange-700 ring-orange-600/20 dark:bg-orange-950/30 dark:text-orange-400',
  staging:     'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950/30 dark:text-amber-400',
};

const ENV_FILTERS: { label: string; value: 'all' | 'production' | 'development' | 'staging' }[] = [
  { label: 'All envs',     value: 'all' },
  { label: 'Production',   value: 'production' },
  { label: 'Staging',      value: 'staging' },
  { label: 'Development',  value: 'development' },
];

type EnvFilter = (typeof ENV_FILTERS)[number]['value'];

function isEnvFilter(v: string | null): v is EnvFilter {
  return v === 'all' || v === 'production' || v === 'staging' || v === 'development';
}

export function StaleServicesPage() {
  const [services, setServices] = useState<StaleService[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();

  // Pre-fill env from ?env= query so the dashboard tiles deep-link cleanly.
  // Day-bucket filter still defaults to 'all' so single-env services aren't hidden.
  const initialEnv = searchParams.get('env');
  const [envFilter, setEnvFilter] = useState<EnvFilter>(isEnvFilter(initialEnv) ? initialEnv : 'all');
  const [filter, setFilter] = useState<DaysFilter>('all');

  const load = useCallback(() => {
    setLoading(true);
    catalogApi.getStaleServices()
      .then((data) => setServices(data.services))
      .catch(() => setServices([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleEnvChange = (next: EnvFilter) => {
    setEnvFilter(next);
    if (next === 'all') searchParams.delete('env');
    else searchParams.set('env', next);
    setSearchParams(searchParams, { replace: true });
  };

  const filtered = services.filter((s) => {
    // Page is "Stale Services" — only services with at least one reason belong.
    if (s.staleReasons.length === 0) return false;
    if (envFilter !== 'all' && !s.environments.includes(envFilter)) return false;
    if (filter === '>30') return s.daysSinceSync > 30;
    if (filter === '>60') return s.daysSinceSync > 60;
    return true;
  });

  const staleTotal = services.filter((s) => s.staleReasons.length > 0).length;
  const stale30 = services.filter((s) => s.daysSinceSync > 30).length;
  const stale60 = services.filter((s) => s.daysSinceSync > 60).length;

  const FILTERS: { label: string; value: DaysFilter }[] = [
    { label: 'All', value: 'all' },
    { label: '>30 days', value: '>30' },
    { label: '>60 days', value: '>60' },
  ];

  const titleSuffix = envFilter === 'all'
    ? ''
    : ` · ${envFilter.charAt(0).toUpperCase()}${envFilter.slice(1)}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Stale Services${titleSuffix}`}
        onRefresh={load}
        refreshing={loading}
      />

      <div className="rounded-2xl border border-slate-200/60 bg-white/40 px-5 py-4 text-sm text-zinc-600 backdrop-blur dark:border-white/10 dark:bg-zinc-900/30 dark:text-zinc-300">
        <p className="font-semibold text-zinc-900 dark:text-white">What &ldquo;stale&rdquo; means</p>
        <p className="mt-1 leading-relaxed">
          A service is flagged stale if either of these is true:
        </p>
        <ul className="mt-1 ml-5 list-disc space-y-0.5">
          <li><span className="font-semibold text-zinc-700 dark:text-zinc-200">Not synced in 30+ days</span> — the catalog reconciler hasn&rsquo;t seen the repo recently (likely archived, renamed, or removed). Use the <span className="font-mono text-xs">&gt;30 days</span> / <span className="font-mono text-xs">&gt;60 days</span> filters to bucket by age.</li>
          <li><span className="font-semibold text-zinc-700 dark:text-zinc-200">Single environment only</span> — the service exists in just one of <span className="font-mono text-xs">production</span> / <span className="font-mono text-xs">staging</span> / <span className="font-mono text-xs">development</span>. That usually means promotion is incomplete or coverage is missing — not necessarily that the service itself is unused.</li>
        </ul>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          The dashboard&rsquo;s &ldquo;Stale &middot; Prod&rdquo; / &ldquo;Stale &middot; Dev&rdquo; tiles count only the first criterion (30+ days) per environment, matching the &ldquo;Stale &gt;30d&rdquo; stat below.
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Stale Total',  value: staleTotal },
          { label: 'Stale >30d',   value: stale30 },
          { label: 'Stale >60d',   value: stale60 },
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-slate-200/60 bg-white/60 px-5 py-4 shadow-xl shadow-slate-200/20 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{stat.label}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Environment filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {ENV_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => handleEnvChange(f.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              envFilter === f.value
                ? 'bg-indigo-600 text-white'
                : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Day-bucket filter */}
      <div className="flex items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === f.value
                ? 'bg-blue-600 text-white'
                : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-slate-200/60 bg-white/60 shadow-xl shadow-slate-200/20 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No services match this filter.</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-100 dark:divide-gray-800">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-400">
                <th className="px-5 py-3">Service</th>
                <th className="px-5 py-3">Owner Team</th>
                <th className="px-5 py-3">Runtime</th>
                <th className="px-5 py-3">Environments</th>
                <th className="px-5 py-3">Last Synced</th>
                <th className="px-5 py-3">Staleness</th>
                <th className="px-5 py-3">Reasons</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {filtered.map((svc) => (
                <tr key={svc.serviceId} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-5 py-3 text-sm font-medium">
                    <Link to={`/catalog/services/${svc.serviceId}`} className="text-blue-600 hover:underline">
                      {svc.serviceName}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-600 dark:text-gray-300">{svc.ownerTeam.teamName}</td>
                  <td className="px-5 py-3 text-sm text-gray-500 dark:text-gray-400">{svc.runtimeType}</td>
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
                    <div>{formatRelativeTime(svc.lastSyncedAt)}</div>
                    <div className="text-xs text-gray-400">{formatAbsoluteDate(svc.lastSyncedAt)}</div>
                  </td>
                  <td className="px-5 py-3">{stalenessBadge(svc.daysSinceSync)}</td>
                  <td className="px-5 py-3">
                    <div className="flex flex-col gap-0.5">
                      {svc.staleReasons.length === 0 ? (
                        <span className="text-xs text-gray-400">—</span>
                      ) : svc.staleReasons.map((r) => (
                        <span key={r} className="text-xs text-gray-500 dark:text-gray-400">{r}</span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
