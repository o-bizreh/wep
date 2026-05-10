import { useMemo, useState } from 'react';
import { PageHeader } from '@wep/ui';
import { Loader2, AlertCircle, Plus, Trash2, Wallet, CheckCircle2, AlertTriangle, XCircle, Cloud } from 'lucide-react';
import { portfolioApi, type BudgetConfig, type BudgetStatus } from '../../lib/api';
import { useCachedQuery, invalidatePrefix } from '../../lib/query-cache';

function fmtCurrency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

function statusIcon(s: BudgetStatus): JSX.Element {
  if (s.percentUsed >= 100) return <XCircle className="h-5 w-5 text-red-500" />;
  if (s.percentUsed >= s.alertThreshold) return <AlertTriangle className="h-5 w-5 text-amber-500" />;
  return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
}

export function BudgetsPage() {
  const { data, isLoading, isFetching, error, refetch } = useCachedQuery(
    'portfolio:budgets:status',
    () => portfolioApi.getBudgetStatuses(),
    { staleTimeMs: 5 * 60_000 },
  );
  const statuses: BudgetStatus[] = data?.statuses ?? [];
  const noCreds = !!data?.noCredentials;

  // AWS-native budgets configured outside the platform (in the AWS console or via
  // AWS Budgets CFN). Surfaced read-only — we don't manage them here.
  const awsBudgetsQuery = useCachedQuery(
    'portfolio:budgets:aws',
    () => portfolioApi.listAwsBudgets(),
    { staleTimeMs: 10 * 60_000 },
  );
  const awsBudgets = awsBudgetsQuery.data?.budgets ?? [];

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Partial<BudgetConfig>>({
    name: '', monthlyBudget: 1000, scope: 'service', scopeValue: '', alertThreshold: 80, notificationEmails: [],
  });
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  async function save() {
    if (!form.name || typeof form.monthlyBudget !== 'number') return;
    setSaving(true); setMutationError(null);
    try {
      await portfolioApi.saveBudget(form);
      setShowForm(false);
      setForm({ name: '', monthlyBudget: 1000, scope: 'service', scopeValue: '', alertThreshold: 80, notificationEmails: [] });
      // The mutation invalidated the server cache; tell the client cache to refetch too.
      invalidatePrefix('portfolio:budgets');
      refetch();
    } catch (e) { setMutationError(e instanceof Error ? e.message : 'Failed to save'); }
    finally { setSaving(false); }
  }

  async function remove(id: string) {
    if (!confirm('Delete this budget?')) return;
    try {
      await portfolioApi.deleteBudget(id);
      invalidatePrefix('portfolio:budgets');
      refetch();
    } catch (e) { setMutationError(e instanceof Error ? e.message : 'Failed to delete'); }
  }

  const summary = useMemo(() => {
    const onTrack = statuses.filter((s) => s.percentUsed < s.alertThreshold).length;
    const atRisk = statuses.filter((s) => s.percentUsed >= s.alertThreshold && s.percentUsed < 100).length;
    const over = statuses.filter((s) => s.percentUsed >= 100).length;
    return { total: statuses.length, onTrack, atRisk, over };
  }, [statuses]);

  return (
    <div className="p-6">
      <PageHeader
        title="Budgets"
        onRefresh={refetch}
        refreshing={isFetching}
        actions={
          <button onClick={() => setShowForm(true)}
            className="rounded-xl bg-cyan-500 px-3 py-2 text-sm font-bold text-white shadow hover:bg-cyan-600 inline-flex items-center gap-2">
            <Plus className="h-4 w-4" />New Budget
          </button>
        }
      />

      {noCreds && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-50/30 dark:bg-amber-500/5 p-4 text-sm">
          AWS credentials not configured. Spend tracking is disabled.
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-2xl border border-zinc-200/60 dark:border-white/10 bg-white/60 dark:bg-zinc-900/40 p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Total</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{summary.total}</p>
        </div>
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-500/5 p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">On Track</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{summary.onTrack}</p>
        </div>
        <div className="rounded-2xl border border-amber-500/30 bg-amber-50/30 dark:bg-amber-500/5 p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-400">At Risk</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-amber-700 dark:text-amber-400">{summary.atRisk}</p>
        </div>
        <div className="rounded-2xl border border-red-500/30 bg-red-50/30 dark:bg-red-500/5 p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-red-700 dark:text-red-400">Over Budget</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-red-700 dark:text-red-400">{summary.over}</p>
        </div>
      </div>

      {(!!error || mutationError) && (
        <div className="mb-4 rounded-xl border border-red-500/20 bg-red-50 dark:bg-red-500/5 p-4">
          <AlertCircle className="inline h-4 w-4 text-red-500 mr-2" />
          <span className="text-sm text-red-600 dark:text-red-400">
            {mutationError ?? (error instanceof Error ? error.message : 'Failed to load')}
          </span>
        </div>
      )}

      {isLoading && statuses.length === 0 ? (
        <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-cyan-500" /></div>
      ) : statuses.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 dark:border-white/10 p-12 text-center">
          <Wallet className="mx-auto h-10 w-10 text-zinc-400" />
          <p className="mt-3 text-sm text-zinc-500">No budgets configured. Click "New Budget" to create one.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {statuses.map((s) => (
            <div key={s.id} className="rounded-2xl border border-zinc-200/60 dark:border-white/10 bg-white/60 dark:bg-zinc-900/40 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  {statusIcon(s)}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate">{s.name}</h3>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {s.scope === 'all' ? 'Total monthly spend' : s.scope === 'service' ? `Service: ${s.scopeValue}` : `Tag: ${s.scopeValue}`}
                    </p>
                    <div className="mt-2">
                      <div className="flex justify-between text-xs mb-1">
                        <span>{fmtCurrency(s.currentSpend)} of {fmtCurrency(s.monthlyBudget)}</span>
                        <span className="font-bold">{s.percentUsed.toFixed(0)}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                        <div className={`h-full rounded-full ${s.percentUsed >= 100 ? 'bg-red-500' : s.percentUsed >= s.alertThreshold ? 'bg-amber-500' : 'bg-emerald-500'}`}
                          style={{ width: `${Math.min(100, s.percentUsed)}%` }} />
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                      <span>Burn rate (proj): {fmtCurrency(s.burnRate)}</span>
                      {s.projectedOverage > 0 && <span className="text-red-500">Projected overage: {fmtCurrency(s.projectedOverage)}</span>}
                      <span>Alert at: {s.alertThreshold}%</span>
                    </div>
                  </div>
                </div>
                <button onClick={() => remove(s.id)} className="text-zinc-400 hover:text-red-500" title="Delete">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Native AWS Budgets — read-only mirror of whatever is configured in
          the AWS console. We don't manage these here; the Cloud icon makes the
          distinction obvious. */}
      <section className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <Cloud className="h-4 w-4 text-cyan-500" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500">AWS Budgets</h2>
          <span className="text-[11px] text-zinc-400">read-only · managed in AWS console</span>
        </div>
        {awsBudgetsQuery.isLoading ? (
          <div className="flex items-center justify-center p-6"><Loader2 className="h-5 w-5 animate-spin text-cyan-500" /></div>
        ) : awsBudgets.length === 0 ? (
          <div className="rounded-xl border border-zinc-200 dark:border-white/10 p-6 text-center">
            <p className="text-sm text-zinc-500">
              {awsBudgetsQuery.data?.noCredentials
                ? 'AWS credentials not configured.'
                : 'No native AWS Budgets configured for this account.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {awsBudgets.map((b) => (
              <div key={b.name} className="rounded-2xl border border-cyan-500/20 bg-cyan-50/30 dark:bg-cyan-500/5 p-4">
                <div className="flex items-start gap-3">
                  <Cloud className={`h-5 w-5 flex-none ${b.percentUsed >= 100 ? 'text-red-500' : b.percentUsed >= 80 ? 'text-amber-500' : 'text-cyan-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h3 className="font-semibold truncate">{b.name}</h3>
                      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                        <span className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 font-mono">{b.type}</span>
                        <span className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 font-mono">{b.timeUnit}</span>
                      </div>
                    </div>
                    <div className="mt-2">
                      <div className="flex justify-between text-xs mb-1">
                        <span>{fmtCurrency(b.actualSpend)} of {fmtCurrency(b.limit)}</span>
                        <span className="font-bold">{b.percentUsed.toFixed(0)}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                        <div className={`h-full rounded-full ${b.percentUsed >= 100 ? 'bg-red-500' : b.percentUsed >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                          style={{ width: `${Math.min(100, b.percentUsed)}%` }} />
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                      <span>Forecast: {fmtCurrency(b.forecastedSpend)}</span>
                      {!b.onTrack && <span className="text-red-500">Will exceed limit</span>}
                      {b.startDate && <span>Period: {b.startDate.slice(0, 10)} → {b.endDate?.slice(0, 10) ?? '—'}</span>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-950 p-6 shadow-2xl">
            <h2 className="mb-4 text-lg font-bold">New Budget</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1">Name</label>
                <input type="text" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-zinc-900" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1">Monthly Budget (USD)</label>
                <input type="number" min={0} value={form.monthlyBudget ?? 0} onChange={(e) => setForm({ ...form, monthlyBudget: Number(e.target.value) })}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-zinc-900" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1">Scope</label>
                <select value={form.scope ?? 'service'} onChange={(e) => setForm({ ...form, scope: e.target.value as BudgetConfig['scope'] })}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-zinc-900">
                  <option value="all">All Spend</option>
                  <option value="service">Single Service</option>
                  <option value="tag">Tag (key:value)</option>
                </select>
              </div>
              {form.scope !== 'all' && (
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1">
                    {form.scope === 'service' ? 'Service Name (e.g. Amazon EC2)' : 'Tag (e.g. Team:platform)'}
                  </label>
                  <input type="text" value={form.scopeValue ?? ''} onChange={(e) => setForm({ ...form, scopeValue: e.target.value })}
                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-zinc-900" />
                </div>
              )}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1">Alert Threshold (%)</label>
                <input type="number" min={0} max={100} value={form.alertThreshold ?? 80} onChange={(e) => setForm({ ...form, alertThreshold: Number(e.target.value) })}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-zinc-900" />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800">Cancel</button>
              <button onClick={save} disabled={saving} className="rounded-lg bg-cyan-500 px-3 py-2 text-sm font-bold text-white shadow hover:bg-cyan-600 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save Budget'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
