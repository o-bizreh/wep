import { useMemo, useState } from 'react';
import { PageHeader } from '@wep/ui';
import { Loader2, AlertCircle, Lightbulb, DollarSign, ChevronDown, ChevronRight, Cloud, Database, Server, BarChart3 } from 'lucide-react';
import { portfolioApi, type PortfolioRecommendation } from '../../lib/api';
import { useCachedQuery, peekQuery } from '../../lib/query-cache';

type ServiceKey = 'lambda' | 'ecs' | 'rds' | 'dynamodb';

const SERVICES: Array<{ key: ServiceKey; label: string; icon: typeof Cloud; description: string }> = [
  { key: 'lambda',   label: 'Lambda',   icon: Cloud,    description: 'Idle and over-memory functions' },
  { key: 'ecs',      label: 'ECS',      icon: Server,   description: 'Underutilized services' },
  { key: 'rds',      label: 'RDS',      icon: Database, description: 'Underutilized DB instances' },
  { key: 'dynamodb', label: 'DynamoDB', icon: BarChart3, description: 'Provisioned tables that should be on-demand' },
];

const SEVERITY_STYLES: Record<string, string> = {
  high: 'bg-red-500/10 text-red-700 dark:text-red-300 ring-red-500/30',
  medium: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/30',
  low: 'bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 ring-zinc-500/30',
};
const TYPE_STYLES: Record<string, string> = {
  rightsize: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  memory: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  'billing-mode': 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
  unused: 'bg-zinc-500/10 text-zinc-700 dark:text-zinc-300',
};

function fmtCurrency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function cacheKey(service: ServiceKey): string {
  return `portfolio:recommendations:${service}`;
}

