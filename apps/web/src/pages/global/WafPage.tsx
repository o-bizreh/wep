import { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@wep/ui';
import { Shield, ChevronDown, Loader2, RefreshCw, Search } from 'lucide-react';
import { globalApi } from '../../lib/api';
import { cacheGet, cacheSet, cacheClear } from '../../lib/cache';

type WafAcl = Awaited<ReturnType<typeof globalApi.getWaf>>[number];
const CACHE_KEY = 'global-waf';

export function WafPage() {
  const [data, setData] = useState<WafAcl[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async (bust = false) => {
    if (!bust) { const c = cacheGet<WafAcl[]>(CACHE_KEY); if (c) { setData(c); setLoading(false); return; } }
    else cacheClear(CACHE_KEY);
    setError(null);
    try { const d = await globalApi.getWaf(); cacheSet(CACHE_KEY, d); setData(d); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const q = search.toLowerCase();
  const filtered = (data ?? []).filter((a) => !q || a.name.toLowerCase().includes(q) || a.scope.toLowerCase().includes(q) || a.description.toLowerCase().includes(q));
  const unattached = (data ?? []).filter((a) => a.resources.length === 0).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="WAF Web ACLs"
        actions={
          <div className="flex items-center gap-3">
            <div className="relative w-52">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search ACL…"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-zinc-900 text-sm dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            </div>
            <button onClick={() => { setRefreshing(true); void load(true); }} disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50 transition-colors">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        }
      />
      <p className="text-sm text-gray-500 dark:text-gray-400">Web ACLs for CloudFront (global) and regional resources. Cached 24 hours. Expand to see protected resources.</p>

      {data && unattached > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          {unattached} ACL{unattached !== 1 ? 's are' : ' is'} not attached to any resource.
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div>
      ) : error ? (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 px-4 py-3 text-sm text-red-600 dark:text-red-400">{error}</div>
      ) : (
        <div className="rounded-2xl border border-slate-200/60 bg-white dark:border-white/10 dark:bg-zinc-900/40 shadow-xl shadow-slate-200/20 dark:shadow-black/40 overflow-hidden">
          {filtered.length === 0 ? (
            <p className="px-4 py-12 text-sm text-center text-gray-400">{search ? `No ACLs match "${search}"` : 'No Web ACLs found.'}</p>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-white/5">
              {filtered.map((acl) => (
                <div key={acl.id}>
                  <button onClick={() => toggle(acl.id)}
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors text-left">
                    <div className="flex items-center gap-3 min-w-0">
                      <Shield className={`h-4 w-4 shrink-0 ${acl.resources.length === 0 ? 'text-amber-400' : 'text-indigo-500'}`} />
                      <span className="font-mono text-sm font-medium text-gray-900 dark:text-white truncate">{acl.name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium shrink-0 ${acl.scope === 'CLOUDFRONT' ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400' : 'bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400'}`}>
                        {acl.scope}
                      </span>
                      {acl.resources.length === 0
                        ? <span className="rounded-full bg-amber-100 dark:bg-amber-950/30 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400 shrink-0">Not attached</span>
                        : <span className="text-xs text-gray-400 shrink-0">{acl.resources.length} resource{acl.resources.length !== 1 ? 's' : ''}</span>}
                    </div>
                    <ChevronDown className={`h-4 w-4 text-gray-400 shrink-0 transition-transform ${expanded.has(acl.id) ? 'rotate-180' : ''}`} />
                  </button>

                  {expanded.has(acl.id) && (
                    <div className="border-t border-gray-100 dark:border-white/10 px-5 py-4 bg-gray-50/50 dark:bg-white/[0.02] space-y-3">
                      {acl.description && <p className="text-xs text-gray-400">{acl.description}</p>}
                      {acl.resources.length === 0 ? (
                        <p className="text-xs text-amber-500">No resources attached — this ACL is not protecting anything.</p>
                      ) : (
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Protected Resources</p>
                          <div className="space-y-1.5">
                            {acl.resources.map((r) => (
                              <p key={r} className="font-mono text-xs text-gray-600 dark:text-gray-400 truncate">{r}</p>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
