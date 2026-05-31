import { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@wep/ui';
import { Bell, Plus, Trash2, Loader2, ToggleLeft, ToggleRight } from 'lucide-react';
import { fetchApi } from '../../lib/api';

type AlertCondition = 'deploy_failed' | 'p1_incident' | 'cost_spike' | 'critical_vuln' | 'config_drift' | 'weekly_digest' | 'oncall_shift';
type ChannelType = 'slack' | 'email';

interface AlertRule {
  id: string;
  name: string;
  condition: AlertCondition;
  threshold: number | null;
  channelType: ChannelType;
  channelTarget: string;
  enabled: boolean;
  createdAt: string;
}

const CONDITION_LABELS: Record<AlertCondition, string> = {
  deploy_failed: 'Deploy Failed',
  p1_incident: 'P1 Incident',
  cost_spike: 'Cost Spike',
  critical_vuln: 'Critical Vulnerability',
  config_drift: 'Config Drift',
  weekly_digest: 'Weekly Digest',
  oncall_shift: 'On-Call Shift',
};

const CONDITION_COLORS: Record<AlertCondition, string> = {
  deploy_failed: 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400',
  p1_incident: 'bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400',
  cost_spike: 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400',
  critical_vuln: 'bg-purple-100 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400',
  config_drift: 'bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400',
  weekly_digest: 'bg-teal-100 text-teal-700 dark:bg-teal-950/30 dark:text-teal-400',
  oncall_shift: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400',
};

const EMPTY_FORM = { name: '', condition: 'deploy_failed' as AlertCondition, channelType: 'slack' as ChannelType, channelTarget: '', enabled: true, threshold: '' };

export function AlertRulesPage() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchApi<{ rules: AlertRule[] }>('/notify/alert-rules');
      setRules(data.rules);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createRule() {
    if (!form.name.trim() || !form.channelTarget.trim()) return;
    setSubmitting(true);
    try {
      await fetchApi('/notify/alert-rules', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          condition: form.condition,
          channelType: form.channelType,
          channelTarget: form.channelTarget,
          enabled: form.enabled,
          threshold: form.threshold ? Number(form.threshold) : undefined,
        }),
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleRule(rule: AlertRule) {
    await fetchApi(`/notify/alert-rules/${rule.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: !rule.enabled }),
    });
    await load();
  }

  async function deleteRule(id: string) {
    await fetchApi(`/notify/alert-rules/${id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alert Rules"
        actions={
          <button onClick={() => setShowForm(!showForm)}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors">
            <Plus className="h-4 w-4" /> New Rule
          </button>
        }
      />

      {showForm && (
        <div className="rounded-lg border border-indigo-200 dark:border-indigo-900/40 bg-indigo-50 dark:bg-indigo-950/10 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-indigo-700 dark:text-indigo-400">Create Alert Rule</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Rule name *"
              className="col-span-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <select
              value={form.condition}
              onChange={e => setForm(f => ({ ...f, condition: e.target.value as AlertCondition }))}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
            >
              {(Object.entries(CONDITION_LABELS) as [AlertCondition, string][]).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <input
              value={form.threshold}
              onChange={e => setForm(f => ({ ...f, threshold: e.target.value }))}
              placeholder="Threshold (optional)"
              type="number"
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <select
              value={form.channelType}
              onChange={e => setForm(f => ({ ...f, channelType: e.target.value as ChannelType }))}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
            >
              <option value="slack">Slack</option>
              <option value="email">Email</option>
            </select>
            <input
              value={form.channelTarget}
              onChange={e => setForm(f => ({ ...f, channelTarget: e.target.value }))}
              placeholder={form.channelType === 'slack' ? '#channel-name *' : 'email@example.com *'}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 col-span-2">
              <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))}
                className="rounded border-gray-300" />
              Enabled
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { void createRule(); }} disabled={submitting || !form.name.trim() || !form.channelTarget.trim()}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60 inline-flex items-center gap-2">
              {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Create Rule
            </button>
            <button onClick={() => setShowForm(false)}
              className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
      ) : rules.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 py-16 text-center text-sm text-gray-500">
          No alert rules yet. Create one to get started.
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Condition</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Channel</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rules.map(rule => (
                <tr key={rule.id} className="bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{rule.name}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${CONDITION_COLORS[rule.condition]}`}>
                      {CONDITION_LABELS[rule.condition]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    <span className="capitalize">{rule.channelType}</span>: {rule.channelTarget}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => { void toggleRule(rule); }} className="flex items-center gap-1.5 text-xs">
                      {rule.enabled
                        ? <><ToggleRight className="h-4 w-4 text-emerald-500" /><span className="text-emerald-600 dark:text-emerald-400">Enabled</span></>
                        : <><ToggleLeft className="h-4 w-4 text-gray-400" /><span className="text-gray-400">Disabled</span></>}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => { void deleteRule(rule.id); }}
                      className="rounded p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Bell className="h-3.5 w-3.5" />
        <span>{rules.length} rule{rules.length !== 1 ? 's' : ''} configured</span>
      </div>
    </div>
  );
}
