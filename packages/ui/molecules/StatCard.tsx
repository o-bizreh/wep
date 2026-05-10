import { clsx } from 'clsx';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: 'improving' | 'stable' | 'declining';
  trendLabel?: string;
  className?: string;
}

export function StatCard({ label, value, trend, trendLabel, className }: StatCardProps) {
  return (
    <div className={clsx('relative overflow-hidden rounded-2xl border border-slate-200/60 bg-white/60 p-6 shadow-xl shadow-slate-200/20 backdrop-blur-xl transition-all hover:-translate-y-1 hover:shadow-2xl dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40', className)}>
      <p className="relative z-10 text-[11px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">{label}</p>
      <div className="relative z-10 mt-2 flex items-baseline gap-2">
        <p className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white tabular-nums">{value}</p>
        {trend && (
          <span
            className={clsx('ml-2 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset', {
              'bg-emerald-50 text-emerald-600 ring-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400': trend === 'improving',
              'bg-zinc-100 text-zinc-500 ring-zinc-500/20 dark:bg-zinc-800 dark:text-zinc-400': trend === 'stable',
              'bg-red-50 text-red-600 ring-red-500/20 dark:bg-red-500/10 dark:text-red-400': trend === 'declining',
            })}
          >
            {trend === 'improving' && <TrendingUp className="h-3 w-3" />}
            {trend === 'stable' && <Minus className="h-3 w-3" />}
            {trend === 'declining' && <TrendingDown className="h-3 w-3" />}
            {trendLabel}
          </span>
        )}
      </div>
    </div>
  );
}
