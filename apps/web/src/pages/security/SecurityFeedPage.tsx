import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PageHeader } from '@wep/ui';
import {
  ShieldAlert, ShieldCheck, RefreshCw, ChevronDown, ChevronRight,
  AlertTriangle, Flame, Package, Search, X, GitBranch
} from 'lucide-react';
import { fetchApi } from '../../lib/api';

interface VulnPackage {
  ecosystem: string;
  name: string;
  sources: string[];
  versions: string[];
  totalCves: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  exploitedCount: number;
  lastCheckedAt: string;
  depth?: 'direct' | 'transitive';
  dependencyPath?: string[];
}

function DepthBadge({ depth, path }: { depth?: 'direct' | 'transitive'; path?: string[] }) {
  if (!depth) return null;
  if (depth === 'direct') {
    return (
      <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-950/30 dark:text-emerald-400">
        Direct
      </span>
    );
  }
  const via = path && path.length > 0 ? `via ${path.slice(0, 2).join(' → ')}${path.length > 2 ? ' …' : ''}` : '';
  return (
    <span
      className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-950/30 dark:text-amber-400 cursor-default"
      title={path && path.length > 0 ? `Full path: ${path.join(' → ')}` : undefined}
    >
      Transitive{via ? ` · ${via}` : ''}
    </span>
  );
}

