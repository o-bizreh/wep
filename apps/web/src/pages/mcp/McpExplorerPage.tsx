import { useState, useEffect } from 'react';
import {
  Brain, RefreshCw, CheckCircle2, AlertTriangle, Clock, Play, ChevronDown, ChevronRight, Zap, Search,
} from 'lucide-react';
import { mcpApi, type McpCapabilityMap, type McpTool, type McpToolResult } from '../../lib/api';

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    fresh: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
    live: 'bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400 border-teal-200 dark:border-teal-800',
    partial: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800',
    stale: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${map[status] ?? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700'}`}>
      {status === 'fresh' || status === 'live' ? <CheckCircle2 className="h-2.5 w-2.5" /> : <AlertTriangle className="h-2.5 w-2.5" />}
      {status}
    </span>
  );
}

function fmtAge(min: number): string {
  if (min <= 0) return 'just now';
  if (min < 60) return `${Math.round(min)}m ago`;
  return `${Math.round(min / 60)}h ago`;
}

// ── Live tool runner ────────────────────────────────────────────────────────

function ToolRunner({ tools }: { tools: McpTool[] }) {
  const [selected, setSelected] = useState('');
  const [argsText, setArgsText] = useState('{}');
  const [result, setResult] = useState<McpToolResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState('');

  const run = async () => {
    setRunning(true); setError(null); setResult(null);
    try {
      const args = argsText.trim() ? JSON.parse(argsText) : {};
      const r = await mcpApi.invoke(selected, args);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setRunning(false);
    }
  };

  const filtered = tools.filter((t) => t.name.toLowerCase().includes(filter.toLowerCase()));
  const selectedTool = tools.find((t) => t.name === selected);

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
        <h2 className="text-sm font-black tracking-tight text-zinc-900 dark:text-white flex items-center gap-2">
          <Zap className="h-4 w-4 text-teal-500" /> Live Tool Runner
        </h2>
        <p className="text-xs text-zinc-500 mt-0.5">Invoke any MCP tool as yourself — runs through the WEP proxy with your AWS session.</p>
      </div>
      <div className="p-5 grid md:grid-cols-2 gap-5">
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter tools…"
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
            />
          </div>
          <div className="h-48 overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800">
            {filtered.map((t) => (
              <button
                key={t.name}
                onClick={() => setSelected(t.name)}
                className={`w-full text-left px-3 py-2 text-xs font-mono transition-colors ${selected === t.name ? 'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-400' : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'}`}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          {selectedTool && <p className="text-xs text-zinc-500 leading-relaxed line-clamp-3">{selectedTool.description}</p>}
          <textarea
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
            rows={4}
            placeholder='{ "name": "srv-..." }'
            className="w-full rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-sm font-mono text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-teal-500/30 resize-y"
          />
          <button
            onClick={run}
            disabled={!selected || running}
            className="inline-flex items-center gap-2 rounded-xl bg-teal-600 hover:bg-teal-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-40 transition-colors"
          >
            {running ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run {selected && <span className="font-mono opacity-80">{selected}</span>}
          </button>
        </div>
      </div>
      {(result || error) && (
        <div className="border-t border-zinc-200 dark:border-zinc-800 p-5">
          {error && <p className="text-sm text-red-600 dark:text-red-400 font-medium">{error}</p>}
          {result && (
            <>
              {result.freshness && (
                <p className="text-xs text-zinc-400 mb-2">Source: <span className="font-mono">{result.freshness.source}</span> · as of {new Date(result.freshness.as_of).toLocaleString()}</p>
              )}
              <pre className="overflow-x-auto rounded-xl bg-zinc-950 p-4 text-xs text-zinc-100 max-h-96">{JSON.stringify(result.data, null, 2)}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function McpExplorerPage() {
  const [map, setMap] = useState<McpCapabilityMap | null>(null);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTools, setShowTools] = useState(false);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [m, t] = await Promise.all([mcpApi.capabilityMap(), mcpApi.tools()]);
      setMap(m);
      setTools(t.tools);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reach the MCP');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="min-h-screen bg-white dark:bg-[#0b0c10] text-zinc-900 dark:text-white">
      <div className="mx-auto max-w-7xl px-6 py-10 space-y-8">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-purple-600 shadow-lg shadow-purple-500/20">
              <Brain className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight">Washmen Brain</h1>
              <p className="text-sm text-zinc-500 mt-1">Live intelligence over 92 repos, AWS, databases, Sentry & New Relic — proxied through your session.</p>
            </div>
          </div>
          <button
            onClick={load}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        {error && (
          <div className="rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/40 px-5 py-4 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 flex-none" />
            {error} — confirm your AWS session is connected and the MCP endpoint is reachable.
          </div>
        )}

        {loading && !map && (
          <div className="flex justify-center py-24"><RefreshCw className="h-8 w-8 animate-spin text-zinc-300 dark:text-zinc-600" /></div>
        )}

        {/* Summary */}
        {map && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Domains', value: map.summary.total_domains },
                { label: 'Fresh', value: map.summary.fresh_domains, accent: 'text-emerald-500' },
                { label: 'Partial', value: map.summary.partial_domains, accent: map.summary.partial_domains > 0 ? 'text-amber-500' : undefined },
                { label: 'Stale', value: map.summary.stale_domains, accent: map.summary.stale_domains > 0 ? 'text-red-500' : undefined },
              ].map((c) => (
                <div key={c.label} className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5">
                  <p className="text-xs text-zinc-500 font-medium">{c.label}</p>
                  <p className={`text-2xl font-black tracking-tight mt-0.5 ${c.accent ?? 'text-zinc-900 dark:text-white'}`}>{c.value}</p>
                </div>
              ))}
            </div>

            {map.summary.recommendation && (
              <p className="text-xs text-zinc-400">{map.summary.recommendation}</p>
            )}

            {/* Domain map */}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {map.domains.map((d) => (
                <div key={d.domain} className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-black tracking-tight">{d.domain}</h3>
                    <StatusPill status={d.status} />
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-zinc-400 mb-3">
                    <Clock className="h-3 w-3" /> {fmtAge(d.age_minutes)}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {d.tools.map((t) => (
                      <span key={t} className="rounded-md bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-600 dark:text-zinc-400">{t}</span>
                    ))}
                  </div>
                  {(d.partial_hint || d.stale_hint) && (
                    <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">{d.partial_hint ?? d.stale_hint}</p>
                  )}
                </div>
              ))}
            </div>

            {/* Tool runner */}
            <ToolRunner tools={tools} />

            {/* Full tool list */}
            <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              <button onClick={() => setShowTools((s) => !s)} className="w-full flex items-center justify-between px-5 py-4 text-left">
                <h2 className="text-sm font-black tracking-tight">All Tools <span className="text-zinc-400 font-medium">({tools.length})</span></h2>
                {showTools ? <ChevronDown className="h-4 w-4 text-zinc-400" /> : <ChevronRight className="h-4 w-4 text-zinc-400" />}
              </button>
              {showTools && (
                <div className="border-t border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800 max-h-96 overflow-y-auto">
                  {tools.map((t) => (
                    <div key={t.name} className="px-5 py-3">
                      <p className="text-xs font-mono font-semibold text-teal-600 dark:text-teal-400">{t.name}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">{t.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
