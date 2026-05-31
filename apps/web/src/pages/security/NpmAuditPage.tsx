import { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@wep/ui';
import {
  Package, ShieldAlert, ShieldCheck, RefreshCw, Loader2,
  AlertTriangle, Flame, ChevronDown, ChevronRight, Search, X,
} from 'lucide-react';
import { fetchApi } from '../../lib/api';

interface Advisory {
  ghsaId: string;
  cveId: string | null;
  summary: string;
  severity: 'critical' | 'high' | 'moderate' | 'low' | 'info';
  publishedAt: string;
  cvssScore: number | null;
  fixedIn?: string | null;
}

interface VulnerableDep {
  packageName: string;
  installedVersion: string;
  fixedIn: string | null;
  isDirect: boolean;
  advisories: Advisory[];
}

interface RepoScanResult {
  repoFullName: string;
  scannedAt: string;
  pushedAt: string;
  deps: VulnerableDep[];
  totalVulns: number;
  critical: number;
  high: number;
  moderate: number;
  low: number;
  error: string | null;
}

interface ScanRun {
  runId: string;
  org: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'pending' | 'scanning' | 'done' | 'failed' | 'idle';
  reposScanned: number;
  reposTotal: number;
  error: string | null;
}

const SEV_STYLE: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 ring-1 ring-red-600/20 dark:bg-red-950/30 dark:text-red-400',
  high:     'bg-orange-100 text-orange-700 ring-1 ring-orange-600/20 dark:bg-orange-950/30 dark:text-orange-400',
  moderate: 'bg-amber-100 text-amber-700 ring-1 ring-amber-600/20 dark:bg-amber-950/30 dark:text-amber-400',
  low:      'bg-blue-100 text-blue-700 ring-1 ring-blue-600/20 dark:bg-blue-950/30 dark:text-blue-400',
  info:     'bg-gray-100 text-gray-600 ring-1 ring-gray-600/20 dark:bg-gray-800 dark:text-gray-400',
};