interface CveEntry {
  cveId: string;
  aliases: string[];
  summary: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  cvssScore: number | null;
  publishedAt: string;
  isKevExploited: boolean;
  osvId: string;
  referenceUrl: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700 ring-red-600/20 dark:bg-red-950/30 dark:text-red-400',
  HIGH:     'bg-orange-100 text-orange-700 ring-orange-600/20 dark:bg-orange-950/30 dark:text-orange-400',
  MEDIUM:   'bg-amber-100 text-amber-700 ring-amber-600/20 dark:bg-amber-950/30 dark:text-amber-400',
  LOW:      'bg-blue-100 text-blue-700 ring-blue-600/20 dark:bg-blue-950/30 dark:text-blue-400',
  UNKNOWN:  'bg-gray-100 text-gray-600 ring-gray-400/20 dark:bg-gray-800 dark:text-gray-400',
};

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${SEVERITY_COLOR[severity] ?? SEVERITY_COLOR['UNKNOWN']}`}>
      {severity}
    </span>
  );
}

function CveDrawer({ pkg, onClose }: { pkg: VulnPackage; onClose: () => void }) {
  const [cves, setCves] = useState<CveEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchApi<{ cves: CveEntry[] }>(`/security/vulnerabilities/${pkg.ecosystem}/${encodeURIComponent(pkg.name)}`)
      .then((d) => setCves(d.cves))
      .catch(() => setCves([]))
      .finally(() => setLoading(false));
  }, [pkg.ecosystem, pkg.name]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-xl h-full bg-white dark:bg-zinc-900 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-gray-100 dark:border-white/10">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Package className="h-4 w-4 text-gray-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">{pkg.ecosystem}</span>
            </div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white font-mono">{pkg.name}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{pkg.sources.length} project{pkg.sources.length !== 1 ? 's' : ''} · versions: {pkg.versions.join(', ')}</p>
            <div className="mt-1.5">
              <DepthBadge depth={pkg.depth} path={pkg.dependencyPath} />
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Summary pills */}
        <div className="flex gap-2 flex-wrap px-6 py-3 border-b border-gray-100 dark:border-white/10">
          {pkg.criticalCount > 0 && <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${SEVERITY_COLOR['CRITICAL']}`}>{pkg.criticalCount} Critical</span>}
          {pkg.highCount > 0 && <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${SEVERITY_COLOR['HIGH']}`}>{pkg.highCount} High</span>}
          {pkg.mediumCount > 0 && <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${SEVERITY_COLOR['MEDIUM']}`}>{pkg.mediumCount} Medium</span>}
          {pkg.lowCount > 0 && <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${SEVERITY_COLOR['LOW']}`}>{pkg.lowCount} Low</span>}
          {pkg.exploitedCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium bg-red-600 text-white">
              <Flame className="h-3 w-3" /> {pkg.exploitedCount} Actively Exploited
            </span>
          )}
        </div>

        {/* Source repos */}
        {pkg.sources.length > 0 && (
          <div className="px-6 py-3 border-b border-gray-100 dark:border-white/10">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Used in</p>
            <div className="flex gap-2 flex-wrap">
              {pkg.sources.map((s) => (
                <span key={s} className="rounded-md bg-gray-100 dark:bg-zinc-800 px-2 py-0.5 text-xs font-mono text-gray-700 dark:text-gray-300">{s}</span>
              ))}
            </div>
          </div>
        )}

        {/* CVE list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-12 text-gray-400 text-sm">Loading CVEs…</div>
          ) : cves.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-gray-400">
              <ShieldCheck className="h-8 w-8 mb-2 text-emerald-400" />
              <p className="text-sm">No known CVEs for this package.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-white/5">
              {cves.map((cve) => (
                <div key={cve.cveId} className="px-6 py-4">
                  <div className="flex items-start justify-between gap-3 mb-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-semibold text-gray-900 dark:text-white">{cve.cveId}</span>
                      <SeverityBadge severity={cve.severity} />
                      {cve.isKevExploited && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2 py-0.5 text-xs font-medium text-white">
                          <Flame className="h-3 w-3" /> KEV
                        </span>
                      )}
                    </div>
                    {cve.cvssScore !== null && (
                      <span className="shrink-0 text-xs font-bold text-gray-500">CVSS {cve.cvssScore}</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mb-2">{cve.summary}</p>
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span>Published {new Date(cve.publishedAt).toLocaleDateString()}</span>
                    {cve.referenceUrl && (
                      <a href={cve.referenceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Advisory ↗</a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RepoMultiSelect({
  options,
  selected,
  onChange,
}: {
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (repo: string) => {
    const next = new Set(selected);
    next.has(repo) ? next.delete(repo) : next.add(repo);
    onChange(next);
  };

  const label = selected.size === 0
    ? 'All Repositories'
    : selected.size === 1
      ? [...selected][0]!.split('/')[1]!
      : `${selected.size} repos`;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm bg-white dark:bg-gray-900 dark:text-white transition-colors ${
          selected.size > 0
            ? 'border-indigo-400 dark:border-indigo-600 text-indigo-600 dark:text-indigo-400'
            : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300'
        }`}
      >
        <GitBranch className="h-3.5 w-3.5 shrink-0" />
        <span className="max-w-32 truncate">{label}</span>
        {selected.size > 0 && (
          <span
            className="ml-1 rounded-full bg-indigo-600 text-white text-[10px] font-bold w-4 h-4 flex items-center justify-center shrink-0"
            onClick={(e) => { e.stopPropagation(); onChange(new Set()); }}
          >
            ✕
          </span>
        )}
      </button>

      {open && options.length > 0 && (
        <div className="absolute top-full left-0 z-50 mt-1.5 w-56 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-xl shadow-black/10 dark:shadow-black/40 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100 dark:border-white/5 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Repositories</span>
            {selected.size > 0 && (
              <button onClick={() => onChange(new Set())} className="text-xs text-indigo-500 hover:underline">Clear</button>
            )}
          </div>
          <div className="max-h-56 overflow-y-auto">
            {options.map((repo) => (
              <label key={repo} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                <input
                  type="checkbox"
                  checked={selected.has(repo)}
                  onChange={() => toggle(repo)}
                  className="rounded border-gray-300 accent-indigo-600"
                />
                <span className="text-xs font-mono text-gray-700 dark:text-gray-300 truncate">{repo}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function SecurityFeedPage() {
  const [packages, setPackages] = useState<VulnPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [exploitedOnly, setExploitedOnly] = useState(false);
  const [hideClean, setHideClean] = useState(true);
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
  const [selectedPkg, setSelectedPkg] = useState<VulnPackage | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const data = await fetchApi<VulnPackage[]>('/security/vulnerabilities');
      setPackages(data);
    } catch (e) {
      console.error('[security-feed] Failed to load:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleScanAll = async () => {
    setScanning(true);
    try {
      await fetchApi('/security/scan/all', { method: 'POST', body: JSON.stringify({}) });
      // Poll until scan settles (repos update their lastScanStatus independently)
      setTimeout(() => { void load(); setScanning(false); }, 3000);
    } catch (e) {
      console.error('[security-feed] Scan failed:', e);
      setScanning(false);
    }
  };

  const allRepos = Array.from(
    new Set(packages.flatMap((p) => p.sources).filter((s) => s !== 'radar'))
  ).sort();

  const filtered = packages
    .filter((p) => {
      if (hideClean && p.totalCves === 0) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (exploitedOnly && p.exploitedCount === 0) return false;
      if (severityFilter === 'critical' && p.criticalCount === 0) return false;
      if (severityFilter === 'high' && p.highCount + p.criticalCount === 0) return false;
      if (selectedRepos.size > 0 && !p.sources.some((s) => selectedRepos.has(s))) return false;
      return true;
    })
    .sort((a, b) => b.totalCves - a.totalCves);

  const totalCritical = packages.reduce((s, p) => s + p.criticalCount, 0);
  const totalHigh = packages.reduce((s, p) => s + p.highCount, 0);
  const totalExploited = packages.filter((p) => p.exploitedCount > 0).length;

  const toggleRow = (key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vulnerability Feed"
        actions={
          <button
            onClick={() => { void handleScanAll(); }}
            disabled={scanning}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? 'Scanning…' : 'Scan All'}
          </button>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Tracked Packages', value: packages.length, icon: <Package className="h-5 w-5 text-indigo-500" /> },
          { label: 'Total CVEs', value: packages.reduce((s, p) => s + p.totalCves, 0), icon: <ShieldAlert className="h-5 w-5 text-orange-500" /> },
          { label: 'Critical', value: totalCritical, icon: <AlertTriangle className="h-5 w-5 text-red-500" /> },
          { label: 'Actively Exploited', value: totalExploited, icon: <Flame className="h-5 w-5 text-red-600" /> },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-slate-200/60 bg-white/60 p-5 shadow-xl shadow-slate-200/20 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-gray-50 dark:bg-gray-800">{s.icon}</div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{s.label}</p>
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200/50 bg-white/40 dark:border-white/5 dark:bg-zinc-900/20 px-4 py-3 backdrop-blur-md">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search package name…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-white focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-white px-3 py-2"
        >
          <option value="all">All Severities</option>
          <option value="critical">Critical only</option>
          <option value="high">High+</option>
        </select>
        <RepoMultiSelect
          options={allRepos}
          selected={selectedRepos}
          onChange={setSelectedRepos}
        />
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hideClean}
            onChange={(e) => setHideClean(e.target.checked)}
            className="rounded border-gray-300"
          />
          Hide packages without CVEs
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={exploitedOnly}
            onChange={(e) => setExploitedOnly(e.target.checked)}
            className="rounded border-gray-300"
          />
          Exploited only
        </label>
        <span className="text-xs text-gray-400 ml-auto">{filtered.length} packages</span>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-slate-200/60 bg-white dark:border-white/10 dark:bg-zinc-900/40 overflow-hidden shadow-xl shadow-slate-200/20 dark:shadow-black/40">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-white/10 bg-gray-50/50 dark:bg-white/5">
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 w-8"></th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Package</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 hidden md:table-cell">Projects</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Total CVEs</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 hidden lg:table-cell">Breakdown</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Exploited</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 hidden lg:table-cell">Last Checked</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-white/5">
            {loading ? (
              <tr><td colSpan={7} className="py-12 text-center text-gray-400 text-sm">Loading vulnerability data…</td></tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center">
                  <ShieldCheck className="mx-auto h-8 w-8 text-emerald-400 mb-2" />
                  <p className="text-sm text-gray-500">No vulnerabilities found.</p>
                </td>
              </tr>
            ) : (
              filtered.map((pkg) => {
                const key = `${pkg.ecosystem}/${pkg.name}`;
                const isExpanded = expandedRows.has(key);
                return (
                  <React.Fragment key={key}>
                  <tr
                    className="hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer transition-colors"
                    onClick={() => setSelectedPkg(pkg)}
                  >
                    <td className="px-4 py-3" onClick={(e) => { e.stopPropagation(); toggleRow(key); }}>
                      {isExpanded
                        ? <ChevronDown className="h-4 w-4 text-gray-400" />
                        : <ChevronRight className="h-4 w-4 text-gray-400" />}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Package className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                        <span className="font-mono font-medium text-gray-900 dark:text-white">{pkg.name}</span>
                        <span className="text-xs text-gray-400 uppercase">{pkg.ecosystem}</span>
                        <DepthBadge depth={pkg.depth} path={pkg.dependencyPath} />
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-gray-600 dark:text-gray-400">{pkg.sources.length}</span>
                    </td>
                    <td className="px-4 py-3">
                      {pkg.totalCves > 0 ? (
                        <span className="font-bold text-gray-900 dark:text-white">{pkg.totalCves}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <div className="flex items-center gap-1.5">
                        {pkg.criticalCount > 0 && <span className="rounded px-1.5 py-0.5 text-xs font-bold bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400">{pkg.criticalCount}C</span>}
                        {pkg.highCount > 0 && <span className="rounded px-1.5 py-0.5 text-xs font-bold bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400">{pkg.highCount}H</span>}
                        {pkg.mediumCount > 0 && <span className="rounded px-1.5 py-0.5 text-xs font-bold bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">{pkg.mediumCount}M</span>}
                        {pkg.lowCount > 0 && <span className="rounded px-1.5 py-0.5 text-xs font-bold bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400">{pkg.lowCount}L</span>}
                        {pkg.totalCves === 0 && <span className="text-gray-400 text-xs">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {pkg.exploitedCount > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2 py-0.5 text-xs font-medium text-white">
                          <Flame className="h-3 w-3" /> {pkg.exploitedCount}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">No</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 hidden lg:table-cell">
                      {pkg.lastCheckedAt ? new Date(pkg.lastCheckedAt).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-gray-50/50 dark:bg-white/[0.02]">
                      <td />
                      <td colSpan={6} className="px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Used in</p>
                        <div className="flex flex-wrap gap-2">
                          {pkg.sources.length === 0 ? (
                            <span className="text-xs text-gray-400">No sources recorded</span>
                          ) : pkg.sources.map((s) => (
                            s === 'radar' ? (
                              <span key={s} className="inline-flex items-center gap-1.5 rounded-md bg-white dark:bg-zinc-800 border border-gray-200 dark:border-white/10 px-2.5 py-1 text-xs font-mono text-gray-700 dark:text-gray-300">
                                <GitBranch className="h-3 w-3 text-gray-400" />{s}
                              </span>
                            ) : (
                              <a
                                key={s}
                                href={`https://github.com/${s}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1.5 rounded-md bg-white dark:bg-zinc-800 border border-gray-200 dark:border-white/10 px-2.5 py-1 text-xs font-mono text-indigo-600 dark:text-indigo-400 hover:border-indigo-400 dark:hover:border-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/20 transition-colors"
                              >
                                <GitBranch className="h-3 w-3" />{s}
                              </a>
                            )
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* CVE detail drawer */}
      {selectedPkg && <CveDrawer pkg={selectedPkg} onClose={() => setSelectedPkg(null)} />}
    </div>
  );
}
