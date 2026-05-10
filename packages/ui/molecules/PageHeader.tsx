import { RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  /** Called when the user clicks the refresh button */
  onRefresh?: () => void;
  /** Shows a spinning icon while true */
  refreshing?: boolean;
  /** Optional content rendered to the right of the refresh button */
  actions?: ReactNode;
}

export function PageHeader({ title, onRefresh, refreshing, actions }: PageHeaderProps) {
  return (
    <div className="mb-8 flex items-center justify-between">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{title}</h1>
      <div className="flex items-center gap-3">
        {actions}
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            title="Refresh"
            className={clsx(
              'inline-flex items-center gap-2 rounded-xl border border-zinc-200/50 bg-white/60 backdrop-blur-xl px-4 py-2 text-sm font-bold text-zinc-600 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-md dark:border-white/10 dark:bg-zinc-900/40 dark:text-zinc-400 dark:hover:bg-zinc-800',
              'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0',
            )}
          >
            <RefreshCw className={clsx('h-4 w-4 text-cyan-500', refreshing && 'animate-spin')} />
            Refresh
          </button>
        )}
      </div>
    </div>
  );
}
