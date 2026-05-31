import React, { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@wep/ui';
import { ShieldCheck, RotateCcw, Search, AlertTriangle, Clock } from 'lucide-react';
import { fetchApi } from '../../lib/api';

type TrackingStatus = 'open' | 'in_progress' | 'fixed' | 'wont_fix';
type Severity = 'critical' | 'high' | 'moderate' | 'low' | 'info';

interface VulnTrackingItem {
  id: string;
  repoFullName: string;
  packageName: string;
  installedVersion: string;
  ghsaId: string;
  cveId: string | null;
  severity: Severity;
  summary: string;
  fixedIn: string | null;
  assignedTeamId: string | null;
  assignedTeamName: string | null;
  dueDate: string | null;
  status: TrackingStatus;
  notes: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

const SEV_STYLE: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 ring-1 ring-red-600/20 dark:bg-red-950/30 dark:text-red-400',
  high:     'bg-orange-100 text-orange-700 ring-1 ring-orange-600/20 dark:bg-orange-950/30 dark:text-orange-400',
  moderate: 'bg-amber-100 text-amber-700 ring-1 ring-amber-600/20 dark:bg-amber-950/30 dark:text-amber-400',
  low:      'bg-blue-100 text-blue-700 ring-1 ring-blue-600/20 dark:bg-blue-950/30 dark:text-blue-400',
  info:     'bg-gray-100 text-gray-600 ring-1 ring-gray-400/20 dark:bg-gray-800 dark:text-gray-400',
};

const STATUS_LABEL: Record<TrackingStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  fixed: 'Fixed',
  wont_fix: "Won't Fix",
};

const STATUS_STYLE: Record<TrackingStatus, string> = {
  open: 'bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400',
  in_progress: 'bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400',
  fixed: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400',
  wont_fix: 'bg-gray-100 text-gray-500 dark:bg-zinc-800 dark:text-gray-400',
};

const TODAY = new Date().toISOString().slice(0, 10);

function isOverdue(item: VulnTrackingItem): boolean {
  return !!item.dueDate
    && item.dueDate < TODAY
    && item.status !== 'fixed'
    && item.status !== 'wont_fix';
}

export function VulnTrackerPage() {
  const [items, setItems] = useState<VulnTrackingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [updating, setUpdating] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const data = await fetchApi<VulnTrackingItem[]>('/security/track');
      setItems(data);
    } catch (e) {
      console.error('[vuln-tracker] Failed to load:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleStatusChange = async (id: string, status: TrackingStatus) => {
    setUpdating((prev) => new Set(prev).add(id));
    try {
      const updated = await fetchApi<VulnTrackingItem>(`/security/track/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setItems((prev) => prev.map((item) => (item.id === id ? updated : item)));
    } catch (e) {
      console.error('[vuln-tracker] Update failed:', e);
    } finally {
      setUpdating((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  };

  const filtered = items.filter((item) => {
    if (statusFilter !== 'all' && item.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!item.packageName.toLowerCase().includes(q) && !item.repoFullName.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const openCount = items.filter((i) => i.status === 'open').length;
  const inProgressCount = items.filter((i) => i.status === 'in_progress').length;
  const fixedCount = items.filter((i) => i.status === 'fixed').length;
  const overdueCount = items.filter(isOverdue).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vuln Tracker"
        actions={
          <button
            onClick={() => { void load(); }}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
          >
            <RotateCcw className="h-4 w-4" />
            Refresh
          </button>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Open', value: openCount, style: 'text-red-600 dark:text-red-400', icon: <AlertTriangle className="h-5 w-5 text-red-500" /> },
          { label: 'In Progress', value: inProgressCount, style: 'text-amber-600 dark:text-amber-400', icon: <RotateCcw className="h-5 w-5 text-amber-500" /> },
          { label: 'Fixed', value: fixedCount, style: 'text-emerald-600 dark:text-emerald-400', icon: <ShieldCheck className="h-5 w-5 text-emerald-500" /> },
          { label: 'Overdue', value: overdueCount, style: 'text-red-600 dark:text-red-400', icon: <Clock className="h-5 w-5 text-red-600" /> },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-slate-200/60 bg-white/60 p-5 shadow-xl shadow-slate-200/20 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-gray-50 dark:bg-gray-800">{s.icon}</div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{s.label}</p>
            </div>
            <p className={`text-2xl font-bold ${s.style}`}>{s.value}</p>
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
            placeholder="Search package or repo…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-white focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
        {(['all', 'open', 'in_progress', 'fixed', 'wont_fix'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              statusFilter === s
                ? 'bg-indigo-600 text-white'
                : 'border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5'
            }`}
          >
            {s === 'all' ? 'All' : s === 'in_progress' ? 'In Progress' : s === 'wont_fix' ? "Won't Fix" : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        <span className="text-xs text-gray-400 ml-auto">{filtered.length} items</span>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-slate-200/60 bg-white dark:border-white/10 dark:bg-zinc-900/40 overflow-hidden shadow-xl shadow-slate-200/20 dark:shadow-black/40">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-white/10 bg-gray-50/50 dark:bg-white/5">
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Severity</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Package</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 hidden md:table-cell">Repo</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 hidden lg:table-cell">Assigned Team</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 hidden lg:table-cell">Due Date</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Status</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-white/5">
            {loading ? (
              <tr><td colSpan={7} className="py-12 text-center text-gray-400 text-sm">Loading tracking items…</td></tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center">
                  <ShieldCheck className="mx-auto h-8 w-8 text-emerald-400 mb-2" />
                  <p className="text-sm text-gray-500">No tracking items found.</p>
                </td>
              </tr>
            ) : (
              filtered.map((item) => {
                const overdue = isOverdue(item);
                return (
                  <tr
                    key={item.id}
                    className={`hover:bg-gray-50 dark:hover:bg-white/5 transition-colors ${overdue ? 'border-l-2 border-l-red-400' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${SEV_STYLE[item.severity] ?? SEV_STYLE['info']}`}>
                        {item.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-mono font-medium text-gray-900 dark:text-white">{item.packageName}</p>
                        <p className="text-xs text-gray-400">{item.ghsaId}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="font-mono text-xs text-gray-600 dark:text-gray-400">{item.repoFullName}</span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-sm text-gray-600 dark:text-gray-400">{item.assignedTeamName ?? '—'}</span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {item.dueDate ? (
                        <span className={`text-sm ${overdue ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-600 dark:text-gray-400'}`}>
                          {item.dueDate}{overdue ? ' ⚠' : ''}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={item.status}
                        disabled={updating.has(item.id)}
                        onChange={(e) => { void handleStatusChange(item.id, e.target.value as TrackingStatus); }}
                        className={`rounded-md px-2 py-1 text-xs font-medium border-0 focus:ring-1 focus:ring-indigo-500 cursor-pointer disabled:opacity-50 ${STATUS_STYLE[item.status]}`}
                      >
                        {(Object.keys(STATUS_LABEL) as TrackingStatus[]).map((s) => (
                          <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      {(item.status === 'open' || item.status === 'in_progress') && (
                        <button
                          disabled={updating.has(item.id)}
                          onClick={() => { void handleStatusChange(item.id, 'fixed'); }}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                        >
                          <ShieldCheck className="h-3.5 w-3.5" />
                          Mark Fixed
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
