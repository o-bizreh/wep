import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center rounded-2xl border border-slate-200/60 bg-white/60 dark:border-white/10 dark:bg-zinc-900/40 backdrop-blur-xl shadow-xl shadow-slate-200/20 dark:shadow-black/40 overflow-hidden relative">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-cyan-500/5 pointer-events-none" />
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800 shadow-sm z-10">
        <div className="text-zinc-400 dark:text-zinc-500">
          {icon ?? <Inbox className="h-7 w-7" />}
        </div>
      </div>
      <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 z-10">{title}</h3>
      {description && <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 max-w-sm z-10">{description}</p>}
      {action && <div className="mt-6 z-10">{action}</div>}
    </div>
  );
}
