import { Link } from 'react-router-dom';
import { EmptyState } from '../molecules/EmptyState.js';

export interface Column<T> {
  key: string;
  header: string;
  render: (item: T) => React.ReactNode;
  sortable?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  emptyMessage?: string;
  getRowHref?: (item: T) => string;
  keyExtractor: (item: T) => string;
}

export function DataTable<T>({
  columns,
  data,
  loading,
  emptyMessage = 'No data found',
  getRowHref,
  keyExtractor,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200/60 bg-white/60 dark:border-white/10 dark:bg-zinc-900/40 backdrop-blur-xl shadow-xl shadow-slate-200/20 dark:shadow-black/40 overflow-hidden">
        <div className="overflow-x-auto relative">
          <table className="min-w-full divide-y divide-slate-100/50 dark:divide-white/5">
            <thead>
              <tr className="bg-slate-50/50 dark:bg-zinc-800/20 border-b border-slate-100 dark:border-white/5">
                {columns.map((col) => (
                  <th key={col.key} className="px-6 py-4 text-left text-[11px] font-bold uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400">
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/50 dark:divide-white/5">
              {Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {columns.map((col) => (
                    <td key={col.key} className="px-6 py-5 whitespace-nowrap"><div className="h-4 w-28 bg-zinc-200 dark:bg-zinc-800 rounded" /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return <EmptyState title={emptyMessage} />;
  }

  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white/60 dark:border-white/10 dark:bg-zinc-900/40 backdrop-blur-xl shadow-xl shadow-slate-200/20 dark:shadow-black/40 overflow-hidden">
      <div className="overflow-x-auto relative">
        <table className="min-w-full divide-y divide-slate-100/50 dark:divide-white/5 whitespace-nowrap">
          <thead>
            <tr className="bg-slate-50/50 dark:bg-zinc-800/20 border-b border-slate-100 dark:border-white/5">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="px-6 py-4 text-left text-[11px] font-bold uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400"
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100/50 dark:divide-white/5">
            {data.map((item) => {
              const href = getRowHref?.(item);
              return (
                <tr
                  key={keyExtractor(item)}
                  className={href ? 'cursor-pointer transition-colors hover:bg-white dark:hover:bg-white/5' : 'hover:bg-white dark:hover:bg-white/5 transition-colors'}
                >
                  {columns.map((col, i) => (
                    <td key={col.key} className="whitespace-nowrap px-6 py-4 text-sm font-medium text-zinc-800 dark:text-zinc-100">
                      {href ? (
                        <Link
                          to={href}
                          className="block"
                          tabIndex={i === 0 ? 0 : -1}
                        >
                          {col.render(item) || <span className="text-zinc-300 dark:text-zinc-700">-</span>}
                        </Link>
                      ) : (
                        col.render(item) || <span className="text-zinc-300 dark:text-zinc-700">-</span>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
