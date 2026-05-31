import { useState, useEffect } from 'react';
import { PageHeader } from '@wep/ui';
import {
  GitBranch, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, Clock, Loader2,
} from 'lucide-react';
import { fetchApi } from '../../lib/api';

interface DriftItem {
  field: string;
  stagingValue: string;
  productionValue: string;
}

interface DriftCacheEntry {
  serviceId: string;
  serviceName: string;
  hasDrift: boolean;
  stagingImage: string | null;
  productionImage: string | null;
  driftItems: DriftItem[];
  computedAt: string;
}

interface DriftCacheResponse {
  entries: DriftCacheEntry[];
  computedAt: string | null;
}

function truncateSha(image: string | null): string {
  if (!image) return '—';
  // Extract the SHA digest if present (e.g., image@sha256:abc123...)
  const shaMatch = image.match(/sha256:([0-9a-f]{6,12})/i);
  if (shaMatch) return `sha256:${shaMatch[1]}…`;
  // Fall back to truncating the tag
  const parts = image.split(':');
  const tag = parts[parts.length - 1] ?? image;
  return tag.length > 14 ? `${tag.slice(0, 14)}…` : tag;
}

function timeAgo(isoTimestamp: string): string {
  const diff = Math.floor((Date.now() - new Date(isoTimestamp).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

interface RowProps {
  entry: DriftCacheEntry;
}

function DriftRow({ entry }: RowProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className="border-b border-slate-700/50 hover:bg-slate-800/30 cursor-pointer"
        onClick={() => entry.hasDrift && setExpanded((v) => !v)}
      >
        <td className="px-4 py-3 text-sm font-medium text-slate-100">{entry.serviceName}</td>
        <td className="px-4 py-3 text-xs font-mono text-slate-400">{truncateSha(entry.stagingImage)}</td>
        <td className="px-4 py-3 text-xs font-mono text-slate-400">{truncateSha(entry.productionImage)}</td>
        <td className="px-4 py-3 text-xs text-slate-400">
          {entry.hasDrift ? (
            <span className="text-amber-400">{entry.driftItems.map((d) => d.field).join(', ')}</span>
          ) : (
            <span className="text-slate-500">—</span>
          )}
        </td>
        <td className="px-4 py-3">
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
            entry.hasDrift
              ? 'bg-amber-900/40 text-amber-300 border border-amber-700/50'
              : 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50'
          }`}>
            {entry.hasDrift ? (
              <><AlertTriangle className="h-3 w-3" />Drift</>
            ) : (
              <><CheckCircle2 className="h-3 w-3" />Clean</>
            )}
          </span>
        </td>
        <td className="px-4 py-3 w-8">
          {entry.hasDrift && (
            expanded
              ? <ChevronDown className="h-4 w-4 text-slate-400" />
              : <ChevronRight className="h-4 w-4 text-slate-400" />
          )}
        </td>
      </tr>
      {expanded && entry.hasDrift && (
        <tr className="bg-slate-900/60">
          <td colSpan={6} className="px-4 py-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th className="text-left pb-1.5 font-medium w-32">Field</th>
                  <th className="text-left pb-1.5 font-medium">Staging value</th>
                  <th className="text-left pb-1.5 font-medium">Production value</th>
                </tr>
              </thead>
              <tbody>
                {entry.driftItems.map((item) => (
                  <tr key={item.field} className="border-t border-slate-700/30">
                    <td className="py-1.5 font-mono text-slate-400">{item.field}</td>
                    <td className="py-1.5 font-mono text-blue-400">{item.stagingValue}</td>
                    <td className="py-1.5 font-mono text-purple-400">{item.productionValue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

export function DriftCachePage() {
  const [data, setData] = useState<DriftCacheResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchApi<DriftCacheResponse>('/catalog/drift-cache')
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load drift cache'))
      .finally(() => setLoading(false));
  }, []);

  const totalServices = data?.entries.length ?? 0;
  const driftCount = data?.entries.filter((e) => e.hasDrift).length ?? 0;
  const cleanCount = totalServices - driftCount;

  return (
    <div className="space-y-6">
      <PageHeader title="Drift Cache" />

      {/* Last computed banner */}
      {data?.computedAt && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-800/50 border border-slate-700/50 text-sm text-slate-400">
          <Clock className="h-4 w-4 shrink-0" />
          Last computed: <span className="text-slate-300 font-medium">{timeAgo(data.computedAt)}</span>
          <span className="text-slate-500 text-xs ml-1">({new Date(data.computedAt).toLocaleString()})</span>
          <span className="ml-auto text-xs text-slate-500">Updates nightly at midnight UTC</span>
        </div>
      )}

      {/* Summary cards */}
      {!loading && !error && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-4">
            <div className="text-2xl font-bold text-slate-100">{totalServices}</div>
            <div className="text-sm text-slate-400 mt-0.5">Total services checked</div>
          </div>
          <div className="rounded-xl bg-amber-900/20 border border-amber-700/40 p-4">
            <div className="text-2xl font-bold text-amber-300">{driftCount}</div>
            <div className="text-sm text-amber-400/70 mt-0.5">Services with drift</div>
          </div>
          <div className="rounded-xl bg-emerald-900/20 border border-emerald-700/40 p-4">
            <div className="text-2xl font-bold text-emerald-300">{cleanCount}</div>
            <div className="text-sm text-emerald-400/70 mt-0.5">Clean services</div>
          </div>
        </div>
      )}

      {/* Main table */}
      {loading && (
        <div className="flex items-center justify-center py-24 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading drift cache…
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-700/50 bg-red-900/20 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="rounded-xl border border-slate-700/50 overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-800/60">
              <tr className="text-xs text-slate-400 uppercase tracking-wide">
                <th className="px-4 py-3 text-left font-medium">Service</th>
                <th className="px-4 py-3 text-left font-medium">Staging image</th>
                <th className="px-4 py-3 text-left font-medium">Production image</th>
                <th className="px-4 py-3 text-left font-medium">Drift fields</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 w-8" />
              </tr>
            </thead>
            <tbody>
              {data?.entries.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-500">
                    No drift data available yet. The nightly scanner will populate this cache.
                  </td>
                </tr>
              )}
              {data?.entries.map((entry) => (
                <DriftRow key={entry.serviceId} entry={entry} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
