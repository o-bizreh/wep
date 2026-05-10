import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { PageHeader } from '@wep/ui';
import {
  Target,
  Search,
  Plus,
  Filter,
  Package,
  Check,
  X,
  ShieldAlert,
  Cpu,
  RefreshCw,
  Loader2,
  Trash2,
  ShieldCheck,
  MessageSquare,
  Download,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Send,
  Github,
  Settings,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { fetchApi, portalApi } from '../../lib/api';
import { settings } from '../../lib/settings';

// ─── Domain Types ─────────────────────────────────────────────────────────────

type TechStatus = 'adopt' | 'trial' | 'assess' | 'hold' | 'unassessed' | 'rejected';
type Ecosystem = 'npm' | 'pip' | 'maven' | 'go';

interface RepoReference {
  repoName: string;
  version: string;
}

interface HistoryEntry {
  userId: string;
  userName: string;
  oldStatus: string;
  newStatus: string;
  note?: string;
  timestamp: string;
}

interface Comment {
  commentId: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: string;
}

interface VulnResult {
  id: string;
  severity: string;
  summary: string;
  fixedIn?: string;
}

interface Package {
  PK: string;
  SK: string;
  name: string;
  ecosystem: Ecosystem;
  status: TechStatus;
  description: string;
  repositories: RepoReference[];
  history: HistoryEntry[];
  comments: Comment[];
  vulns: VulnResult[];
  vulnScannedAt?: string;
  addedBy: string;
  ownerId: string;
  addedAt: string;
  updatedAt: string;
}

interface ScanState {
  scanId: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'done' | 'failed';
  repoCount: number;
  packageCount: number;
  error?: string;
}

// ─── Static Config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<TechStatus, { title: string; color: string; desc: string; ring: string }> = {
  adopt:      { title: 'Adopt',      ring: 'ring-emerald-500', color: 'text-emerald-600 bg-emerald-50 ring-emerald-600/20 dark:bg-emerald-950/30 dark:text-emerald-400', desc: 'Safe for all new projects.' },
  trial:      { title: 'Trial',      ring: 'ring-blue-500',    color: 'text-blue-600 bg-blue-50 ring-blue-600/20 dark:bg-blue-950/30 dark:text-blue-400',            desc: 'Working in low-risk production.' },
  assess:     { title: 'Assess',     ring: 'ring-purple-500',  color: 'text-purple-600 bg-purple-50 ring-purple-600/20 dark:bg-purple-950/30 dark:text-purple-400',  desc: 'Exploring for potential use.' },
  hold:       { title: 'Hold',       ring: 'ring-red-500',     color: 'text-red-600 bg-red-50 ring-red-600/20 dark:bg-red-950/30 dark:text-red-400',                 desc: 'Do not use for new work.' },
  rejected:   { title: 'Rejected',   ring: 'ring-rose-700',    color: 'text-rose-700 bg-rose-50 ring-rose-700/20 dark:bg-rose-950/30 dark:text-rose-400',            desc: 'Assessed and rejected.' },
  unassessed: { title: 'Unassessed', ring: 'ring-gray-400',    color: 'text-gray-600 bg-gray-50 ring-gray-600/20 dark:bg-gray-800/50 dark:text-gray-400',            desc: 'Awaiting architectural review.' },
};

