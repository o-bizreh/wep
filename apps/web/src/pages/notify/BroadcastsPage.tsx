import { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@wep/ui';
import { Megaphone, Plus, Send, Loader2, CheckCircle2 } from 'lucide-react';
import { fetchApi } from '../../lib/api';

type BroadcastType = 'incident' | 'maintenance' | 'release' | 'general';

interface Broadcast {
  id: string;
  name: string;
  type: BroadcastType;
  subject: string;
  body: string;
  createdAt: string;
  sentAt: string | null;
}

const TYPE_LABELS: Record<BroadcastType, string> = {
  incident: 'Incident',
  maintenance: 'Maintenance',
  release: 'Release',
  general: 'General',
};

const TYPE_COLORS: Record<BroadcastType, string> = {
  incident: 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400',
  maintenance: 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400',
  release: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400',
  general: 'bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400',
};

const EMPTY_FORM = { name: '', type: 'general' as BroadcastType, subject: '', body: '' };

export function BroadcastsPage() {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [sending, setSending] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchApi<{ broadcasts: Broadcast[] }>('/notify/broadcasts');
      setBroadcasts(data.broadcasts);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createBroadcast() {
    if (!form.name.trim() || !form.subject.trim() || !form.body.trim()) return;
    setSubmitting(true);
    try {
      await fetchApi('/notify/broadcasts', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  async function sendBroadcast(id: string) {
    setSending(id);
    try {
      await fetchApi(`/notify/broadcasts/${id}/send`, { method: 'POST' });
      await load();
    } finally {
      setSending(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Broadcast Templates"
        actions={
          <button onClick={() => setShowForm(!showForm)}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors">
            <Plus className="h-4 w-4" /> New Template
          </button>
        }
      />

      {showForm && (
        <div className="rounded-lg border border-indigo-200 dark:border-indigo-900/40 bg-indigo-50 dark:bg-indigo-950/10 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-indigo-700 dark:text-indigo-400">Create Broadcast Template</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Template name *"
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <select
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value as BroadcastType }))}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
            >
              {(Object.entries(TYPE_LABELS) as [BroadcastType, string][]).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <input
              value={form.subject}
              onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
              placeholder="Subject *"
              className="col-span-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <textarea
              value={form.body}
              onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              placeholder="Message body *"
              rows={4}
              className="col-span-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={() => { void createBroadcast(); }}
              disabled={submitting || !form.name.trim() || !form.subject.trim() || !form.body.trim()}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60 inline-flex items-center gap-2">
              {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Create Template
            </button>
            <button onClick={() => setShowForm(false)}
              className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
      ) : broadcasts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 py-16 text-center text-sm text-gray-500">
          No broadcast templates yet. Create one to get started.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {broadcasts.map(bc => (
            <div key={bc.id}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 dark:text-white text-sm truncate">{bc.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">{bc.subject}</p>
                </div>
                <span className={`inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[bc.type]}`}>
                  {TYPE_LABELS[bc.type]}
                </span>
              </div>

              <p className="text-xs text-gray-500 line-clamp-3 flex-1">{bc.body}</p>

              <div className="flex items-center justify-between gap-2 pt-1 border-t border-gray-100 dark:border-gray-800">
                {bc.sentAt ? (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Sent {new Date(bc.sentAt).toLocaleString()}
                  </span>
                ) : (
                  <span className="text-xs text-gray-400">Not sent yet</span>
                )}
                <button
                  onClick={() => { void sendBroadcast(bc.id); }}
                  disabled={sending === bc.id}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors">
                  {sending === bc.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  {bc.sentAt ? 'Resend' : 'Send'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Megaphone className="h-3.5 w-3.5" />
        <span>{broadcasts.length} template{broadcasts.length !== 1 ? 's' : ''}</span>
        <span className="mx-1">·</span>
        <span>{broadcasts.filter(b => b.sentAt).length} sent</span>
      </div>
    </div>
  );
}