function SevBadge({ sev, count }: { sev: string; count: number }) {
  if (count === 0) return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${SEV_STYLE[sev] ?? SEV_STYLE['info']}`}>
      {count} {sev}
    </span>
  );
}

function DepRow({ dep }: { dep: VulnerableDep }) {
  const [open, setOpen] = useState(false);
  const maxSev = dep.advisories.reduce((best, a) => {
    const order = ['critical', 'high', 'moderate', 'low', 'info'];
    return order.indexOf(a.severity) < order.indexOf(best) ? a.severity : best;
  }, 'info' as string);
  return (
    <div className="border-t border-gray-100 dark:border-gray-800">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-gray-400 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400 shrink-0" />}
        <Package className="h-4 w-4 text-gray-400 shrink-0" />
        <span className="font-mono text-sm font-medium text-gray-900 dark:text-gray-100">{dep.packageName}</span>
        <span className="text-xs text-gray-500">{dep.installedVersion}</span>
        {dep.fixedIn && <span className="text-xs text-emerald-600 dark:text-emerald-400">→ {dep.fixedIn}</span>}
        <span className={`ml-auto text-xs rounded px-1.5 py-0.5 ${SEV_STYLE[maxSev] ?? ''}`}>{maxSev}</span>
        {dep.isDirect
          ? <span className="text-xs text-emerald-600 dark:text-emerald-400 shrink-0">direct</span>
          : <span className="text-xs text-amber-600 dark:text-amber-400 shrink-0">transitive</span>}
        <span className="text-xs text-gray-400 shrink-0">{dep.advisories.length} advisory</span>
      </button>
      {open && (
        <div className="pl-10 pr-4 pb-3 space-y-2">
          {dep.advisories.map((adv) => (
            <div key={adv.ghsaId} className="rounded-md border border-gray-200 dark:border-gray-700 p-3 text-sm">
              <div className="flex items-start gap-2">
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${SEV_STYLE[adv.severity] ?? ''}`}>{adv.severity}</span>
                <span className="text-gray-700 dark:text-gray-300">{adv.summary}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-2 text-xs text-gray-500">
                <span className="font-mono">{adv.ghsaId}</span>
                {adv.cveId && <span className="font-mono">{adv.cveId}</span>}
                {adv.cvssScore != null && <span>CVSS {adv.cvssScore}</span>}
                <span>{new Date(adv.publishedAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RepoRow({ result }: { result: RepoScanResult }) {
  const [open, setOpen] = useState(false);
  const hasVulns = result.totalVulns > 0;

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <button
        onClick={() => hasVulns && setOpen(!open)}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left ${hasVulns ? 'hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer' : 'cursor-default'} transition-colors bg-white dark:bg-gray-900`}
      >
        {hasVulns
          ? (open ? <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />)
          : <span className="w-4 shrink-0" />}
        {hasVulns
          ? <ShieldAlert className="h-4 w-4 text-red-500 shrink-0" />
          : <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />}
        <span className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">{result.repoFullName}</span>
        {result.error && !hasVulns && (
          <span className="ml-2 text-xs text-gray-400">{result.error}</span>
        )}
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <SevBadge sev="critical" count={result.critical} />
          <SevBadge sev="high" count={result.high} />
          <SevBadge sev="moderate" count={result.moderate} />
          <SevBadge sev="low" count={result.low} />
          {!hasVulns && !result.error && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">clean</span>
          )}
        </div>
      </button>
      {open && hasVulns && (
        <div className="bg-gray-50 dark:bg-gray-900/50">
          {result.deps.map((dep) => <DepRow key={dep.packageName} dep={dep} />)}
        </div>
      )}
    </div>
  );
}

export function NpmAuditPage() {
  const [results, setResults] = useState<RepoScanResult[]>([]);
  const [scanRun, setScanRun] = useState<ScanRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'vulnerable' | 'clean'>('all');

  const loadResults = useCallback(async () => {
    try {
      const [res, status] = await Promise.all([
        fetchApi<RepoScanResult[]>('/npm-audit/results'),
        fetchApi<ScanRun>('/npm-audit/status'),
      ]);
      setResults(res);
      if (status) setScanRun(status);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadResults(); }, [loadResults]);

  useEffect(() => {
    if (scanRun?.status !== 'scanning') { setScanning(false); return; }
    setScanning(true);
    const id = setInterval(async () => {
      try {
        const s = await fetchApi<ScanRun>('/npm-audit/status');
        if (s) {
          setScanRun(s);
          if (s.status !== 'scanning') {
            clearInterval(id);
            setScanning(false);
            loadResults();
          }
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanRun?.status]);

  async function triggerScan() {
    setScanning(true);
    try {
      await fetchApi('/npm-audit/scan', { method: 'POST' });
      const s = await fetchApi<ScanRun>('/npm-audit/status');
      if (s) setScanRun(s);
    } catch { /* ignore */ }
  }

  const filtered = results.filter((r) => {
    if (filter === 'vulnerable' && r.totalVulns === 0) return false;
    if (filter === 'clean' && r.totalVulns > 0) return false;
    if (search) return r.repoFullName.toLowerCase().includes(search.toLowerCase());
    return true;
  });

  const totals = results.reduce(
    (acc, r) => ({ critical: acc.critical + r.critical, high: acc.high + r.high, moderate: acc.moderate + r.moderate, low: acc.low + r.low }),
    { critical: 0, high: 0, moderate: 0, low: 0 },
  );
  const vulnRepos = results.filter((r) => r.totalVulns > 0).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="npm Audit"
        actions={
          <button
            onClick={triggerScan}
            disabled={scanning}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {scanning ? 'Scanning…' : 'Run Scan'}
          </button>
        }
      />

      {scanning && scanRun && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950/30 px-4 py-3 flex items-center gap-3 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-indigo-600 shrink-0" />
          <span className="text-indigo-700 dark:text-indigo-300">
            Scanning {scanRun.reposScanned} / {scanRun.reposTotal || '…'} repos
          </span>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Critical', count: totals.critical, icon: Flame, color: 'text-red-600 dark:text-red-400' },
          { label: 'High', count: totals.high, icon: AlertTriangle, color: 'text-orange-600 dark:text-orange-400' },
          { label: 'Moderate', count: totals.moderate, icon: ShieldAlert, color: 'text-amber-600 dark:text-amber-400' },
          { label: 'Vulnerable repos', count: vulnRepos, icon: Package, color: 'text-gray-700 dark:text-gray-300' },
        ].map(({ label, count, icon: Icon, color }) => (
          <div key={label} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
            <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
              <Icon className={`h-4 w-4 ${color}`} />
              {label}
            </div>
            <div className={`text-2xl font-bold ${color}`}>{count}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Filter by repo name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {(['all', 'vulnerable', 'clean'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filter === f ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-indigo-400'}`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <span className="text-xs text-gray-500">{filtered.length} repos</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-20 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 py-16 text-center text-sm text-gray-500">
          {results.length === 0 ? 'No scan data yet. Click "Run Scan" to start.' : 'No repos match the current filter.'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => <RepoRow key={r.repoFullName} result={r} />)}
        </div>
      )}

      {scanRun?.finishedAt && (
        <p className="text-xs text-gray-400 text-right">
          Last scan finished {new Date(scanRun.finishedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
