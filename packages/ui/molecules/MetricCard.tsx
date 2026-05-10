import { clsx } from 'clsx';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

const classificationConfig = {
  elite:  { border: 'border-purple-500/50', bg: 'bg-purple-500/10', text: 'text-purple-600 dark:text-purple-400', label: 'Elite', shadow: 'shadow-purple-500/10' },
  high:   { border: 'border-cyan-500/50', bg: 'bg-cyan-500/10', text: 'text-cyan-600 dark:text-cyan-400', label: 'High', shadow: 'shadow-cyan-500/10' },
  medium: { border: 'border-amber-500/50',  bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400', label: 'Medium', shadow: 'shadow-amber-500/10' },
  low:    { border: 'border-red-500/50',    bg: 'bg-red-500/10', text: 'text-red-600 dark:text-red-400', label: 'Low', shadow: 'shadow-red-500/10' },
} as const;

interface MetricCardProps {
  metricName: string;
  value: string | number;
  unit?: string;
  classification: 'elite' | 'high' | 'medium' | 'low';
  trend?: 'improving' | 'stable' | 'declining';
  trendLabel?: string;
}

export function MetricCard({
  metricName,
  value,
  unit,
  classification,
  trend,
  trendLabel,
}: MetricCardProps) {
  const cfg = classificationConfig[classification];

  return (
    <div className={clsx('relative overflow-hidden rounded-2xl border bg-white/60 backdrop-blur-xl p-6 shadow-xl transition-all hover:-translate-y-1 hover:shadow-2xl dark:bg-zinc-900/40', cfg.border, cfg.shadow)}>
      <div className={clsx('absolute -right-4 -top-4 h-24 w-24 rounded-full blur-2xl', cfg.bg)} />
      <div className="relative z-10 flex items-start justify-between">
        <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">{metricName}</p>
        <span className={clsx('inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border', cfg.text, cfg.border, cfg.bg)}>{cfg.label}</span>
      </div>
      <div className="relative z-10 mt-2 flex items-baseline gap-2">
        <p className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white tabular-nums">{value}</p>
        {unit && <span className="text-sm font-bold text-zinc-400 dark:text-zinc-500">{unit}</span>}
      </div>
      {trend && (
        <div className={clsx('relative z-10 mt-3 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset', {
          'bg-emerald-50 text-emerald-600 ring-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400': trend === 'improving',
          'bg-zinc-100 text-zinc-500 ring-zinc-500/20 dark:bg-zinc-800 dark:text-zinc-400': trend === 'stable',
          'bg-red-50 text-red-600 ring-red-500/20 dark:bg-red-500/10 dark:text-red-400': trend === 'declining',
        })}>
          {trend === 'improving' && <TrendingUp className="h-3 w-3" />}
          {trend === 'stable' && <Minus className="h-3 w-3" />}
          {trend === 'declining' && <TrendingDown className="h-3 w-3" />}
          {trendLabel && <span className="ml-1">{trendLabel}</span>}
        </div>
      )}
    </div>
  );
}