const ECOSYSTEM_ICONS: Record<Ecosystem, React.ReactNode> = {
  npm:    <Package className="h-4 w-4" />,
  pip:    <Cpu className="h-4 w-4" />,
  maven:  <Target className="h-4 w-4" />,
  go:     <Package className="h-4 w-4" />,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(isoString: string): string {
  const delta = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

interface CurrentUser {
  id: string;
  name: string;
}

function useCurrentUser(): CurrentUser {
  const [user, setUser] = useState<CurrentUser>({ id: 'anonymous', name: 'Anonymous' });
  useEffect(() => {
    portalApi.getRole()
      .then((identity) => {
        if (identity.username) {
          setUser({ id: identity.email ?? identity.username, name: identity.username });
        }
      })
      .catch(() => { /* no credentials configured — stay anonymous */ });
  }, []);
  return user;
}

function packageIdFromItem(pkg: Package): string {
  return encodeURIComponent(`${pkg.ecosystem}#${pkg.name}`);
}

function severityColor(score: string): string {
  const n = parseFloat(score);
  if (isNaN(n)) return 'text-gray-500 bg-gray-50 dark:bg-gray-800/50';
  if (n >= 9)   return 'text-red-700 bg-red-50 dark:bg-red-950/30';
  if (n >= 7)   return 'text-orange-700 bg-orange-50 dark:bg-orange-950/30';
  if (n >= 4)   return 'text-yellow-700 bg-yellow-50 dark:bg-yellow-950/30';
  return 'text-blue-600 bg-blue-50 dark:bg-blue-950/30';
}

function severityLabel(score: string): string {
  const n = parseFloat(score);
  if (isNaN(n)) return score.toUpperCase();
  if (n >= 9)   return 'CRITICAL';
  if (n >= 7)   return 'HIGH';
  if (n >= 4)   return 'MEDIUM';
  return 'LOW';
}

function buildReport(pkg: Package): string {
  const lines: string[] = [];
  lines.push(`# Tech Radar Report: ${pkg.name}`);
  lines.push(`\n**Ecosystem:** ${pkg.ecosystem.toUpperCase()}  `);
  lines.push(`**Status:** ${STATUS_CONFIG[pkg.status].title}  `);
  lines.push(`**Added:** ${new Date(pkg.addedAt).toLocaleDateString()}  `);
  lines.push(`**Last updated:** ${new Date(pkg.updatedAt).toLocaleDateString()}`);

  if (pkg.description) {
    lines.push(`\n## Architectural Notes\n\n${pkg.description}`);
  }

  if (pkg.repositories.length > 0) {
    lines.push(`\n## Used In (${pkg.repositories.length} repos)\n`);
    for (const r of pkg.repositories) {
      lines.push(`- \`${r.repoName}\` — v${r.version}`);
    }
  }

  if (pkg.vulns.length > 0) {
    lines.push(`\n## Vulnerabilities (${pkg.vulns.length})\n`);
    for (const v of pkg.vulns) {
      lines.push(`### ${v.id} — ${severityLabel(v.severity)} (${v.severity})`);
      lines.push(`${v.summary}`);
      if (v.fixedIn) lines.push(`**Fixed in:** ${v.fixedIn}`);
      lines.push('');
    }
  } else {
    lines.push('\n## Vulnerabilities\n\nNo known vulnerabilities found.');
  }

  if (pkg.history.length > 0) {
    lines.push(`\n## Status History\n`);
    for (const h of pkg.history) {
      lines.push(`- **${new Date(h.timestamp).toLocaleDateString()}** — ${h.userName} changed from \`${h.oldStatus}\` → \`${h.newStatus}\``);
    }
  }

  if ((pkg.comments ?? []).length > 0) {
    lines.push(`\n## Comments\n`);
    for (const c of pkg.comments) {
      lines.push(`**${c.userName}** (${new Date(c.timestamp).toLocaleDateString()}): ${c.text}\n`);
    }
  }

  return lines.join('\n');
}

// ─── Add Modal ────────────────────────────────────────────────────────────────

interface AddModalProps {
  onClose: () => void;
  onAdded: (pkg: Package) => void;
  currentUser: CurrentUser;
}

function AddModal({ onClose, onAdded, currentUser }: AddModalProps) {
  const [name, setName] = useState('');
  const [ecosystem, setEcosystem] = useState<Ecosystem>('npm');
  const [status, setStatus] = useState<TechStatus>('assess');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const created = await fetchApi<Package>('/tech-radar/packages', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          ecosystem,
          status,
          description,
          addedBy: currentUser.id,
          addedByName: currentUser.name,
        }),
      });
      onAdded(created);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add package');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200/60 bg-white/90 p-6 shadow-2xl backdrop-blur-2xl dark:border-white/10 dark:bg-zinc-900/90 dark:shadow-black/50">
        <div className="flex justify-between items-center mb-5">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Add Missing Technology</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Package Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. svelte"
              autoFocus
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Ecosystem</label>
              <select
                value={ecosystem}
                onChange={(e) => setEcosystem(e.target.value as Ecosystem)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              >
                <option value="npm">NPM</option>
                <option value="pip">PIP</option>
                <option value="maven">Maven</option>
                <option value="go">Go</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Initial Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as TechStatus)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              >
                {(Object.keys(STATUS_CONFIG) as TechStatus[]).map((s) => (
                  <option key={s} value={s}>{STATUS_CONFIG[s].title}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Architectural Notes</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
          </div>
          <button
            onClick={() => { void handleSubmit(); }}
            disabled={!name.trim() || saving}
            className="w-full rounded-xl mt-4 bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Adding...' : 'Add to Tracker'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Package Detail Drawer ────────────────────────────────────────────────────

type DrawerTab = 'overview' | 'vulns' | 'comments' | 'history';

interface DrawerProps {
  pkg: Package;
  onClose: () => void;
  onUpdated: (pkg: Package) => void;
  onDeleted: (pkg: Package) => void;
  currentUser: CurrentUser;
}

function PackageDrawer({ pkg: initialPkg, onClose, onUpdated, onDeleted, currentUser }: DrawerProps) {
  const [pkg, setPkg] = useState<Package>(initialPkg);
  const [tab, setTab] = useState<DrawerTab>('overview');

  // Edit state
  const [status, setStatus] = useState<TechStatus>(initialPkg.status);
  const [description, setDescription] = useState(initialPkg.description);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Delete state
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Vuln scan state
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Comment state
  const [commentText, setCommentText] = useState('');
  const [addingComment, setAddingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  const isDirty = status !== pkg.status || description !== pkg.description;

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await fetchApi<Package>(`/tech-radar/packages/${packageIdFromItem(pkg)}`, {
        method: 'PUT',
        body: JSON.stringify({ status, description, updatedBy: currentUser.id, updatedByName: currentUser.name }),
      });
      setPkg(updated);
      onUpdated(updated);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await fetchApi<void>(`/tech-radar/packages/${packageIdFromItem(pkg)}`, {
        method: 'DELETE',
        body: JSON.stringify({ requesterId: currentUser.id === 'anonymous' ? pkg.ownerId : currentUser.id }),
      });
      onDeleted(pkg);
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to delete');
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  const handleVulnScan = async () => {
    setScanning(true);
    setScanError(null);
    try {
      const updated = await fetchApi<Package>(`/tech-radar/packages/${packageIdFromItem(pkg)}/vuln-scan`, { method: 'POST' });
      setPkg(updated);
      onUpdated(updated);
      setTab('vulns');
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  const handleAddComment = async () => {
    if (!commentText.trim()) return;
    setAddingComment(true);
    setCommentError(null);
    try {
      const updated = await fetchApi<Package>(`/tech-radar/packages/${packageIdFromItem(pkg)}/comments`, {
        method: 'POST',
        body: JSON.stringify({ userId: currentUser.id, userName: currentUser.name, text: commentText.trim() }),
      });
      setPkg(updated);
      onUpdated(updated);
      setCommentText('');
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : 'Failed to add comment');
    } finally {
      setAddingComment(false);
    }
  };

  const handleDownload = () => {
    const md = buildReport(pkg);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tech-radar-${pkg.name}-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const tabs: { key: DrawerTab; label: string; count?: number }[] = [
    { key: 'overview',  label: 'Overview' },
    { key: 'vulns',     label: 'Vulnerabilities', count: pkg.vulns?.length },
    { key: 'comments',  label: 'Comments',        count: pkg.comments?.length },
    { key: 'history',   label: 'History',         count: pkg.history?.length },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer — slides in from the right */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col bg-white shadow-2xl dark:bg-zinc-900 dark:shadow-black/60 animate-in slide-in-from-right duration-200">

        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 dark:border-white/10 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-gray-400 dark:text-gray-500">{ECOSYSTEM_ICONS[pkg.ecosystem]}</span>
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">{pkg.ecosystem}</span>
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white truncate">{pkg.name}</h2>
          </div>
          <div className="flex items-center gap-2 shrink-0 mt-1">
            <button
              onClick={handleDownload}
              title="Download report"
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <Download className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Status pill + scan button */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-gray-100 dark:border-white/10">
          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${STATUS_CONFIG[pkg.status].color}`}>
            {STATUS_CONFIG[pkg.status].title}
          </span>
          <button
            onClick={() => { void handleVulnScan(); }}
            disabled={scanning}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-zinc-700 disabled:opacity-50 transition-colors"
          >
            {scanning
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Scanning…</>
              : <><ShieldCheck className="h-3.5 w-3.5" /> Scan Vulnerabilities</>}
          </button>
        </div>

        {scanError && (
          <div className="px-5 py-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20">
            {scanError}
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-gray-100 dark:border-white/10 px-5">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 pb-3 pt-3 px-1 mr-5 text-xs font-semibold border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'
              }`}
            >
              {t.label}
              {t.count != null && t.count > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${tab === t.key ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-gray-100 text-gray-500 dark:bg-zinc-800'}`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* ── Overview ── */}
          {tab === 'overview' && (
            <div className="space-y-5">
              {saveError && (
                <div className="rounded-lg bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                  {saveError}
                </div>
              )}

              {/* Status selector */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Status</label>
                <div className="grid grid-cols-5 gap-1.5">
                  {(Object.keys(STATUS_CONFIG) as TechStatus[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatus(s)}
                      className={`rounded-lg px-2 py-2 text-xs font-semibold text-center transition-all ring-1 ${
                        status === s
                          ? `${STATUS_CONFIG[s].color} ring-2 ${STATUS_CONFIG[s].ring} shadow-sm`
                          : 'ring-gray-200 dark:ring-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-zinc-800'
                      }`}
                    >
                      {STATUS_CONFIG[s].title}
                    </button>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Architectural Notes</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  placeholder="Add architectural notes, decisions, or caveats…"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-zinc-800 dark:text-white placeholder-gray-400 resize-none"
                />
              </div>

              {/* Repos */}
              {pkg.repositories.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
                    Used in {pkg.repositories.length} repo{pkg.repositories.length !== 1 ? 's' : ''}
                  </label>
                  <div className="space-y-1 max-h-40 overflow-y-auto rounded-lg border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                    {pkg.repositories.map((r) => (
                      <div key={r.repoName} className="flex justify-between items-center px-3 py-2 text-xs">
                        <span className="text-gray-700 dark:text-gray-300 font-mono">{r.repoName}</span>
                        <span className="text-gray-400 font-mono">{r.version}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Meta */}
              <div className="rounded-lg border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 text-xs">
                <div className="flex justify-between px-3 py-2">
                  <span className="text-gray-400">Added</span>
                  <span className="text-gray-600 dark:text-gray-300">{relativeTime(pkg.addedAt)}</span>
                </div>
                <div className="flex justify-between px-3 py-2">
                  <span className="text-gray-400">Last updated</span>
                  <span className="text-gray-600 dark:text-gray-300">{relativeTime(pkg.updatedAt)}</span>
                </div>
                {pkg.vulnScannedAt && (
                  <div className="flex justify-between px-3 py-2">
                    <span className="text-gray-400">Vuln scanned</span>
                    <span className="text-gray-600 dark:text-gray-300">{relativeTime(pkg.vulnScannedAt)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Vulnerabilities ── */}
          {tab === 'vulns' && (
            <div className="space-y-3">
              {!pkg.vulnScannedAt ? (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <ShieldCheck className="h-10 w-10 text-gray-300 dark:text-gray-600" />
                  <p className="text-sm text-gray-400">No scan run yet.</p>
                  <button
                    onClick={() => { void handleVulnScan(); }}
                    disabled={scanning}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    {scanning ? 'Scanning…' : 'Scan Now'}
                  </button>
                </div>
              ) : pkg.vulns.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <CheckCircle2 className="h-10 w-10 text-emerald-400" />
                  <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">No known vulnerabilities</p>
                  <p className="text-xs text-gray-400">Scanned {relativeTime(pkg.vulnScannedAt)}</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-400">
                      {pkg.vulns.length} issue{pkg.vulns.length !== 1 ? 's' : ''} · scanned {relativeTime(pkg.vulnScannedAt)}
                    </p>
                    <button
                      onClick={() => { void handleVulnScan(); }}
                      disabled={scanning}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                    >
                      {scanning ? 'Scanning…' : 'Re-scan'}
                    </button>
                  </div>
                  {pkg.vulns.map((v) => (
                    <div key={v.id} className="rounded-xl border border-gray-100 dark:border-gray-800 p-3 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                        <span className="text-xs font-mono font-bold text-gray-700 dark:text-gray-200">{v.id}</span>
                        <span className={`ml-auto text-[10px] font-bold rounded px-1.5 py-0.5 ${severityColor(v.severity)}`}>
                          {severityLabel(v.severity)} {v.severity !== 'unknown' && `(${v.severity})`}
                        </span>
                      </div>
                      {v.summary && <p className="text-xs text-gray-500 dark:text-gray-400">{v.summary}</p>}
                      {v.fixedIn && (
                        <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                          <ChevronRight className="h-3 w-3" /> Fixed in {v.fixedIn}
                        </p>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* ── Comments ── */}
          {tab === 'comments' && (
            <div className="space-y-4">
              {(pkg.comments ?? []).length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <MessageSquare className="h-8 w-8 text-gray-300 dark:text-gray-600" />
                  <p className="text-sm text-gray-400">No comments yet. Start the discussion.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pkg.comments.map((c) => (
                    <div key={c.commentId} className="rounded-xl border border-gray-100 dark:border-gray-800 p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{c.userName}</span>
                        <span className="text-[10px] text-gray-400">{relativeTime(c.timestamp)}</span>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{c.text}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Add comment */}
              <div className="border-t border-gray-100 dark:border-gray-800 pt-4 space-y-2">
                {commentError && (
                  <p className="text-xs text-red-500">{commentError}</p>
                )}
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  rows={3}
                  placeholder="Add a comment…"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-zinc-800 dark:text-white placeholder-gray-400 resize-none"
                />
                <button
                  onClick={() => { void handleAddComment(); }}
                  disabled={!commentText.trim() || addingComment}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {addingComment ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {addingComment ? 'Posting…' : 'Post Comment'}
                </button>
              </div>
            </div>
          )}

          {/* ── History ── */}
          {tab === 'history' && (
            <div className="space-y-2">
              {(pkg.history ?? []).length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-400">No status changes recorded.</p>
              ) : (
                pkg.history.map((h, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <div className="mt-1.5 h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600 shrink-0" />
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        <span className="font-semibold text-gray-700 dark:text-gray-300">{h.userName}</span>
                        {' · '}
                        <span className="font-mono">{h.oldStatus}</span>
                        {' → '}
                        <span className="font-mono font-semibold">{h.newStatus}</span>
                      </p>
                      {h.note && <p className="mt-0.5 text-xs text-gray-400 italic">{h.note}</p>}
                      <p className="mt-0.5 text-[10px] text-gray-400">{relativeTime(h.timestamp)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="border-t border-gray-100 dark:border-white/10 px-5 py-4">
          {confirmingDelete ? (
            <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30 p-3 space-y-3">
              <p className="text-sm font-medium text-red-700 dark:text-red-400">
                Remove <strong>{pkg.name}</strong> from the radar? This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => { void handleDelete(); }}
                  disabled={deleting}
                  className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {deleting ? 'Deleting…' : 'Yes, delete'}
                </button>
                <button
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleting}
                  className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-zinc-900 dark:text-gray-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmingDelete(true)}
                className="flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-600 hover:bg-red-100 transition-colors dark:border-red-800 dark:bg-red-950/30 dark:text-red-400"
              >
                <Trash2 className="h-4 w-4" /> Delete
              </button>
              <button
                onClick={() => { void handleSave(); }}
                disabled={saving || !isDirty}
                className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Scan Modal ───────────────────────────────────────────────────────────────

const SCAN_ORG_CACHE_KEY = 'wep:tech-radar-scan-org';

interface ScanModalProps {
  onClose: () => void;
  onScan: (org: string) => void;
  hasPackages: boolean;
}

function ScanModal({ onClose, onScan, hasPackages }: ScanModalProps) {
  const hasToken = Boolean(settings.getGithubToken());
  const cachedOrg = localStorage.getItem(SCAN_ORG_CACHE_KEY) ?? '';
  const [org, setOrg] = useState(cachedOrg);

  const handleScan = () => {
    const trimmed = org.trim();
    if (!trimmed) return;
    localStorage.setItem(SCAN_ORG_CACHE_KEY, trimmed);
    onScan(trimmed);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200/60 bg-white/95 p-6 shadow-2xl dark:border-white/10 dark:bg-zinc-900/95">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Github className="h-5 w-5 text-gray-700 dark:text-gray-300" />
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Scan Repositories</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        {!hasToken ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-4 space-y-2">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" /> GitHub token not configured
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                A GitHub Personal Access Token (PAT) with <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 rounded">repo</code> scope is required to scan repositories.
              </p>
            </div>
            <Link
              to="/settings"
              className="flex items-center justify-center gap-2 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
              onClick={onClose}
            >
              <Settings className="h-4 w-4" /> Go to Settings
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Scans all non-archived repos in the org for <code className="font-mono text-xs bg-gray-100 dark:bg-zinc-800 px-1 rounded">package.json</code>, <code className="font-mono text-xs bg-gray-100 dark:bg-zinc-800 px-1 rounded">requirements.txt</code>, and <code className="font-mono text-xs bg-gray-100 dark:bg-zinc-800 px-1 rounded">go.mod</code> files to discover dependencies.
            </p>

            {hasPackages && (
              <div className="rounded-lg border border-blue-100 dark:border-blue-900/40 bg-blue-50 dark:bg-blue-950/20 px-3 py-2 text-xs text-blue-700 dark:text-blue-400 flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                Existing packages will be updated with new repo references. Statuses and notes are preserved.
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                GitHub Organization
              </label>
              <input
                autoFocus
                value={org}
                onChange={(e) => setOrg(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleScan(); }}
                placeholder="e.g. washmen"
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-zinc-800 dark:text-white placeholder-gray-400"
              />
              {cachedOrg && org === cachedOrg && (
                <p className="mt-1 text-xs text-gray-400">Using last scanned org</p>
              )}
            </div>

            <button
              onClick={handleScan}
              disabled={!org.trim()}
              className="w-full rounded-xl bg-slate-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              <RefreshCw className="h-4 w-4" /> Start Scan
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Scan Status Banner ───────────────────────────────────────────────────────

interface ScanBannerProps {
  scanState: ScanState | null;
  scanning: boolean;
  onOpenScanModal: () => void;
}

function ScanBanner({ scanState, scanning, onOpenScanModal }: ScanBannerProps) {
  let statusText: React.ReactNode = 'Never scanned';
  if (scanning || scanState?.status === 'running') {
    statusText = (
      <span className="flex items-center gap-1.5">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Scanning repositories…
      </span>
    );
  } else if (scanState?.status === 'done' && scanState.completedAt) {
    statusText = `Last scanned: ${relativeTime(scanState.completedAt)} · ${scanState.repoCount} repos · ${scanState.packageCount} packages`;
  } else if (scanState?.status === 'failed') {
    statusText = `Last scan failed: ${scanState.error ?? 'unknown error'}`;
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200/50 bg-white/40 px-4 py-3 text-sm dark:border-white/5 dark:bg-zinc-900/20 backdrop-blur-md">
      <span className="text-gray-500 dark:text-gray-400">{statusText}</span>
      <button
        onClick={onOpenScanModal}
        disabled={scanning || scanState?.status === 'running'}
        className="inline-flex items-center gap-2 rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:bg-slate-800 disabled:opacity-50"
      >
        <RefreshCw className="h-3.5 w-3.5" /> Scan Repositories
      </button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function TechRadarPage() {
  const currentUser = useCurrentUser();
  const [packages, setPackages] = useState<Package[]>([]);
  const [scanState, setScanState] = useState<ScanState | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [ecoFilter, setEcoFilter] = useState<string>('all');
  const [selectedPkg, setSelectedPkg] = useState<Package | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showScanModal, setShowScanModal] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadPackages = useCallback(async () => {
    try {
      const data = await fetchApi<Package[]>('/tech-radar/packages');
      setPackages(data);
    } catch (err) {
      console.error('[tech-radar] Failed to load packages:', err);
    }
  }, []);

  const loadScanStatus = useCallback(async () => {
    try {
      const data = await fetchApi<ScanState>('/tech-radar/scan/status');
      setScanState(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadPackages(), loadScanStatus()]).finally(() => setLoading(false));
  }, [loadPackages, loadScanStatus]);

  useEffect(() => {
    if (scanState?.status === 'running' || scanning) {
      pollRef.current = setInterval(async () => {
        const state = await loadScanStatus();
        if (state && state.status !== 'running') {
          if (pollRef.current) clearInterval(pollRef.current);
          setScanning(false);
          void loadPackages();
        }
      }, 3000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [scanState?.status, scanning, loadScanStatus, loadPackages]);

  const startScan = useCallback(async (org: string) => {
    setScanning(true);
    try {
      const result = await fetchApi<{ scanId: string; message: string }>('/tech-radar/scan', {
        method: 'POST',
        body: JSON.stringify({ org, triggeredBy: currentUser.id, triggeredByName: currentUser.name }),
      });
      setScanState((prev) => ({
        ...(prev ?? { repoCount: 0, packageCount: 0 }),
        scanId: result.scanId,
        startedAt: new Date().toISOString(),
        status: 'running',
      }));
    } catch (err) {
      console.error('[tech-radar] Scan failed to start:', err);
      setScanning(false);
    }
  }, [currentUser]);

  const filteredPackages = useMemo(() => {
    return packages.filter((pkg) => {
      const matchSearch = pkg.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchEco = ecoFilter === 'all' || pkg.ecosystem === ecoFilter;
      return matchSearch && matchEco;
    });
  }, [packages, searchTerm, ecoFilter]);

  const stats = useMemo(() => {
    const total = packages.length;
    if (total === 0) return { total: 0, adoptPct: 0, holdPct: 0, unassessed: 0 };
    const adopt = packages.filter((p) => p.status === 'adopt').length;
    const hold = packages.filter((p) => p.status === 'hold').length;
    const unassessed = packages.filter((p) => p.status === 'unassessed').length;
    return {
      total,
      adoptPct: Math.round((adopt / total) * 100),
      holdPct: Math.round((hold / total) * 100),
      unassessed,
    };
  }, [packages]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Technology Radar"
        actions={
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-blue-700 hover:shadow-md hover:-translate-y-0.5"
          >
            <Plus className="h-4 w-4" /> Add Technology
          </button>
        }
      />

      <ScanBanner scanState={scanState} scanning={scanning} onOpenScanModal={() => setShowScanModal(true)} />

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Tracked Dependencies', value: stats.total,        icon: <Package className="h-5 w-5 text-blue-500" /> },
          { label: 'Adopted (Safe)',        value: `${stats.adoptPct}%`, icon: <Check className="h-5 w-5 text-emerald-500" /> },
          { label: 'Hold / Deprecated',    value: `${stats.holdPct}%`,  icon: <ShieldAlert className="h-5 w-5 text-red-500" /> },
          { label: 'Awaiting Review',       value: stats.unassessed,   icon: <Filter className="h-5 w-5 text-gray-500" /> },
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-slate-200/60 bg-white/60 p-5 shadow-xl shadow-slate-200/20 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-gray-50 dark:bg-gray-800">{stat.icon}</div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{stat.label}</p>
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-center bg-white/40 dark:bg-zinc-900/20 p-4 rounded-xl border border-slate-200/50 dark:border-white/5 backdrop-blur-md">
        <div className="relative w-full sm:w-96">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-gray-400" />
          </div>
          <input
            type="text"
            className="block w-full pl-10 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white/80 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-900/50 dark:border-gray-700 dark:text-white"
            placeholder="Search package name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="h-4 w-4 text-gray-400" />
          <select
            className="w-full sm:w-auto pl-3 pr-8 py-2 border border-gray-200 rounded-lg text-sm bg-white/80 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-900/50 dark:border-gray-700 dark:text-white"
            value={ecoFilter}
            onChange={(e) => setEcoFilter(e.target.value)}
          >
            <option value="all">All Ecosystems</option>
            <option value="npm">NPM</option>
            <option value="pip">PIP</option>
            <option value="maven">Maven</option>
            <option value="go">Go Modules</option>
          </select>
        </div>
      </div>

      {/* Kanban Board */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 overflow-x-auto pb-4">
        {(Object.keys(STATUS_CONFIG) as TechStatus[]).map((status) => (
          <div key={status} className="flex flex-col min-w-[280px]">
            <div className="mb-3 px-1">
              <div className="flex items-center justify-between gap-2 mb-1">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white truncate">
                  {STATUS_CONFIG[status].title}
                </h3>
                <span className="shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-400">
                  {filteredPackages.filter((p) => p.status === status).length}
                </span>
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">{STATUS_CONFIG[status].desc}</p>
            </div>

            <div className="flex flex-col gap-3 h-full rounded-2xl border border-slate-200/50 bg-slate-50/50 p-2 dark:border-white/5 dark:bg-zinc-900/20 backdrop-blur-sm min-h-[500px]">
              {filteredPackages
                .filter((p) => p.status === status)
                .map((pkg) => (
                  <div
                    key={pkg.SK}
                    onClick={() => setSelectedPkg(pkg)}
                    className="group cursor-pointer flex flex-col rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm dark:shadow-black/20 transition-all hover:shadow-md dark:hover:shadow-black/40 hover:border-blue-300 dark:border-white/10 dark:bg-zinc-800/80 dark:hover:border-blue-500/50 hover:-translate-y-0.5"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-semibold text-sm text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        {pkg.name}
                      </span>
                      <div className="flex items-center gap-1.5 ml-2 shrink-0">
                        {(pkg.vulns?.length ?? 0) > 0 && (
                          <span title={`${pkg.vulns.length} vulnerabilities`}>
                            <AlertTriangle className="h-3.5 w-3.5 text-orange-400" />
                          </span>
                        )}
                        {(pkg.comments?.length ?? 0) > 0 && (
                          <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                            <MessageSquare className="h-3 w-3" />{pkg.comments.length}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mb-3 h-8">
                      {pkg.description || 'No description provided.'}
                    </p>
                    <div className="flex justify-between items-center mt-auto pt-2 border-t border-gray-100 dark:border-gray-700/50">
                      <div className="flex items-center gap-1.5 text-xs text-gray-400">
                        {ECOSYSTEM_ICONS[pkg.ecosystem]}
                        <span className="uppercase">{pkg.ecosystem}</span>
                      </div>
                      <span className="text-[10px] bg-slate-100 dark:bg-zinc-900 px-1.5 py-0.5 rounded text-gray-500 shrink-0">
                        {pkg.repositories.length} repo{pkg.repositories.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>

      {/* Modals / Drawer */}
      {showScanModal && (
        <ScanModal
          onClose={() => setShowScanModal(false)}
          onScan={(org) => { void startScan(org); }}
          hasPackages={packages.length > 0}
        />
      )}

      {showAdd && (
        <AddModal
          onClose={() => setShowAdd(false)}
          onAdded={(pkg) => setPackages((prev) => [pkg, ...prev])}
          currentUser={currentUser}
        />
      )}

      {selectedPkg && (
        <PackageDrawer
          pkg={selectedPkg}
          onClose={() => setSelectedPkg(null)}
          currentUser={currentUser}
          onUpdated={(updated) => {
            setPackages((prev) => prev.map((p) => (p.SK === updated.SK ? updated : p)));
            setSelectedPkg(updated);
          }}
          onDeleted={(deleted) => {
            setPackages((prev) => prev.filter((p) => p.SK !== deleted.SK));
            setSelectedPkg(null);
          }}
        />
      )}
    </div>
  );
}
