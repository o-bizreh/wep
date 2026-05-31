import { useState, useEffect } from 'react';
import { PageHeader } from '@wep/ui';
import { Loader2, TrendingUp, TrendingDown, Minus, AlertCircle } from 'lucide-react';
import { fetchApi } from '../../lib/api';

interface ServiceCostItem {
  service: string;
  currentMonth: number;
  lastMonth: number;
  changePercent: number;
}

interface TeamCostItem {
  team: string;
  currentMonth: number;
  lastMonth: number;
  changePercent: number;
}

function fmtUSD(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function ChangeChip({ pct }: { pct: number }) {
  if (Math.abs(pct) < 0.5) return <span className="flex items-center gap-1 text-xs text-gray-400"><Minus className="h-3 w-3" />0%</span>;
  if (pct > 0) return <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400"><TrendingUp className="h-3 w-3" />+{pct.toFixed(1)}%</span>;
  return <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><TrendingDown className="h-3 w-3" />{pct.toFixed(1)}%</span>;
}

export function CostAttributionPage() {
  const [tab, setTab] = useState<'services' | 'teams'>('services');
  const [services, setServices] = useState<ServiceCostItem[]>([]);
  const [teams, setTeams] = useState<TeamCostItem[]>([]);
  const [untagged, setUntagged] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState('');

  useEffect(() => {
    Promise.all([
      fetchApi<{ services: ServiceCostItem[]; untaggedCost: number; period: string }>('/costs/by-service'),
      fetchApi<{ teams: TeamCostItem[]; period: string }>('/costs/by-team'),
    ])
      .then(([svc, tm]) => {
        setServices(svc.services);
        setUntagged(svc.untaggedCost);
        setTeams(tm.teams);
        setPeriod(svc.period);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const totalTagged = services.reduce((s: number, r: ServiceCostItem) => s + r.currentMonth, 0);
  const coveragePct = (totalTagged + untagged) > 0
    ? Math.round(totalTagged / (totalTagged + untagged) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Cost Attribution" />

      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20 px-4 py-3 flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error} — ensure AWS Cost Explorer is enabled and resources are tagged with Service/Team keys.
        </div>
      )}

      {/* Coverage indicator */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 flex items-center justify-between text-sm">
        <span className="text-gray-600 dark:text-gray-400">Tag coverage this month</span>
        <div className="flex items-center gap-3">
          <div className="w-32 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${coveragePct}%` }} />
          </div>
          <span className="font-semibold text-gray-900 dark:text-white">{coveragePct}%</span>
          {untagged > 0 && <span className="text-gray-400 text-xs">{fmtUSD(untagged)} untagged</span>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {([{ key: 'services', label: 'By Service' }, { key: 'teams', label: 'By Team' }] as const).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t.key ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
      ) : tab === 'services' ? (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-100 dark:divide-gray-800">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-400 bg-gray-50 dark:bg-gray-800/50">
                <th className="px-5 py-3">Service Tag</th>
                <th className="px-5 py-3">This Month</th>
                <th className="px-5 py-3">Last Month</th>
                <th className="px-5 py-3">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800 bg-white dark:bg-gray-900">
              {services.map((s) => (
                <tr key={s.service} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-5 py-3 text-sm font-medium text-gray-900 dark:text-white">{s.service}</td>
                  <td className="px-5 py-3 text-sm tabular-nums font-semibold">{fmtUSD(s.currentMonth)}</td>
                  <td className="px-5 py-3 text-sm tabular-nums text-gray-500">{fmtUSD(s.lastMonth)}</td>
                  <td className="px-5 py-3"><ChangeChip pct={s.changePercent} /></td>
                </tr>
              ))}
              {services.length === 0 && (
                <tr><td colSpan={4} className="px-5 py-8 text-center text-sm text-gray-400">No tagged services found. Tag your AWS resources with Service=&lt;name&gt; to see attribution.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-100 dark:divide-gray-800">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-400 bg-gray-50 dark:bg-gray-800/50">
                <th className="px-5 py-3">Team</th>
                <th className="px-5 py-3">This Month</th>
                <th className="px-5 py-3">Last Month</th>
                <th className="px-5 py-3">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800 bg-white dark:bg-gray-900">
              {teams.map((t) => (
                <tr key={t.team} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-5 py-3 text-sm font-medium text-gray-900 dark:text-white">{t.team}</td>
                  <td className="px-5 py-3 text-sm tabular-nums font-semibold">{fmtUSD(t.currentMonth)}</td>
                  <td className="px-5 py-3 text-sm tabular-nums text-gray-500">{fmtUSD(t.lastMonth)}</td>
                  <td className="px-5 py-3"><ChangeChip pct={t.changePercent} /></td>
                </tr>
              ))}
              {teams.length === 0 && (
                <tr><td colSpan={4} className="px-5 py-8 text-center text-sm text-gray-400">No tagged teams found. Tag your AWS resources with Team=&lt;name&gt; to see attribution.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {period && <p className="text-xs text-gray-400 text-right">Data for {period} · Source: AWS Cost Explorer</p>}
    </div>
  );
}
