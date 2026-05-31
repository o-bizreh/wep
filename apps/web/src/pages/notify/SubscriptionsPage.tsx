import { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@wep/ui';
import { Bell, Plus, Trash2, Loader2 } from 'lucide-react';
import { fetchApi } from '../../lib/api';

type EventType = 'deploy' | 'drift' | 'ownership_change';

interface Subscription {
  userId: string;
  serviceId: string;
  serviceName: string;
  events: EventType[];
  createdAt: string;
}

const EVENT_LABELS: Record<EventType, string> = {
  deploy: 'Deployments',
  drift: 'Config Drift',
  ownership_change: 'Ownership Change',
};

const CURRENT_USER = 'me';

const EMPTY_FORM = { serviceName: '', serviceId: '', events: [] as EventType[] };

export function SubscriptionsPage() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchApi<{ subscriptions: Subscription[] }>(`/notify/subscriptions?userId=${encodeURIComponent(CURRENT_USER)}`);
      setSubscriptions(data.subscriptions);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function toggleEvent(ev: EventType) {
    setForm(f => ({
      ...f,
      events: f.events.includes(ev) ? f.events.filter(e => e !== ev) : [...f.events, ev],
    }));
  }

  async function subscribe() {
    if (!form.serviceName.trim() || !form.serviceId.trim() || form.events.length === 0) return;
    setSubmitting(true);
    try {
      await fetchApi('/notify/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          userId: CURRENT_USER,
          serviceId: form.serviceId,
          serviceName: form.serviceName,
          events: form.events,
        }),
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  async function unsubscribe(sub: Subscription) {
    await fetchApi(`/notify/subscriptions/${encodeURIComponent(sub.userId)}/${encodeURIComponent(sub.serviceId)}`, {
      method: 'DELETE',
    });
    await load();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Service Subscriptions"
        actions={
          <button onClick={() => setShowForm(!showForm)}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors">
            <Plus className="h-4 w-4" /> Add Subscription
          </button>
        }
      />

      {showForm && (
        <div className="rounded-lg border border-indigo-200 dark:border-indigo-900/40 bg-indigo-50 dark:bg-indigo-950/10 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-indigo-700 dark:text-indigo-400">Subscribe to a Service</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              value={form.serviceName}
              onChange={e => setForm(f => ({ ...f, serviceName: e.target.value }))}
              placeholder="Service name *"
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <input
              value={form.serviceId}
              onChange={e => setForm(f => ({ ...f, serviceId: e.target.value }))}
              placeholder="Service ID *"
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-gray-600 dark:text-gray-400">Events to subscribe *</p>
            <div className="flex gap-3 flex-wrap">
              {(Object.entries(EVENT_LABELS) as [EventType, string][]).map(([ev, label]) => (
                <label key={ev} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.events.includes(ev)}
                    onChange={() => toggleEvent(ev)}
                    className="rounded border-gray-300"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { void subscribe(); }}
              disabled={submitting || !form.serviceName.trim() || !form.serviceId.trim() || form.events.length === 0}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60 inline-flex items-center gap-2">
              {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Subscribe
            </button>
            <button onClick={() => setShowForm(false)}
              className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
      ) : subscriptions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 py-16 text-center text-sm text-gray-500">
          No subscriptions yet. Subscribe to a service to get notified.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subscriptions.map(sub => (
            <div key={`${sub.serviceId}-${sub.userId}`}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white text-sm">{sub.serviceName}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{sub.serviceId}</p>
                </div>
                <button onClick={() => { void unsubscribe(sub); }}
                  className="rounded p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors shrink-0">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {sub.events.map(ev => (
                  <span key={ev}
                    className="inline-flex items-center gap-1 rounded-full bg-indigo-50 dark:bg-indigo-950/30 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-400">
                    <Bell className="h-3 w-3" />
                    {EVENT_LABELS[ev]}
                  </span>
                ))}
              </div>
              <p className="text-xs text-gray-400">Since {new Date(sub.createdAt).toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
