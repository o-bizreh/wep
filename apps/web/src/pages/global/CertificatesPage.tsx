import { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@wep/ui';
import { Lock, CheckCircle, XCircle, Loader2, RefreshCw, Search } from 'lucide-react';
import { globalApi } from '../../lib/api';
import { cacheGet, cacheSet, cacheClear } from '../../lib/cache';

type Certificate = Awaited<ReturnType<typeof globalApi.getCertificates>>[number];
const CACHE_KEY = 'global-certificates';

function expiryClass(days: number | null) {
  if (days === null) return '';
  if (days <= 7)  return 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950/30 dark:text-red-400';
  if (days <= 30) return 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950/30 dark:text-amber-400';
  return 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/30 dark:text-emerald-400';
}

export function CertificatesPage() {
  const [data, setData] = useState<Certificate[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async (bust = false) => {
    if (!bust) { const c = cacheGet<Certificate[]>(CACHE_KEY); if (c) { setData(c); setLoading(false); return; } }
    else cacheClear(CACHE_KEY);
    setError(null);
    try { const d = await globalApi.getCertificates(); cacheSet(CACHE_KEY, d); setData(d); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const q = search.toLowerCase();
  const filtered = (data ?? []).filter((c) => !q || c.domain.toLowerCase().includes(q) || c.sans.some((s) => s.toLowerCase().includes(q)));

  const expiringSoon = (data ?? []).filter((c) => c.daysLeft !== null && c.daysLeft <= 30).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="ACM Certificates"
        actions={
          <div className="flex items-center gap-3">
            <div className="relative w-52">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search domain…"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-zinc-900 text-sm dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            </div>
            <button onClick={() => { setRefreshing(true); void load(true); }} disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50 transition-colors">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        }
      />
      <p className="text-sm text-gray-500 dark:text-gray-400">ACM certificates in us-east-1. Cached 24 hours. Red = expires ≤7d, amber = ≤30d.</p>

      {data && expiringSoon > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          {expiringSoon} certificate{expiringSoon !== 1 ? 's' : ''} expiring within 30 days.
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div>
      ) : error ? (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 px-4 py-3 text-sm text-red-600 dark:text-red-400">{error}</div>
      ) : (
        <div className="rounded-2xl border border-slate-200/60 bg-white dark:border-white/10 dark:bg-zinc-900/40 shadow-xl shadow-slate-200/20 dark:shadow-black/40 overflow-hidden">
          {filtered.length === 0 ? (
            <p className="px-4 py-12 text-sm text-center text-gray-400">{search ? `No certificates match "${search}"` : 'No certificates found.'}</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50/50 dark:bg-white/5 border-b border-gray-100 dark:border-white/10">
                {['Domain / SANs', 'Status', 'Expires', 'Type', 'In Use By'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-400">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {filtered.map((c) => (
                  <tr key={c.arn} className="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs font-medium text-gray-900 dark:text-white">{c.domain}</p>
                      {c.sans.filter((s) => s !== c.domain).slice(0, 2).map((s) => <p key={s} className="text-xs text-gray-400 font-mono">{s}</p>)}
                      {c.sans.length > 3 && <p className="text-xs text-gray-400">+{c.sans.length - 3} SANs</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${c.status === 'ISSUED' ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/30 dark:text-emerald-400' : 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950/30 dark:text-red-400'}`}>
                        {c.status === 'ISSUED' ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}{c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {c.daysLeft !== null
                        ? <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${expiryClass(c.daysLeft)}`}>{c.daysLeft}d left</span>
                        : <span className="text-xs text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{c.type} · {c.keyAlgorithm}</td>
                    <td className="px-4 py-3">
                      {c.inUseBy.length === 0
                        ? <span className="text-xs text-gray-400 italic">Not in use</span>
                        : <div className="space-y-0.5">
                            {c.inUseBy.slice(0, 2).map((r) => <p key={r} className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate max-w-xs">{r.split('/').pop()}</p>)}
                            {c.inUseBy.length > 2 && <p className="text-xs text-gray-400">+{c.inUseBy.length - 2} more</p>}
                          </div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