function ServiceSection({ service, expanded, onToggle }: {
  service: typeof SERVICES[number];
  expanded: boolean;
  onToggle: () => void;
}) {
  // Cache survives unmount; once a section has been opened, the row badge stays
  // populated even after collapse + page navigation.
  const cached = peekQuery<{ recommendations: PortfolioRecommendation[]; generatedAt: string }>(cacheKey(service.key));

  // Lazy: only fires when the section is expanded. Backend caches 15 min.
  const query = useCachedQuery(
    cacheKey(service.key),
    () => portfolioApi.getRecommendations(service.key),
    { staleTimeMs: 10 * 60_000, enabled: expanded },
  );

  const recs = query.data?.recommendations ?? cached?.recommendations ?? null;
  const totalSavings = useMemo(
    () => recs?.reduce((s, r) => s + r.estimatedMonthlySavings, 0) ?? 0,
    [recs],
  );
  const highCount = recs?.filter((r) => r.severity === 'high').length ?? 0;

  const Icon = service.icon;

  return (
    <div className="rounded-2xl border border-zinc-200/60 dark:border-white/10 bg-white/60 dark:bg-zinc-900/40 backdrop-blur-xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40 transition"
      >
        <div className="flex items-center gap-3 min-w-0">
          {expanded
            ? <ChevronDown className="h-4 w-4 flex-none text-zinc-400" />
            : <ChevronRight className="h-4 w-4 flex-none text-zinc-400" />}
          <Icon className="h-5 w-5 flex-none text-cyan-500" />
          <div className="min-w-0">
            <div className="font-semibold text-zinc-900 dark:text-white">{service.label}</div>
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">{service.description}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-none">
          {/* Badges only render when the data is actually cached.
              Pre-scan the row stays clean — no fake "0 recommendations" placeholder. */}
          {recs ? (
            <>
              <span className="rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                {recs.length} found
              </span>
              {highCount > 0 && (
                <span className="rounded-md bg-red-100 dark:bg-red-500/20 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:text-red-300">
                  {highCount} high
                </span>
              )}
              {totalSavings > 0 && (
                <span className="rounded-md bg-emerald-100 dark:bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                  {fmtCurrency(totalSavings)}/mo
                </span>
              )}
            </>
          ) : query.isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin text-cyan-500" />
          ) : (
            <span className="text-[11px] text-zinc-400">click to scan</span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-zinc-200/60 dark:border-white/10 p-4">
          {query.isLoading ? (
            <div className="flex items-center justify-center p-8 gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-cyan-500" />
              <span className="text-sm text-zinc-500">Scanning {service.label}…</span>
            </div>
          ) : query.error ? (
            <div className="rounded-xl border border-red-500/20 bg-red-50 dark:bg-red-500/5 p-3">
              <AlertCircle className="inline h-4 w-4 text-red-500 mr-2" />
              <span className="text-sm text-red-600 dark:text-red-400">
                {query.error instanceof Error ? query.error.message : 'Scan failed'}
              </span>
            </div>
          ) : !recs || recs.length === 0 ? (
            <div className="text-center py-6 text-sm text-zinc-500">
              <Lightbulb className="mx-auto mb-2 h-6 w-6 text-zinc-300" />
              No {service.label} recommendations.
            </div>
          ) : (
            <div className="space-y-2">
              {recs.map((r) => (
                <div key={r.id} className="rounded-xl border border-zinc-200/50 dark:border-white/10 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${SEVERITY_STYLES[r.severity]}`}>
                          {r.severity}
                        </span>
                        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${TYPE_STYLES[r.type] ?? ''}`}>
                          {r.type}
                        </span>
                      </div>
                      <h4 className="font-semibold text-zinc-900 dark:text-white truncate">{r.title}</h4>
                      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{r.description}</p>
                      <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-xs">
                        <span><span className="text-zinc-500">Current: </span><span className="font-mono">{r.currentConfig}</span></span>
                        <span><span className="text-zinc-500">Suggested: </span><span className="font-mono">{r.recommendedConfig}</span></span>
                      </div>
                    </div>
                    {r.estimatedMonthlySavings > 0 && (
                      <div className="flex-none text-right">
                        <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold">
                          <DollarSign className="h-4 w-4" />{fmtCurrency(r.estimatedMonthlySavings)}/mo
                        </div>
                        <p className="text-xs text-zinc-500">{fmtCurrency(r.estimatedAnnualSavings)}/yr</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {query.data?.generatedAt && (
            <p className="mt-3 text-[11px] text-zinc-400">
              Generated {new Date(query.data.generatedAt).toLocaleString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function RecommendationsPage() {
  const [expanded, setExpanded] = useState<Set<ServiceKey>>(new Set());

  const toggle = (key: ServiceKey) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // Read-only summary across whatever is already cached. No fetch.
  const totals = useMemo(() => {
    let count = 0, savings = 0, high = 0;
    for (const s of SERVICES) {
      const cached = peekQuery<{ recommendations: PortfolioRecommendation[] }>(cacheKey(s.key));
      if (!cached) continue;
      count += cached.recommendations.length;
      savings += cached.recommendations.reduce((sum, r) => sum + r.estimatedMonthlySavings, 0);
      high += cached.recommendations.filter((r) => r.severity === 'high').length;
    }
    return { count, savings, high };
  }, [expanded]); // recompute when sections toggle (cache may have just populated)

  const anyScanned = SERVICES.some((s) => !!peekQuery(cacheKey(s.key)));

  return (
    <div className="p-6">
      <PageHeader title="Cost Recommendations" />

      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
        Scans run on demand — click a service to scan it. Each scan caches for 15 minutes.
      </p>

      {anyScanned && (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-zinc-200/60 dark:border-white/10 bg-white/60 dark:bg-zinc-900/40 backdrop-blur-xl p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Recommendations</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{totals.count}</p>
            <p className="text-[11px] text-zinc-400">across scanned services</p>
          </div>
          <div className="rounded-2xl border border-red-500/30 bg-red-50/60 dark:bg-red-500/5 backdrop-blur-xl p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-red-700 dark:text-red-400">High Severity</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-red-700 dark:text-red-400">{totals.high}</p>
          </div>
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-500/5 backdrop-blur-xl p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">Est. Monthly Savings</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{fmtCurrency(totals.savings)}</p>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {SERVICES.map((s) => (
          <ServiceSection
            key={s.key}
            service={s}
            expanded={expanded.has(s.key)}
            onToggle={() => toggle(s.key)}
          />
        ))}
      </div>
    </div>
  );
}
