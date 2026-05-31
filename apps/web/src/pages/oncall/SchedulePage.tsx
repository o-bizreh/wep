import { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@wep/ui';
import { Loader2, Calendar, Plus } from 'lucide-react';
import { fetchApi } from '../../lib/api';

interface OnCallEntry {
  teamId: string;
  teamName: string;
  weekStart: string;
  primary: string;
  secondary: string | null;
  updatedAt: string;
}

function getMondayISO(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function getWeekLabel(iso: string): string {
  const d = new Date(iso);
  const end = new Date(d);
  end.setDate(end.getDate() + 6);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

export function SchedulePage() {
  const [oncall, setOncall] = useState<OnCallEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editEntry, setEditEntry] = useState<OnCallEntry | null>(null);

  // Form state
  const [fTeamId, setFTeamId] = useState('');
  const [fTeamName, setFTeamName] = useState('');
  const [fWeek, setFWeek] = useState(getMondayISO());
  const [fPrimary, setFPrimary] = useState('');
  const [fSecondary, setFSecondary] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = await fetchApi<{ oncall: OnCallEntry[] }>('/on-call/who');
    setOncall(r.oncall);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  function startEdit(entry: OnCallEntry) {
    setEditEntry(entry);
    setFTeamId(entry.teamId);
    setFTeamName(entry.teamName);
    setFWeek(entry.weekStart);
    setFPrimary(entry.primary);
    setFSecondary(entry.secondary ?? '');
    setShowAdd(true);
  }

  async function save() {
    if (!fTeamId.trim() || !fPrimary.trim()) return;
    setSaving(true);
    try {
      await fetchApi(`/on-call/schedules/${fTeamId}/weeks/${fWeek}`, {
        method: 'PUT',
        body: JSON.stringify({ teamName: fTeamName || fTeamId, primary: fPrimary, secondary: fSecondary || undefined }),
      });
      setShowAdd(false);
      setEditEntry(null);
      setFTeamId(''); setFTeamName(''); setFPrimary(''); setFSecondary('');
      await load();
    } finally { setSaving(false); }
  }

  // Suppress unused variable warning — editEntry is used for future field pre-population
  void editEntry;

  return (
    <div className="space-y-6">
      <PageHeader
        title="On-Call Schedule"
        actions={
          <button onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
            <Plus className="h-4 w-4" /> Set Schedule
          </button>
        }
      />

      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Calendar className="h-4 w-4" />
        <span>Week of {getWeekLabel(getMondayISO())}</span>
      </div>

      {showAdd && (
        <div className="rounded-lg border border-indigo-200 dark:border-indigo-900/40 bg-indigo-50 dark:bg-indigo-950/10 p-4 space-y-3">
          <h3 className="text-sm font-semibold">Set on-call assignment</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <input value={fTeamId} onChange={e => setFTeamId(e.target.value)} placeholder="Team ID *"
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <input value={fTeamName} onChange={e => setFTeamName(e.target.value)} placeholder="Team display name"
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <div>
              <label className="block text-xs text-gray-500 mb-1">Week (Monday)</label>
              <input type="date" value={fWeek} onChange={e => setFWeek(e.target.value)}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <input value={fPrimary} onChange={e => setFPrimary(e.target.value)} placeholder="Primary on-call (username) *"
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <input value={fSecondary} onChange={e => setFSecondary(e.target.value)} placeholder="Secondary (optional)"
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => { void save(); }} disabled={saving || !fTeamId.trim() || !fPrimary.trim()}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60 inline-flex items-center gap-2">
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Save
            </button>
            <button onClick={() => { setShowAdd(false); setEditEntry(null); }}
              className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
      ) : oncall.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 py-16 text-center text-sm text-gray-500">
          No on-call schedules for this week. Click "Set Schedule" to assign coverage.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {oncall.map(oc => (
            <div key={oc.teamId} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-gray-900 dark:text-white">{oc.teamName}</span>
                <button onClick={() => startEdit(oc)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Edit</button>
              </div>
              <div className="text-sm">
                <span className="text-gray-500 text-xs">Primary: </span>
                <span className="font-medium">{oc.primary}</span>
              </div>
              {oc.secondary && (
                <div className="text-sm mt-0.5">
                  <span className="text-gray-500 text-xs">Secondary: </span>
                  <span>{oc.secondary}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
