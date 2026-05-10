import { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@wep/ui';
import { Globe, Shield, CheckCircle, XCircle, AlertCircle, Loader2, RefreshCw, Search } from 'lucide-react';
import { globalApi } from '../../lib/api';
import { cacheGet, cacheSet, cacheClear } from '../../lib/cache';

type Distribution = Awaited<ReturnType<typeof globalApi.getDistributions>>[number];
const CACHE_KEY = 'global-distributions';

export function DistributionsPage() {
  const [data, setData] = useState<Distribution[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async (bust = false) => {
    if (!bust) { const c = cacheGet<Distribution[]>(CACHE_KEY); if (c) { setData(c); setLoading(false); return; } }
    else cacheClear(CACHE_KEY);
    setError(null);
    try { const d = await globalApi.getDistributions(); cacheSet(CACHE_KEY, d); setData(d); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const q = search.toLowerCase();
  const filtered = (data ?? []).filter((d) => !q || d.domainName.toLowerCase().includes(q) || d.aliases.some((a) => a.toLowerCase().includes(q)) || d.origins.some((o) => o.domain.toLowerCase().includes(q)));

  return (
    <div className="space-y-6">
      <PageHeader
        title="CloudFront Distributions"
        actions={
          <div className="flex items-center gap-3">
            <div className="relative w-52">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search domain or origin…"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-zinc-900 text-sm dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            </div>
            <button onClick={() => { setRefreshing(true); void load(true); }} disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50 transition-colors">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        }
      />
      <p className="text-sm text-gray-500 dark:text-gray-400">All CloudFront distributions in your account. Cached 24 hours.</p>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div>
      ) : error ? (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 px-4 py-3 text-sm text-red-600 dark:text-red-400">{error}</div>
      ) : (
        <div className="rounded-2xl border border-slate-200/60 bg-white dark:border-white/10 dark:bg-zinc-900/40 shadow-xl shadow-slate-200/20 dark:shadow-black/40 overflow-hidden">
          {filtered.length === 0 ? (
            <p className="px-4 py-12 text-sm text-center text-gray-400">{search ? `No distributions match "${search}"` : 'No distributions found.'}</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50/50 dark:bg-white/5 border-b border-gray-100 dark:border-white/10">
                {['Domain / Aliases', 'Status', 'Origins', 'Price Class', 'WAF', 'Modified'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-400">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {filtered.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs font-medium text-gray-900 dark:text-white">{d.domainName}</p>
                      {d.aliases.map((a) => <p key={a} className="text-xs text-gray-400 font-mono">{a}</p>)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${d.status === 'Deployed' ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/30 dark:text-emerald-400' : 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950/30 dark:text-amber-400'}`}>
                        {d.status === 'Deployed' ? <CheckCircle className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}{d.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {d.origins.slice(0, 2).map((o) => <p key={o.id} className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate max-w-xs">{o.domain}</p>)}
                      {d.origins.length > 2 && <p className="text-xs text-gray-400">+{d.origins.length - 2} more</p>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{d.priceClass.replace('PriceClass_', '')}</td>
                    <td className="px-4 py-3">
                      {d.wafWebAclId ? <Shield className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-gray-300 dark:text-gray-600" />}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{d.lastModified ? new Date(d.lastModified).toLocaleDateString() : '—'}</td>
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
