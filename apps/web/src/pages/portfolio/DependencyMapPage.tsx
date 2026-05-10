import { useMemo, useState } from 'react';
import { PageHeader } from '@wep/ui';
import { ArrowRight, Boxes, Loader2, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { portfolioApi, type ResourceDependency } from '../../lib/api';
import { useCachedQuery } from '../../lib/query-cache';

type SourceType = 'Lambda' | 'ECS';

const PAGE_SIZE = 20;

const SERVICE_COLORS: Record<string, string> = {
  Lambda:        'bg-orange-500/10 text-orange-700 dark:text-orange-300 ring-orange-500/30',
  ECS:           'bg-blue-500/10 text-blue-700 dark:text-blue-300 ring-blue-500/30',
  RDS:           'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30',
  DynamoDB:      'bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-violet-500/30',
  SQS:           'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 ring-cyan-500/30',
  SNS:           'bg-pink-500/10 text-pink-700 dark:text-pink-300 ring-pink-500/30',
  ElastiCache:   'bg-red-500/10 text-red-700 dark:text-red-300 ring-red-500/30',
  S3:            'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 ring-indigo-500/30',
  Redshift:      'bg-lime-500/10 text-lime-700 dark:text-lime-300 ring-lime-500/30',
  'ELB (Service)': 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/30',
};

function ServiceTag({ service }: { service: string }) {
  const cls = SERVICE_COLORS[service] ?? 'bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 ring-zinc-500/30';
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${cls}`}>
      {service}
    </span>
  );
}

interface Group {
  sourceId: string;
  sourceName: string;
  deps: ResourceDependency[];
}

function DepsCell({ deps }: { deps: ResourceDependency[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? deps : deps.slice(0, 3);
  const hidden = deps.length - 3;

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {visible.map((dep, i) => (
        <span key={i} className="inline-flex items-center gap-1 rounded-lg border border-zinc-200/60 dark:border-white/10 bg-zinc-50 dark:bg-zinc-800/60 px-2 py-0.5 text-xs">
          <ArrowRight className="h-3 w-3 text-zinc-400 flex-none" />
          <ServiceTag service={dep.targetService} />
          <span className="font-medium text-zinc-800 dark:text-zinc-200 truncate max-w-[120px]">{dep.targetName}</span>
        </span>
      ))}
      {!expanded && hidden > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="text-xs font-semibold text-cyan-600 hover:underline dark:text-cyan-400"
        >
          +{hidden} more
        </button>
      )}
      {expanded && deps.length > 3 && (
        <button
          onClick={() => setExpanded(false)}
          className="text-xs font-semibold text-zinc-400 hover:underline"
        >
          Show less
        </button>
      )}
    </div>
  );
}

function Pagination({ page, total, pageSize, onChange }: {
  page: number; total: number; pageSize: number; onChange: (p: number) => void;
}) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between border-t border-zinc-200/60 dark:border-white/10 bg-zinc-50/60 dark:bg-zinc-900/30 px-4 py-3">
      <p className="text-xs text-zinc-500">
        {start}–{end} of {total} services
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(page - 1)}
          disabled={page === 1}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 dark:border-white/10 text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>

        {Array.from({ length: totalPages }, (_, i) => i + 1)
          .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
          .reduce<(number | '...')[]>((acc, p, idx, arr) => {
            if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push('...');
            acc.push(p);
            return acc;
          }, [])
          .map((p, i) =>
            p === '...' ? (
              <span key={`ellipsis-${i}`} className="px-1 text-xs text-zinc-400">…</span>
            ) : (
              <button
                key={p}
                onClick={() => onChange(p as number)}
                className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-semibold transition ${
                  p === page
                    ? 'bg-cyan-500 text-white shadow-sm shadow-cyan-500/30'
                    : 'border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                {p}
              </button>
            ),
          )}

        <button
          onClick={() => onChange(page + 1)}
          disabled={page === totalPages}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 dark:border-white/10 text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function DependencyMapPage() {
  const [sourceType, setSourceType] = useState<SourceType>('Lambda');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const lambdaQuery = useCachedQuery(
    'portfolio:dependencies:lambda',
    () => portfolioApi.getLambdaDependencies(),
    { staleTimeMs: 5 * 60_000, enabled: sourceType === 'Lambda' },
  );
  const ecsQuery = useCachedQuery(
    'portfolio:dependencies:ecs',
    () => portfolioApi.getEcsDependencies(),
    { staleTimeMs: 5 * 60_000, enabled: sourceType === 'ECS' },
  );

  const lambdaData = lambdaQuery.data ?? null;
  const ecsData = ecsQuery.data ?? null;
  const isLoading = sourceType === 'Lambda' ? lambdaQuery.isLoading : ecsQuery.isLoading;
  const isFetching = sourceType === 'Lambda' ? lambdaQuery.isFetching : ecsQuery.isFetching;
  const error = sourceType === 'Lambda' ? lambdaQuery.error : ecsQuery.error;
  const refetch = sourceType === 'Lambda' ? lambdaQuery.refetch : ecsQuery.refetch;

  const groups = useMemo(() => {
    const data = sourceType === 'Lambda' ? lambdaData : ecsData;
    if (!data) return [] as Group[];
    const bySource = new Map<string, Group>();
    for (const dep of data.dependencies) {
      const existing = bySource.get(dep.sourceId) ?? { sourceId: dep.sourceId, sourceName: dep.sourceName, deps: [] };
      existing.deps.push(dep);
      bySource.set(dep.sourceId, existing);
    }
    const list = [...bySource.values()].sort((a, b) => a.sourceName.localeCompare(b.sourceName));
    if (!search) return list;
    const s = search.toLowerCase();
    return list.filter((g) =>
      g.sourceName.toLowerCase().includes(s) ||
      g.deps.some((d) => d.targetName.toLowerCase().includes(s)),
    );
  }, [sourceType, lambdaData, ecsData, search]);

  const totalPages = Math.ceil(groups.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(1, totalPages));
  const pageGroups = groups.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function handleSearch(v: string) {
    setSearch(v);
    setPage(1);
  }

  function handleSourceType(t: SourceType) {
    setSourceType(t);
    setPage(1);
    setSearch('');
  }

  return (
    <div className="p-6">
      <PageHeader title="Dependency Map" onRefresh={refetch} refreshing={isFetching} actions={
        <div className="flex gap-2">
          {(['Lambda', 'ECS'] as SourceType[]).map((t) => (
            <button
              key={t}
              onClick={() => handleSourceType(t)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                sourceType === t
                  ? 'bg-cyan-500 text-white shadow'
                  : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      } />

      <div className="mb-4 flex items-center gap-3">
        <input
          type="text"
          placeholder={`Search ${sourceType} services or dependency targets…`}
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm shadow-sm dark:border-white/10 dark:bg-zinc-900"
        />
        {groups.length > 0 && (
          <p className="text-sm text-zinc-500 whitespace-nowrap">
            {groups.length} service{groups.length !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {!!error && (
        <div className="mb-6 rounded-xl border border-red-500/20 bg-red-50 dark:bg-red-500/5 p-4">
          <AlertCircle className="inline h-4 w-4 text-red-500 mr-2" />
          <span className="text-sm text-red-600 dark:text-red-400">{error instanceof Error ? error.message : 'Failed to load'}</span>
        </div>
      )}

      {isLoading && groups.length === 0 ? (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-6 w-6 animate-spin text-cyan-500" />
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 dark:border-white/10 p-12 text-center">
          <Boxes className="mx-auto h-10 w-10 text-zinc-400" />
          <p className="mt-3 text-sm text-zinc-500">No dependencies detected via env-var scanning.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-zinc-200/60 dark:border-white/10 bg-white/60 dark:bg-zinc-900/40 backdrop-blur-xl shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200/60 dark:border-white/10 bg-zinc-50/80 dark:bg-zinc-900/60">
                <th className="py-3 pl-4 pr-3 text-left text-[11px] font-bold uppercase tracking-widest text-zinc-500 w-[240px]">
                  Service
                </th>
                <th className="px-3 py-3 text-left text-[11px] font-bold uppercase tracking-widest text-zinc-500">
                  Dependencies
                </th>
                <th className="py-3 pl-3 pr-4 text-right text-[11px] font-bold uppercase tracking-widest text-zinc-500 w-[80px]">
                  Count
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200/50 dark:divide-white/5">
              {pageGroups.map((g) => (
                <tr key={g.sourceId} className="hover:bg-zinc-50/60 dark:hover:bg-white/[0.02] transition-colors">
                  <td className="py-3 pl-4 pr-3 align-top">
                    <div className="flex flex-col gap-1">
                      <ServiceTag service={sourceType} />
                      <span className="font-semibold text-zinc-900 dark:text-white text-[13px] leading-tight break-words">
                        {g.sourceName}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <DepsCell deps={g.deps} />
                  </td>
                  <td className="py-3 pl-3 pr-4 text-right align-top">
                    <span className="inline-flex items-center rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-0.5 text-xs font-bold text-zinc-600 dark:text-zinc-400">
                      {g.deps.length}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            page={safePage}
            total={groups.length}
            pageSize={PAGE_SIZE}
            onChange={setPage}
          />
        </div>
      )}
    </div>
  );
}
