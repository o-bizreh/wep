import React, { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@wep/ui';
import {
  Boxes, Search, X, ChevronDown, ChevronRight, ShieldAlert,
  AlertTriangle, CheckCircle2, RefreshCw, Upload, Package,
} from 'lucide-react';
import { fetchApi } from '../../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DepEntry {
  name: string;
  currentVersion: string;
  resolvedVersion?: string;
  latestVersion?: string;
  latestMajor?: number;
  majorsBehind?: number;
  hasKnownCVE?: boolean;
  isOutdated?: boolean;
  license?: string;
}

interface ServiceListingItem {
  serviceName: string;
  repoUrl: string;
  scannedAt: string;
  depCount: number;
  outdatedCount: number;
  cveCount: number;
  healthScore: number;
}

interface ServiceDetail {
  serviceName: string;
  repoUrl: string;
  scannedAt: string;
  nodeVersion?: string;
  dependencies: DepEntry[];
  devDependencies: DepEntry[];
  summary: { depCount: number; outdatedCount: number; cveCount: number; healthScore: number };
}

interface SummaryData {
  totalServices: number;
  totalUniqueDeps: number;
  pctOutdated: number;
  topOutdated: Array<{ name: string; serviceCount: number; avgMajorsBehind: number; hasCVE: boolean }>;
  topUsed: Array<{ name: string; serviceCount: number; hasCVE: boolean }>;
  servicesWithMostOutdated: Array<{ serviceName: string; outdatedCount: number; totalDeps: number }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function healthColor(score: number): string {
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 50) return 'bg-amber-500';
  return 'bg-red-500';
}

function healthLabel(score: number, cveCount: number): string {
  if (cveCount > 0) return 'bg-red-500';
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 50) return 'bg-amber-500';
  return 'bg-red-500';
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

type FilterMode = 'all' | 'outdated' | 'cve';

// ── Upload Snapshot Modal ────────────────────────────────────────────────────

function UploadModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [serviceName, setServiceName] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [packageJson, setPackageJson] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let parsed: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; engines?: { node?: string } };
    try {
      parsed = JSON.parse(packageJson) as typeof parsed;
    } catch {
      setError('Invalid JSON — paste a valid package.json');
      return;
    }

    const toDeps = (obj: Record<string, string> = {}): DepEntry[] =>
      Object.entries(obj).map(([name, currentVersion]) => ({ name, currentVersion }));

    setSaving(true);
    try {
      await fetchApi(`/dep-health/services/${encodeURIComponent(serviceName)}/snapshot`, {
        method: 'POST',
        body: JSON.stringify({
          repoUrl,
          nodeVersion: parsed.engines?.node,
          dependencies: toDeps(parsed.dependencies),
          devDependencies: toDeps(parsed.devDependencies),
        }),
      });
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [serviceName, repoUrl, packageJson, onClose, onSuccess]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-700">
          <h2 className="text-base font-black tracking-tight text-zinc-900 dark:text-white">Upload Snapshot</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">Service Name</label>
            <input
              required
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              placeholder="my-api"
              className="w-full rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">Repository URL</label>
            <input
              required
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/org/repo"
              className="w-full rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">package.json contents</label>
            <textarea
              required
              value={packageJson}
              onChange={(e) => setPackageJson(e.target.value)}
              rows={8}
              placeholder='{ "dependencies": { ... }, "devDependencies": { ... } }'
              className="w-full rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono resize-none"
            />
          </div>
          {error && (
            <p className="text-sm text-red-400 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 flex-shrink-0" />{error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-zinc-300 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Upload'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Dep Row ───────────────────────────────────────────────────────────────────

function DepRow({ dep, isDev }: { dep: DepEntry; isDev: boolean }) {
  const isOutdated = dep.isOutdated || (dep.majorsBehind ?? 0) > 0;
  return (
    <tr className="border-t border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:bg-zinc-800/40 transition-colors">
      <td className="px-4 py-2 text-sm font-mono text-zinc-200">{dep.name}</td>
      <td className="px-4 py-2 text-xs text-zinc-400 font-mono">{dep.currentVersion}</td>
      <td className="px-4 py-2 text-xs text-zinc-400 font-mono">{dep.latestVersion ?? '—'}</td>
      <td className="px-4 py-2 text-xs">
        {(dep.majorsBehind ?? 0) > 0
          ? <span className="inline-flex items-center rounded-md bg-amber-950/50 px-2 py-0.5 text-amber-400 ring-1 ring-amber-600/30 font-semibold">{dep.majorsBehind} major{dep.majorsBehind !== 1 ? 's' : ''} behind</span>
          : isOutdated
            ? <span className="inline-flex items-center rounded-md bg-amber-950/50 px-2 py-0.5 text-amber-400 ring-1 ring-amber-600/30 font-semibold">Outdated</span>
            : <span className="text-zinc-500">—</span>
        }
      </td>
      <td className="px-4 py-2 text-xs">
        {dep.hasKnownCVE
          ? <span className="inline-flex items-center gap-1 rounded-md bg-red-950/50 px-2 py-0.5 text-red-400 ring-1 ring-red-600/30 font-semibold"><ShieldAlert className="h-3 w-3" />CVE</span>
          : <span className="text-zinc-600">—</span>
        }
      </td>
      <td className="px-4 py-2 text-xs text-zinc-500">{dep.license ?? '—'}</td>
      <td className="px-4 py-2 text-xs text-zinc-600">{isDev ? 'dev' : 'prod'}</td>
    </tr>
  );
}

// ── Service Row + Inline Panel ────────────────────────────────────────────────

function ServiceRow({
  service,
  isExpanded,
  onToggle,
  isHighlighted,
}: {
  service: ServiceListingItem;
  isExpanded: boolean;
  onToggle: () => void;
  isHighlighted: boolean;
}) {
  const [detail, setDetail] = useState<ServiceDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    if (isExpanded && !detail && !loadingDetail) {
      setLoadingDetail(true);
      fetchApi<ServiceDetail>(`/dep-health/services/${encodeURIComponent(service.serviceName)}`)
        .then((d) => setDetail(d))
        .catch(() => setDetail(null))
        .finally(() => setLoadingDetail(false));
    }
  }, [isExpanded, detail, loadingDetail, service.serviceName]);

  const barColor = healthLabel(service.healthScore, service.cveCount);

  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-t border-zinc-200 dark:border-zinc-800 transition-colors ${isHighlighted ? 'bg-teal-50 dark:bg-teal-950/20' : 'hover:bg-zinc-100 dark:bg-zinc-800/40'}`}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {isExpanded ? <ChevronDown className="h-4 w-4 text-zinc-400 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 text-zinc-400 flex-shrink-0" />}
            <span className="text-sm font-semibold text-zinc-900 dark:text-white">{service.serviceName}</span>
          </div>
        </td>
        <td className="px-4 py-3 text-xs text-zinc-400">{timeAgo(service.scannedAt)}</td>
        <td className="px-4 py-3 text-sm text-zinc-300 tabular-nums">{service.depCount}</td>
        <td className="px-4 py-3">
          {service.outdatedCount > 0
            ? <span className="inline-flex items-center rounded-md bg-amber-950/50 px-2 py-0.5 text-xs font-semibold text-amber-400 ring-1 ring-amber-600/30">{service.outdatedCount}</span>
            : <span className="text-xs text-zinc-600">—</span>
          }
        </td>
        <td className="px-4 py-3">
          {service.cveCount > 0
            ? <span className="inline-flex items-center gap-1 rounded-md bg-red-950/50 px-2 py-0.5 text-xs font-semibold text-red-400 ring-1 ring-red-600/30"><ShieldAlert className="h-3 w-3" />{service.cveCount}</span>
            : <span className="text-xs text-zinc-600">—</span>
          }
        </td>
        <td className="px-4 py-3 min-w-[120px]">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
              <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${service.healthScore}%` }} />
            </div>
            <span className="text-xs tabular-nums text-zinc-400 w-7 text-right">{service.healthScore}</span>
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr className="border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60">
          <td colSpan={6} className="px-4 py-4">
            {loadingDetail && (
              <div className="flex items-center gap-2 text-sm text-zinc-400 py-2">
                <RefreshCw className="h-4 w-4 animate-spin" />Loading dependencies…
              </div>
            )}
            {!loadingDetail && !detail && (
              <p className="text-sm text-zinc-500 py-2">Failed to load dependency details.</p>
            )}
            {!loadingDetail && detail && (
              <div>
                <div className="flex items-center gap-4 mb-3 text-xs text-zinc-400">
                  {detail.nodeVersion && <span>Node {detail.nodeVersion}</span>}
                  <a href={detail.repoUrl} target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:underline">{detail.repoUrl}</a>
                  <span>Scanned {new Date(detail.scannedAt).toLocaleString()}</span>
                </div>
                <div className="overflow-x-auto rounded-xl border border-zinc-800">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-zinc-100 dark:bg-zinc-800/60">
                        <th className="px-4 py-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Package</th>
                        <th className="px-4 py-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Current</th>
                        <th className="px-4 py-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Latest</th>
                        <th className="px-4 py-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Status</th>
                        <th className="px-4 py-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">CVE</th>
                        <th className="px-4 py-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">License</th>
                        <th className="px-4 py-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.dependencies.map((dep) => <DepRow key={dep.name} dep={dep} isDev={false} />)}
                      {detail.devDependencies.map((dep) => <DepRow key={`dev:${dep.name}`} dep={dep} isDev={true} />)}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function DepHealthPage() {
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [services, setServices] = useState<ServiceListingItem[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingServices, setLoadingServices] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [expandedService, setExpandedService] = useState<string | null>(null);
  const [depFilter, setDepFilter] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  const loadData = useCallback(() => {
    setLoadingSummary(true);
    setLoadingServices(true);
    setError(null);

    fetchApi<SummaryData>('/dep-health/summary')
      .then((d) => setSummary(d))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoadingSummary(false));

    fetchApi<{ services: ServiceListingItem[] }>('/dep-health/services')
      .then((d) => setServices(d.services))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoadingServices(false));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const isEmpty = !loadingServices && services.length === 0;

  const filteredServices = services.filter((s) => {
    const matchesSearch = !search || s.serviceName.toLowerCase().includes(search.toLowerCase());
    const matchesFilter =
      filter === 'all' ? true
      : filter === 'outdated' ? s.outdatedCount > 0
      : s.cveCount > 0;
    const matchesDep = !depFilter; // dep filter is visual only — can't filter without full dep data loaded
    return matchesSearch && matchesFilter && (matchesDep || true);
  });

  // When a dep is clicked in top outdated, filter the services table
  const handleDepClick = (depName: string) => {
    setDepFilter(depFilter === depName ? null : depName);
    setSearch(depFilter === depName ? '' : depName);
  };

  const totalCveCount = services.reduce((sum, s) => sum + s.cveCount, 0);

  return (
    <div className="min-h-screen bg-white dark:bg-[#0b0c10] text-zinc-900 dark:text-white">
      <PageHeader
        title="Dependency Health"
        actions={
          <button
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-sm font-semibold transition-colors"
          >
            <Upload className="h-4 w-4" />
            Upload Snapshot
          </button>
        }
      />

      <div className="mx-auto max-w-7xl px-6 pb-16 space-y-8">

        {/* Summary Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            {
              label: 'Services Scanned',
              value: loadingSummary ? '—' : String(summary?.totalServices ?? 0),
              icon: <Package className="h-5 w-5 text-teal-400" />,
            },
            {
              label: 'Total Dependencies',
              value: loadingSummary ? '—' : String(summary?.totalUniqueDeps ?? 0),
              icon: <Boxes className="h-5 w-5 text-blue-400" />,
            },
            {
              label: 'Outdated Packages',
              value: loadingSummary ? '—' : `${summary?.pctOutdated ?? 0}%`,
              icon: <AlertTriangle className="h-5 w-5 text-amber-400" />,
              accent: (summary?.pctOutdated ?? 0) > 20 ? 'text-amber-500' : 'text-zinc-900 dark:text-white',
            },
            {
              label: 'CVE-Affected',
              value: loadingSummary ? '—' : String(totalCveCount),
              icon: <ShieldAlert className="h-5 w-5 text-red-500" />,
              accent: totalCveCount > 0 ? 'text-red-500' : 'text-zinc-900 dark:text-white',
            },
          ].map((card) => (
            <div key={card.label} className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 flex items-center gap-4">
              <div className="rounded-xl bg-zinc-100 dark:bg-zinc-800 p-2.5 flex-shrink-0">{card.icon}</div>
              <div>
                <p className="text-xs text-zinc-500 font-medium">{card.label}</p>
                <p className={`text-2xl font-black tracking-tight mt-0.5 ${card.accent ?? 'text-zinc-900 dark:text-white'}`}>{card.value}</p>
              </div>
            </div>
          ))}
        </div>

        {error && (
          <div className="rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/40 px-5 py-4 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />{error}
          </div>
        )}

        {/* Empty State */}
        {isEmpty && !error && (
          <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-12 flex flex-col items-center text-center gap-4">
            <div className="rounded-2xl bg-zinc-100 dark:bg-zinc-800 p-4">
              <Boxes className="h-10 w-10 text-zinc-400 dark:text-zinc-500" />
            </div>
            <div>
              <h3 className="text-lg font-black tracking-tight text-zinc-900 dark:text-white">No snapshots yet</h3>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 max-w-sm">
                The ECS scanner populates this dashboard by fetching <code className="text-teal-400 text-xs">package.json</code> from each service's GitHub repository. You can also upload a snapshot manually.
              </p>
            </div>
            <button
              onClick={() => setShowUpload(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-semibold transition-colors mt-2"
            >
              <Upload className="h-4 w-4" />
              Upload Snapshot
            </button>
          </div>
        )}

        {!isEmpty && (
          <>
            {/* Search + Filter */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
                <input
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); if (depFilter) setDepFilter(null); }}
                  placeholder="Search by service or dependency name…"
                  className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
                {search && (
                  <button onClick={() => { setSearch(''); setDepFilter(null); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="flex gap-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-1">
                {(['all', 'outdated', 'cve'] as FilterMode[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${filter === f ? 'bg-teal-600 text-white' : 'text-zinc-400 hover:text-zinc-900 dark:hover:text-white'}`}
                  >
                    {f === 'cve' ? 'Has CVE' : f === 'outdated' ? 'Outdated Only' : 'All'}
                  </button>
                ))}
              </div>
              <button onClick={loadData} className="p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors" title="Refresh">
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>

            {depFilter && (
              <div className="flex items-center gap-2 text-sm text-teal-400">
                <Package className="h-4 w-4" />
                Filtering by dependency: <span className="font-mono font-semibold">{depFilter}</span>
                <button onClick={() => { setDepFilter(null); setSearch(''); }} className="ml-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-white">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            {/* Services Table */}
            <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
                <h2 className="text-sm font-black tracking-tight text-zinc-900 dark:text-white">Services</h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-0.5">{filteredServices.length} of {services.length} services — click a row to expand dependencies</p>
              </div>
              {loadingServices ? (
                <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400 p-6">
                  <RefreshCw className="h-4 w-4 animate-spin" />Loading services…
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-zinc-50 dark:bg-zinc-800/50">
                        <th className="px-4 py-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Service</th>
                        <th className="px-4 py-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Last Scanned</th>
                        <th className="px-4 py-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Dependencies</th>
                        <th className="px-4 py-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Outdated</th>
                        <th className="px-4 py-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400">CVEs</th>
                        <th className="px-4 py-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Health Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredServices.map((s) => (
                        <ServiceRow
                          key={s.serviceName}
                          service={s}
                          isExpanded={expandedService === s.serviceName}
                          onToggle={() => setExpandedService(expandedService === s.serviceName ? null : s.serviceName)}
                          isHighlighted={depFilter !== null}
                        />
                      ))}
                      {filteredServices.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-10 text-center text-sm text-zinc-500">
                            No services match your search or filter.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Top Outdated Dependencies */}
            {summary && summary.topOutdated.length > 0 && (
              <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
                  <h2 className="text-sm font-black tracking-tight text-zinc-900 dark:text-white">Top Outdated Dependencies</h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-0.5">Ranked by average majors behind — click to filter services table</p>
                </div>
                <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {summary.topOutdated.map((dep, i) => (
                    <button
                      key={dep.name}
                      onClick={() => handleDepClick(dep.name)}
                      className={`w-full flex items-center gap-4 px-5 py-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50 ${depFilter === dep.name ? 'bg-teal-50 dark:bg-teal-950/20' : ''}`}
                    >
                      <span className="w-6 text-xs text-zinc-600 dark:text-zinc-400 font-mono tabular-nums text-right flex-shrink-0">{i + 1}</span>
                      <span className="flex-1 font-mono text-sm font-semibold text-teal-300">{dep.name}</span>
                      <span className="text-xs text-zinc-400">{dep.serviceCount} service{dep.serviceCount !== 1 ? 's' : ''}</span>
                      <span className="inline-flex items-center rounded-md bg-amber-950/50 px-2 py-0.5 text-xs font-semibold text-amber-400 ring-1 ring-amber-600/30">
                        ~{dep.avgMajorsBehind.toFixed(1)} majors behind
                      </span>
                      {dep.hasCVE && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-red-950/50 px-2 py-0.5 text-xs font-semibold text-red-400 ring-1 ring-red-600/30">
                          <ShieldAlert className="h-3 w-3" />CVE
                        </span>
                      )}
                      {!dep.hasCVE && (
                        <CheckCircle2 className="h-3.5 w-3.5 text-zinc-700 flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onSuccess={loadData}
        />
      )}
    </div>
  );
}
