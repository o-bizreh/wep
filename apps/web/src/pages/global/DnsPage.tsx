import { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@wep/ui';
import { Globe, ChevronRight, Loader2, RefreshCw, Search } from 'lucide-react';
import { globalApi } from '../../lib/api';
import { cacheGet, cacheSet, cacheClear } from '../../lib/cache';

type Zone      = Awaited<ReturnType<typeof globalApi.getDns>>['zones'][number];
type DnsRecord = Awaited<ReturnType<typeof globalApi.getDns>>['records'][number];
const CACHE_KEY = 'global-dns';

const TYPE_COLOR: Record<string, string> = {
  A:    'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400',
  AAAA: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-950/30 dark:text-cyan-400',
  CNAME:'bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400',
  MX:   'bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400',
  TXT:  'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-gray-400',
};
const typeColor = (t: string) => TYPE_COLOR[t] ?? 'bg-gray-100 text-gray-500 dark:bg-zinc-800 dark:text-gray-400';

export function DnsPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [records, setRecords] = useState<Record<string, DnsRecord[]>>({});
  const [loadingZones, setLoadingZones] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const loadZones = useCallback(async (bust = false) => {
    if (!bust) { const c = cacheGet<Zone[]>(CACHE_KEY); if (c) { setZones(c); setLoadingZones(false); return; } }
    else cacheClear(CACHE_KEY);
    setError(null);
    try { const d = await globalApi.getDns(); cacheSet(CACHE_KEY, d.zones); setZones(d.zones); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoadingZones(false); setRefreshing(false); }
  }, []);

  useEffect(() => { void loadZones(); }, [loadZones]);

  const toggleZone = async (zone: Zone) => {
    const isOpen = expanded.has(zone.id);
    setExpanded((s) => { const n = new Set(s); isOpen ? n.delete(zone.id) : n.add(zone.id); return n; });
    if (isOpen || records[zone.id]) return;
    setLoadingRecords(zone.id);
    try { const d = await globalApi.getDns(zone.id); setRecords((r) => ({ ...r, [zone.id]: d.records })); }
    catch { setRecords((r) => ({ ...r, [zone.id]: [] })); }
    finally { setLoadingRecords(null); }
  };

  const q = search.toLowerCase();
  const filteredZones = zones.filter((z) => !q || z.name.toLowerCase().includes(q));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Route 53 DNS"
        actions={
          <div className="flex items-center gap-3">
            <div className="relative w-52">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search zone…"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-zinc-900 text-sm dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            </div>
            <button onClick={() => { setRefreshing(true); void loadZones(true); }} disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50 transition-colors">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        }
      />
      <p className="text-sm text-gray-500 dark:text-gray-400">Hosted zones and record sets. Click a zone to expand its records. Zones cached 24 hours.</p>

      {loadingZones ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div>
      ) : error ? (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 px-4 py-3 text-sm text-red-600 dark:text-red-400">{error}</div>
      ) : (
        <div className="rounded-2xl border border-slate-200/60 bg-white dark:border-white/10 dark:bg-zinc-900/40 shadow-xl shadow-slate-200/20 dark:shadow-black/40 overflow-hidden">
          {filteredZones.length === 0 ? (
            <p className="px-4 py-12 text-sm text-center text-gray-400">No zones found.</p>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-white/5">
              {filteredZones.map((zone) => {
                const isOpen = expanded.has(zone.id);
                const zoneRecords = records[zone.id] ?? [];
                const filteredRecords = !q ? zoneRecords : zoneRecords.filter((r) => r.name.toLowerCase().includes(q) || r.type.toLowerCase().includes(q) || r.values.some((v) => v.toLowerCase().includes(q)));

                return (
                  <div key={zone.id}>
                    <button onClick={() => { void toggleZone(zone); }}
                      className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors text-left">
                      <div className="flex items-center gap-3">
                        <Globe className="h-4 w-4 text-gray-400 shrink-0" />
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${zone.private ? 'bg-gray-100 dark:bg-zinc-800 text-gray-500' : 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400'}`}>
                          {zone.private ? 'Private' : 'Public'}
                        </span>
                        <span className="font-mono text-sm font-medium text-gray-900 dark:text-white">{zone.name}</span>
                        <span className="text-xs text-gray-400">{zone.recordCount} records</span>
                      </div>
                      <ChevronRight className={`h-4 w-4 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                    </button>

                    {isOpen && (
                      <div className="border-t border-gray-100 dark:border-white/10">
                        {loadingRecords === zone.id ? (
                          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
                        ) : (
                          <table className="w-full text-xs">
                            <thead><tr className="bg-gray-50 dark:bg-white/5">
                              {['Name', 'Type', 'TTL', 'Value'].map((h) => (
                                <th key={h} className="px-5 py-2 text-left font-bold uppercase tracking-wider text-gray-400">{h}</th>
                              ))}
                            </tr></thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                              {filteredRecords.map((r, i) => (
                                <tr key={i} className="hover:bg-gray-50 dark:hover:bg-white/5">
                                  <td className="px-5 py-2 font-mono text-gray-700 dark:text-gray-300 max-w-xs truncate">{r.name}</td>
                                  <td className="px-5 py-2"><span className={`rounded px-1.5 py-0.5 font-bold font-mono text-xs ${typeColor(r.type)}`}>{r.type}</span></td>
                                  <td className="px-5 py-2 text-gray-400">{r.ttl ?? 'alias'}</td>
                                  <td className="px-5 py-2 font-mono text-gray-600 dark:text-gray-400 max-w-sm truncate">{r.alias ? r.alias.dnsName : r.values.join(', ')}</td>
                                </tr>
                              ))}
                              {filteredRecords.length === 0 && <tr><td colSpan={4} className="px-5 py-4 text-center text-gray-400">No records match.</td></tr>}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
