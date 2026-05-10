import { useState, useEffect, useCallback, useRef } from 'react';
import { PageHeader } from '@wep/ui';
import { GitBranch, Plus, Trash2, RefreshCw, Clock, CheckCircle, XCircle, Loader2, X, Search, Sparkles, ShieldAlert } from 'lucide-react';
import { fetchApi } from '../../lib/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MonitoredRepo {
  owner: string;
  name: string;
  fullName: string;
  addedBy: string;
  addedAt: string;
  lastScannedAt: string | null;
  lastScanStatus: 'pending' | 'scanning' | 'done' | 'failed';
  lastScanError: string | null;
  packageCount: number;
}

function StatusIcon({ status }: { status: MonitoredRepo['lastScanStatus'] }) {
  if (status === 'done') return <CheckCircle className="h-4 w-4 text-emerald-500" />;
  if (status === 'failed') return <XCircle className="h-4 w-4 text-red-500" />;
  if (status === 'scanning') return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
  return <Clock className="h-4 w-4 text-gray-400" />;
}

interface GithubRepoResult {
  name: string;
  fullName: string;
  description: string;
  defaultBranch: string;
}

function AddRepoModal({ onClose, onAdded }: { onClose: () => void; onAdded: (r: MonitoredRepo) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GithubRepoResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<GithubRepoResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSelected(null);
    if (!query.trim()) { setResults([]); return; }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await fetchApi<GithubRepoResult[]>(
          `/aws-resources/github/repos/search?q=${encodeURIComponent(query)}`
        );
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, [query]);

  const handleAdd = async (repo: GithubRepoResult) => {
    setSaving(true);
    setError(null);
    try {
      const added = await fetchApi<MonitoredRepo>('/security/repos', {
        method: 'POST',
        body: JSON.stringify({ fullName: repo.fullName }),
      });
      onAdded(added);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add repo');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200/60 bg-white/90 dark:border-white/10 dark:bg-zinc-900/90 p-6 shadow-2xl">
        <div className="flex justify-between items-center mb-5">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Add Repository</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X className="h-5 w-5" /></button>
        </div>

        {error && <p className="mb-4 rounded-lg bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 animate-spin" />}
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search repository name…"
            className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-white focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>

        {/* Results list */}
        {results.length > 0 && (
          <div className="mt-2 rounded-xl border border-gray-200 dark:border-white/10 overflow-hidden">
            {results.map((repo) => (
              <button
                key={repo.fullName}
                onClick={() => { setSelected(repo); void handleAdd(repo); }}
                disabled={saving}
                className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-indigo-50 dark:hover:bg-indigo-950/20 border-b border-gray-100 dark:border-white/5 last:border-0 transition-colors disabled:opacity-50"
              >
                <GitBranch className="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-mono font-medium text-gray-900 dark:text-white truncate">{repo.fullName}</p>
                  {repo.description && (
                    <p className="text-xs text-gray-400 truncate mt-0.5">{repo.description}</p>
                  )}
                </div>
                {saving && selected?.fullName === repo.fullName && (
                  <Loader2 className="h-4 w-4 text-indigo-500 animate-spin ml-auto shrink-0" />
                )}
              </button>
            ))}
          </div>
        )}

        {query && !searching && results.length === 0 && (
          <p className="mt-3 text-sm text-center text-gray-400">No repositories found for "{query}"</p>
        )}
      </div>
    </div>
  );
}

// ── Markdown renderer (simple, no deps) ──────────────────────────────────────

// ── Scan-first confirmation modal ─────────────────────────────────────────────
function ScanFirstModal({ repo, onConfirm, onClose }: {
  repo: MonitoredRepo;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200/60 bg-white dark:border-white/10 dark:bg-zinc-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/30">
            <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">Scan Required</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">{repo.fullName}</p>
          </div>
        </div>
        <p className="mb-5 text-sm text-gray-600 dark:text-gray-300">
          This repository hasn't been scanned yet. Generating an AI vulnerability report requires a scan first.
          This will check all <code className="rounded bg-gray-100 px-1 font-mono text-xs dark:bg-gray-800">package.json</code> dependencies against the OSV vulnerability database.
        </p>
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5">
            Cancel
          </button>
          <button onClick={onConfirm} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
            <RefreshCw className="h-3.5 w-3.5" /> Scan &amp; Generate Report
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AI Vuln Report Drawer ─────────────────────────────────────────────────────
function VulnReportDrawer({ repo, onClose }: { repo: MonitoredRepo; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function generate() {
      setLoading(true);
      setError(null);
      try {
        // Fetch vuln data for this repo
        const { packages, cves } = await fetchApi<{
          packages: Array<{ name: string; ecosystem: string; versions: string[]; criticalCount: number; highCount: number; mediumCount: number; lowCount: number; exploitedCount: number }>;
          cves: Record<string, Array<{ cveId: string; summary: string; severity: string; cvssScore: number | null; isKevExploited: boolean }>>;
        }>(`/security/repos/${repo.owner}/${repo.name}/vulns`);

        if (packages.length === 0) {
          setReport('## No Vulnerabilities Found\n\nThis repository has no known vulnerabilities in its dependencies. Keep dependencies up to date to maintain this status.');
          return;
        }

        // Generate AI report
        const { report: aiReport } = await fetchApi<{ report: string }>('/ai/vuln-report', {
          method: 'POST',
          body: JSON.stringify({ repoFullName: repo.fullName, packages, cves }),
        });
        setReport(aiReport);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to generate report');
      } finally {
        setLoading(false);
      }
    }
    void generate();
  }, [repo]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl dark:bg-zinc-900 animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-gray-100 dark:border-white/10 px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100 dark:bg-indigo-900/30">
            <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">AI Vulnerability Report</h2>
            <p className="truncate text-xs text-gray-500 dark:text-gray-400">{repo.fullName}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-gray-400">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
              <p className="text-sm">Analysing vulnerabilities…</p>
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
          {report && !loading && (
            <div className="prose prose-sm dark:prose-invert max-w-none
              prose-headings:font-bold prose-headings:text-gray-900 dark:prose-headings:text-white
              prose-p:text-gray-700 dark:prose-p:text-gray-300
              prose-li:text-gray-700 dark:prose-li:text-gray-300
              prose-code:bg-gray-100 dark:prose-code:bg-gray-800 prose-code:px-1 prose-code:rounded prose-code:text-xs prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
              prose-pre:bg-gray-900 dark:prose-pre:bg-black prose-pre:text-gray-100 prose-pre:rounded-lg prose-pre:text-xs
              prose-strong:text-gray-900 dark:prose-strong:text-white
              prose-hr:border-gray-200 dark:prose-hr:border-gray-700
              prose-a:text-indigo-600 dark:prose-a:text-indigo-400">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{report}</ReactMarkdown>
            </div>
          )}
        </div>

        {/* Stats footer */}
        {!loading && !error && repo.packageCount > 0 && (
          <div className="border-t border-gray-100 dark:border-white/10 px-6 py-3">
            <p className="text-xs text-gray-400">
              Based on scan of <strong>{repo.packageCount}</strong> package{repo.packageCount !== 1 ? 's' : ''} ·
              Last scanned {repo.lastScannedAt ? new Date(repo.lastScannedAt).toLocaleString() : 'never'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function SecurityReposPage() {
  const [repos, setRepos] = useState<MonitoredRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [scanning, setScanning] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [aiRepo, setAiRepo] = useState<MonitoredRepo | null>(null);
  const [scanFirstRepo, setScanFirstRepo] = useState<MonitoredRepo | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchApi<MonitoredRepo[]>('/security/repos');
      setRepos(data);
    } catch (e) {
      console.error('[security-repos] Failed to load:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Poll while any repo is scanning
  useEffect(() => {
    if (repos.some((r) => r.lastScanStatus === 'scanning')) {
      const id = setTimeout(() => { void load(); }, 3000);
      return () => clearTimeout(id);
    }
  }, [repos, load]);

  const handleScan = async (repo: MonitoredRepo) => {
    setScanning(repo.fullName);
    try {
      await fetchApi(`/security/repos/${repo.owner}/${repo.name}/scan`, { method: 'POST', body: JSON.stringify({}) });
      setRepos((prev) => prev.map((r) => r.fullName === repo.fullName ? { ...r, lastScanStatus: 'scanning' } : r));
    } catch (e) {
      console.error('[security-repos] Scan trigger failed:', e);
    } finally {
      setScanning(null);
    }
  };

  const handleRemove = async (repo: MonitoredRepo) => {
    if (!confirm(`Stop monitoring ${repo.fullName}?`)) return;
    setRemoving(repo.fullName);
    try {
      await fetchApi(`/security/repos/${repo.owner}/${repo.name}`, { method: 'DELETE' });
      setRepos((prev) => prev.filter((r) => r.fullName !== repo.fullName));
    } catch (e) {
      console.error('[security-repos] Remove failed:', e);
    } finally {
      setRemoving(null);
    }
  };

  const handleAiClick = (repo: MonitoredRepo) => {
    if (repo.lastScanStatus !== 'done') {
      setScanFirstRepo(repo);
    } else {
      setAiRepo(repo);
    }
  };

  const handleScanThenAi = async (repo: MonitoredRepo) => {
    setScanFirstRepo(null);
    await handleScan(repo);
    // Poll until done then open drawer
    const poll = setInterval(() => {
      setRepos((prev) => {
        const updated = prev.find((r) => r.fullName === repo.fullName);
        if (updated?.lastScanStatus === 'done') {
          clearInterval(poll);
          setAiRepo(updated);
        }
        return prev;
      });
    }, 3000);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Monitored Repositories"
        actions={
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
          >
            <Plus className="h-4 w-4" /> Add Repository
          </button>
        }
      />

      <p className="text-sm text-gray-500 dark:text-gray-400">
        Repositories added here will have their <code className="font-mono text-xs bg-gray-100 dark:bg-zinc-800 px-1 py-0.5 rounded">package.json</code> scanned for vulnerabilities on demand.
      </p>

      {loading ? (
        <div className="flex justify-center py-12 text-gray-400"><Loader2 className="h-8 w-8 animate-spin" /></div>
      ) : repos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 py-12 text-center">
          <GitBranch className="mx-auto mb-3 h-8 w-8 text-gray-300" />
          <p className="text-sm text-gray-500">No repositories monitored yet.</p>
          <button onClick={() => setShowAdd(true)} className="mt-3 text-sm text-indigo-600 hover:underline">Add your first repository</button>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200/60 bg-white dark:border-white/10 dark:bg-zinc-900/40 overflow-hidden shadow-xl shadow-slate-200/20 dark:shadow-black/40">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-white/10 bg-gray-50/50 dark:bg-white/5">
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Repository</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500 hidden md:table-cell">Status</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500 hidden md:table-cell">Packages</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500 hidden lg:table-cell">Last Scanned</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500 hidden lg:table-cell">Added By</th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/5">
              {repos.map((repo) => (
                <tr key={repo.fullName} className="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <GitBranch className="h-4 w-4 text-gray-400 shrink-0" />
                      <span className="font-mono font-medium text-gray-900 dark:text-white">{repo.fullName}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <div className="flex items-center gap-1.5">
                      <StatusIcon status={repo.lastScanStatus} />
                      <span className="text-xs capitalize text-gray-500 dark:text-gray-400">{repo.lastScanStatus}</span>
                    </div>
                    {repo.lastScanError && (
                      <p className="text-xs text-red-500 mt-0.5 max-w-xs truncate" title={repo.lastScanError}>{repo.lastScanError}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400 hidden md:table-cell">{repo.packageCount}</td>
                  <td className="px-4 py-3 text-xs text-gray-400 hidden lg:table-cell">
                    {repo.lastScannedAt ? new Date(repo.lastScannedAt).toLocaleString() : 'Never'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 hidden lg:table-cell">{repo.addedBy}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleAiClick(repo)}
                        disabled={repo.lastScanStatus === 'scanning'}
                        title={repo.lastScanStatus === 'done' ? 'Generate AI vulnerability report' : 'Scan required before AI report'}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 dark:border-violet-900/50 px-3 py-1.5 text-xs font-medium text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/20 disabled:opacity-50 transition-colors"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        AI Report
                      </button>
                      <button
                        onClick={() => { void handleScan(repo); }}
                        disabled={scanning === repo.fullName || repo.lastScanStatus === 'scanning'}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 dark:border-indigo-900/50 px-3 py-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/20 disabled:opacity-50 transition-colors"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${scanning === repo.fullName ? 'animate-spin' : ''}`} />
                        Scan
                      </button>
                      <button
                        onClick={() => { void handleRemove(repo); }}
                        disabled={removing === repo.fullName}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-900/50 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 disabled:opacity-50 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <AddRepoModal
          onClose={() => setShowAdd(false)}
          onAdded={(r) => setRepos((prev) => [r, ...prev])}
        />
      )}

      {scanFirstRepo && (
        <ScanFirstModal
          repo={scanFirstRepo}
          onClose={() => setScanFirstRepo(null)}
          onConfirm={() => { void handleScanThenAi(scanFirstRepo); }}
        />
      )}

      {aiRepo && (
        <VulnReportDrawer
          repo={aiRepo}
          onClose={() => setAiRepo(null)}
        />
      )}
    </div>
  );
}
