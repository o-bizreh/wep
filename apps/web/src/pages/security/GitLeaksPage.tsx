import { useState, useEffect, useCallback, useRef } from 'react';
import { PageHeader } from '@wep/ui';
import { AlertTriangle, Upload, Trash2, ChevronRight, X, Loader2, FileText, GitBranch, Search } from 'lucide-react';
import { fetchApi, portalApi } from '../../lib/api';

interface GitLeaksReport {
  reportId: string;
  repoFullName: string;
  uploadedBy: string;
  uploadedAt: string;
  findingCount: number;
  ruleBreakdown: Record<string, number>;
}

interface GitLeaksFinding {
  fingerprint: string;
  ruleId: string;
  description: string;
  file: string;
  startLine: number;
  endLine: number;
  secretPreview: string;
  match: string;
  commit: string;
  author: string;
  email: string;
  date: string;
  tags: string[];
}

function FindingsList({ findings, loading }: { findings: GitLeaksFinding[]; loading: boolean }) {
  const [groupBy, setGroupBy] = useState<'rule' | 'file'>('rule');

  const grouped = findings.reduce<Record<string, GitLeaksFinding[]>>((acc, f) => {
    const key = groupBy === 'rule' ? f.ruleId : f.file;
    (acc[key] = acc[key] ?? []).push(f);
    return acc;
  }, {});

  return (
    <>
      <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-100 dark:border-white/10">
        <span className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Group by:</span>
        {(['rule', 'file'] as const).map((g) => (
          <button
            key={g}
            onClick={() => setGroupBy(g)}
            className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${groupBy === g ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
          >
            {g === 'rule' ? 'Rule' : 'File'}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
        ) : findings.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-sm">No findings.</div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-white/10">
            {Object.entries(grouped).map(([group, items]) => (
              <div key={group}>
                <div className="sticky top-0 bg-gray-50 dark:bg-zinc-800 px-6 py-2 flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-gray-700 dark:text-gray-200">{group}</span>
                  <span className="text-xs text-gray-400">{items.length} finding{items.length !== 1 ? 's' : ''}</span>
                </div>
                {items.map((f) => (
                  <div key={f.fingerprint} className="px-6 py-3">
                    <div className="flex items-start gap-3">
                      <FileText className="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-xs text-gray-700 dark:text-gray-300 truncate">{f.file}:{f.startLine}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{f.description}</p>
                        <div className="flex flex-wrap gap-2 mt-1.5 text-xs text-gray-400">
                          <span>By {f.author}</span>
                          {f.commit && <span className="font-mono">@{f.commit.substring(0, 7)}</span>}
                          {f.date && <span>{new Date(f.date).toLocaleDateString()}</span>}
                          <span className="font-mono bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 px-1 rounded">{f.secretPreview}…</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function ComparePane({ repoReports }: { repoReports: GitLeaksReport[] }) {
  const sorted = [...repoReports].sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  const [reportAId, setReportAId] = useState(sorted[1]?.reportId ?? sorted[0]?.reportId ?? '');
  const [reportBId, setReportBId] = useState(sorted[0]?.reportId ?? '');
  const [findingsA, setFindingsA] = useState<GitLeaksFinding[] | null>(null);
  const [findingsB, setFindingsB] = useState<GitLeaksFinding[] | null>(null);
  const [loading, setLoading] = useState(false);

  const label = (id: string) => {
    const r = repoReports.find((x) => x.reportId === id);
    return r ? `${new Date(r.uploadedAt).toLocaleDateString()} — ${r.findingCount} findings` : id;
  };

  const compare = async () => {
    if (!reportAId || !reportBId) return;
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        fetchApi<{ findings: GitLeaksFinding[] }>(`/security/gitleaks/${reportAId}/findings`),
        fetchApi<{ findings: GitLeaksFinding[] }>(`/security/gitleaks/${reportBId}/findings`),
      ]);
      setFindingsA(a.findings);
      setFindingsB(b.findings);
    } finally { setLoading(false); }
  };

  const fpSetA = new Set(findingsA?.map((f) => f.fingerprint) ?? []);
  const fpSetB = new Set(findingsB?.map((f) => f.fingerprint) ?? []);
  const introduced = findingsB?.filter((f) => !fpSetA.has(f.fingerprint)) ?? [];
  const resolved = findingsA?.filter((f) => !fpSetB.has(f.fingerprint)) ?? [];

  if (sorted.length < 2) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-gray-400 px-6 text-center">
        Need at least 2 reports for this repository to compare. Upload another report first.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Baseline (older)</label>
          <select value={reportAId} onChange={(e) => { setReportAId(e.target.value); setFindingsA(null); setFindingsB(null); }}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-zinc-800 text-xs dark:text-white px-3 py-2">
            {sorted.map((r) => <option key={r.reportId} value={r.reportId}>{label(r.reportId)}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Comparison (newer)</label>
          <select value={reportBId} onChange={(e) => { setReportBId(e.target.value); setFindingsA(null); setFindingsB(null); }}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-zinc-800 text-xs dark:text-white px-3 py-2">
            {sorted.map((r) => <option key={r.reportId} value={r.reportId}>{label(r.reportId)}</option>)}
          </select>
        </div>
      </div>
      <button
        onClick={() => void compare()}
        disabled={loading || !reportAId || !reportBId || reportAId === reportBId}
        className="w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {loading ? <span className="flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Comparing…</span> : 'Compare Reports'}
      </button>

      {findingsA !== null && findingsB !== null && (
        <div className="space-y-3">
          <div className="rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20 p-4">
            <p className="text-xs font-bold text-red-600 dark:text-red-400 mb-3">
              {introduced.length} new finding{introduced.length !== 1 ? 's' : ''} introduced
            </p>
            {introduced.length === 0 ? (
              <p className="text-xs text-gray-400">None — no new secrets found.</p>
            ) : (
              <div className="space-y-2">
                {introduced.map((f) => (
                  <div key={f.fingerprint} className="text-xs font-mono text-red-700 dark:text-red-300">
                    <span className="font-bold">{f.ruleId}</span> · {f.file}:{f.startLine}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-950/20 p-4">
            <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mb-3">
              {resolved.length} finding{resolved.length !== 1 ? 's' : ''} resolved
            </p>
            {resolved.length === 0 ? (
              <p className="text-xs text-gray-400">None — no secrets resolved.</p>
            ) : (
              <div className="space-y-2">
                {resolved.map((f) => (
                  <div key={f.fingerprint} className="text-xs font-mono text-emerald-700 dark:text-emerald-300">
                    <span className="font-bold">{f.ruleId}</span> · {f.file}:{f.startLine}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FindingsDrawer({ report, allReports, onClose }: { report: GitLeaksReport; allReports: GitLeaksReport[]; onClose: () => void }) {
  const [findings, setFindings] = useState<GitLeaksFinding[]>([]);
  const [loadingFindings, setLoadingFindings] = useState(true);
  const [activeTab, setActiveTab] = useState<'findings' | 'compare'>('findings');

  const repoReports = allReports.filter((r) => r.repoFullName === report.repoFullName);

  useEffect(() => {
    fetchApi<{ findings: GitLeaksFinding[] }>(`/security/gitleaks/${report.reportId}/findings`)
      .then((d) => setFindings(d.findings))
      .catch(() => setFindings([]))
      .finally(() => setLoadingFindings(false));
  }, [report.reportId]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl h-full bg-white dark:bg-zinc-900 shadow-2xl flex flex-col">
        <div className="flex items-start justify-between px-6 py-5 border-b border-gray-100 dark:border-white/10">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <GitBranch className="h-4 w-4 text-gray-400" />
              <span className="font-mono text-sm font-medium text-gray-700 dark:text-gray-300">{report.repoFullName}</span>
            </div>
            <p className="text-xs text-gray-400">{report.findingCount} findings · uploaded by {report.uploadedBy} on {new Date(report.uploadedAt).toLocaleDateString()}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-gray-100 dark:border-white/10 px-6">
          {(['findings', 'compare'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-3 px-1 mr-6 text-sm font-medium border-b-2 transition-colors ${activeTab === tab ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
            >
              {tab === 'findings' ? 'Findings' : 'Compare'}
            </button>
          ))}
        </div>

        {activeTab === 'findings' ? (
          <FindingsList findings={findings} loading={loadingFindings} />
        ) : (
          <ComparePane repoReports={repoReports} />
        )}
      </div>
    </div>
  );
}

interface GithubRepoResult {
  name: string;
  fullName: string;
  description: string;
}

function UploadModal({ onClose, onUploaded }: { onClose: () => void; onUploaded: (r: GitLeaksReport) => void }) {
  const [repoQuery, setRepoQuery] = useState('');
  const [repoFullName, setRepoFullName] = useState('');
  const [repoResults, setRepoResults] = useState<GithubRepoResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [fileContent, setFileContent] = useState<unknown[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!repoQuery.trim()) { setRepoResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await fetchApi<GithubRepoResult[]>(`/aws-resources/github/repos/search?q=${encodeURIComponent(repoQuery)}`);
        setRepoResults(data);
      } catch { setRepoResults([]); }
      finally { setSearching(false); }
    }, 300);
  }, [repoQuery]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string) as unknown;
        if (Array.isArray(parsed)) { setFileContent(parsed); setError(null); return; }
        const sarif = parsed as Record<string, unknown>;
        const runs = sarif['runs'] as Array<Record<string, unknown>> | undefined;
        const results = runs?.[0]?.['results'] as Array<Record<string, unknown>> | undefined;
        if (!results) { setError('Unrecognised format — expected a GitLeaks JSON array or a SARIF file'); return; }
        const normalised = results.map((r) => {
          const loc = (r['locations'] as Array<Record<string, unknown>> | undefined)?.[0];
          const physLoc = loc?.['physicalLocation'] as Record<string, unknown> | undefined;
          const region = physLoc?.['region'] as Record<string, unknown> | undefined;
          const uri = (physLoc?.['artifactLocation'] as Record<string, unknown> | undefined)?.['uri'] ?? '';
          const fp = r['partialFingerprints'] as Record<string, unknown> | undefined;
          const props = r['properties'] as Record<string, unknown> | undefined;
          return {
            RuleID: r['ruleId'] ?? 'unknown',
            Description: (r['message'] as Record<string, unknown> | undefined)?.['text'] ?? '',
            File: uri, StartLine: region?.['startLine'] ?? 0, EndLine: region?.['endLine'] ?? 0,
            Match: (region?.['snippet'] as Record<string, unknown> | undefined)?.['text'] ?? '',
            Secret: String(props?.['secret'] ?? fp?.['secret/v1'] ?? ''),
            Commit: String(props?.['commit'] ?? fp?.['commitSha'] ?? ''),
            Author: String(props?.['author'] ?? fp?.['author/v1'] ?? ''),
            Email: String(props?.['email'] ?? fp?.['email/v1'] ?? ''),
            Date: String(props?.['date'] ?? fp?.['date/v1'] ?? ''),
            Tags: String(props?.['tags'] ?? fp?.['tagList/v1'] ?? '').split(',').filter(Boolean),
            Fingerprint: String(props?.['fingerprint'] ?? fp?.['primaryLocationLineHash'] ?? crypto.randomUUID()),
          };
        });
        setFileContent(normalised);
        setError(null);
      } catch {
        setError('Invalid file — could not parse JSON or SARIF');
      }
    };
    reader.readAsText(file);
  };

  const handleSubmit = async () => {
    if (!repoFullName.trim()) { setError('Repository name is required'); return; }
    if (!fileContent) { setError('Please select a GitLeaks report file (.sarif or .json)'); return; }
    setSaving(true); setError(null);
    try {
      const report = await fetchApi<GitLeaksReport>('/security/gitleaks', {
        method: 'POST',
        body: JSON.stringify({ repoFullName: repoFullName.trim(), findings: fileContent }),
      });
      onUploaded(report);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200/60 bg-white/90 dark:border-white/10 dark:bg-zinc-900/90 p-6 shadow-2xl">
        <div className="flex justify-between items-center mb-5">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Upload GitLeaks Report</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X className="h-5 w-5" /></button>
        </div>
        {error && <p className="mb-4 rounded-lg bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Repository</label>
            {repoFullName ? (
              <div className="flex items-center justify-between rounded-lg border border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/20 px-3 py-2">
                <div className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-indigo-500 shrink-0" />
                  <span className="text-sm font-mono font-medium text-indigo-700 dark:text-indigo-300">{repoFullName}</span>
                </div>
                <button onClick={() => { setRepoFullName(''); setRepoQuery(''); }} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 animate-spin" />}
                <input autoFocus value={repoQuery} onChange={(e) => setRepoQuery(e.target.value)} placeholder="Search repository name…"
                  className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-white focus:ring-indigo-500 focus:border-indigo-500" />
                {repoResults.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden">
                    {repoResults.map((r) => (
                      <button key={r.fullName} type="button"
                        onClick={() => { setRepoFullName(r.fullName); setRepoQuery(''); setRepoResults([]); }}
                        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-indigo-50 dark:hover:bg-indigo-950/20 border-b border-gray-100 dark:border-white/5 last:border-0 transition-colors">
                        <GitBranch className="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-sm font-mono font-medium text-gray-900 dark:text-white truncate">{r.fullName}</p>
                          {r.description && <p className="text-xs text-gray-400 truncate mt-0.5">{r.description}</p>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {repoQuery && !searching && repoResults.length === 0 && (
                  <p className="mt-2 text-xs text-center text-gray-400">No repositories found for "{repoQuery}"</p>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">GitLeaks Report (.sarif or .json)</label>
            <div onClick={() => fileRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-700 p-6 cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-600 transition-colors">
              <Upload className="h-6 w-6 text-gray-400" />
              {fileName ? <span className="text-sm font-medium text-indigo-600 dark:text-indigo-400">{fileName}</span>
                        : <span className="text-sm text-gray-500">Click to select a .sarif or .json file</span>}
            </div>
            <input ref={fileRef} type="file" accept=".sarif,.json" className="hidden" onChange={handleFile} />
          </div>
          <button onClick={() => void handleSubmit()} disabled={saving || !fileContent || !repoFullName}
            className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {saving ? 'Uploading…' : 'Upload Report'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function GitLeaksPage() {
  const [reports, setReports] = useState<GitLeaksReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDevOps, setIsDevOps] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [selectedReport, setSelectedReport] = useState<GitLeaksReport | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [data, role] = await Promise.all([
        fetchApi<GitLeaksReport[]>('/security/gitleaks'),
        portalApi.getRole(),
      ]);
      setReports(data);
      setIsDevOps(role.role === 'devops');
    } catch (e) {
      console.error('[gitleaks] Failed to load:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleDelete = async (reportId: string) => {
    setConfirmDelete(null);
    setDeleting(reportId);
    setDeleteError(null);
    try {
      await fetchApi(`/security/gitleaks/${reportId}`, { method: 'DELETE' });
      setReports((prev) => prev.filter((r) => r.reportId !== reportId));
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="GitLeaks Reports"
        actions={
          isDevOps ? (
            <button
              onClick={() => setShowUpload(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
            >
              <Upload className="h-4 w-4" /> Upload Report
            </button>
          ) : undefined
        }
      />
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Parsed GitLeaks JSON reports uploaded by DevOps. Click a row to view findings.
      </p>

      {deleteError && (
        <div className="flex items-center justify-between rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 px-4 py-3">
          <p className="text-sm text-red-600 dark:text-red-400">{deleteError}</p>
          <button onClick={() => setDeleteError(null)} className="text-red-400 hover:text-red-600"><X className="h-4 w-4" /></button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div>
      ) : reports.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 py-12 text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-gray-300" />
          <p className="text-sm text-gray-500">No reports uploaded yet.</p>
          {isDevOps && (
            <button onClick={() => setShowUpload(true)} className="mt-3 text-sm text-indigo-600 hover:underline">Upload the first report</button>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200/60 bg-white dark:border-white/10 dark:bg-zinc-900/40 overflow-hidden shadow-xl shadow-slate-200/20 dark:shadow-black/40">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-white/10 bg-gray-50/50 dark:bg-white/5">
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Repository</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Findings</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500 hidden md:table-cell">Rules Triggered</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500 hidden lg:table-cell">Uploaded By</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500 hidden lg:table-cell">Date</th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-gray-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/5">
              {reports.map((report) => (
                <tr
                  key={report.reportId}
                  className="hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer transition-colors"
                  onClick={() => setSelectedReport(report)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <GitBranch className="h-4 w-4 text-gray-400 shrink-0" />
                      <span className="font-mono font-medium text-gray-900 dark:text-white">{report.repoFullName}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold ring-1 ring-inset ${report.findingCount > 0 ? 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950/30 dark:text-red-400' : 'bg-gray-50 text-gray-500 ring-gray-400/20'}`}>
                      {report.findingCount}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(report.ruleBreakdown).slice(0, 3).map(([rule, count]) => (
                        <span key={rule} className="rounded bg-gray-100 dark:bg-zinc-800 px-1.5 py-0.5 text-xs font-mono text-gray-600 dark:text-gray-400">{rule} ({count})</span>
                      ))}
                      {Object.keys(report.ruleBreakdown).length > 3 && (
                        <span className="text-xs text-gray-400">+{Object.keys(report.ruleBreakdown).length - 3} more</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 hidden lg:table-cell">{report.uploadedBy}</td>
                  <td className="px-4 py-3 text-xs text-gray-400 hidden lg:table-cell">{new Date(report.uploadedAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                      {confirmDelete === report.reportId ? (
                        <>
                          <span className="text-xs text-gray-500 dark:text-gray-400">Delete?</span>
                          <button
                            onClick={() => { void handleDelete(report.reportId); }}
                            className="rounded px-2 py-1 text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                          >
                            No
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => setSelectedReport(report)} className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                            View <ChevronRight className="h-3 w-3" />
                          </button>
                          {isDevOps && (
                            <button
                              onClick={() => setConfirmDelete(report.reportId)}
                              disabled={deleting === report.reportId}
                              className="p-1.5 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                            >
                              {deleting === report.reportId
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Trash2 className="h-3.5 w-3.5" />}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onUploaded={(r) => setReports((prev) => [r, ...prev])} />}
      {selectedReport && <FindingsDrawer report={selectedReport} allReports={reports} onClose={() => setSelectedReport(null)} />}
    </div>
  );
}
