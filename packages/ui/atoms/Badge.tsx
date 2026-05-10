import { clsx } from 'clsx';
import type { ReactNode } from 'react';

const variantStyles = {
  environment: {
    production: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-sm shadow-emerald-500/10',
    staging: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shadow-sm shadow-amber-500/10',
    development: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20 shadow-sm shadow-orange-500/10',
  },
  status: {
    healthy: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-sm shadow-emerald-500/10',
    degraded: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shadow-sm shadow-amber-500/10',
    unhealthy: 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 shadow-sm shadow-red-500/10',
    unknown: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border border-zinc-500/20',
  },
  dora: {
    elite: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 shadow-sm shadow-purple-500/10',
    high: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 shadow-sm shadow-cyan-500/10',
    medium: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shadow-sm shadow-amber-500/10',
    low: 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 shadow-sm shadow-red-500/10',
  },
  runtime: {
    ecs: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20',
    lambda: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20',
    ec2: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20',
    'step-function': 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20',
    static: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border border-zinc-500/20',
    'npm-package': 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20',
    'cli-tool': 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20',
  },
  deployment: {
    success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-sm shadow-emerald-500/10',
    failure: 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 shadow-sm shadow-red-500/10',
    started: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 shadow-sm shadow-blue-500/10',
    cancelled: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border border-zinc-500/20',
    'rolled-back': 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20 shadow-sm shadow-orange-500/10',
  },
} as const;

type BadgeVariant = keyof typeof variantStyles;

interface BadgeProps {
  variant: BadgeVariant;
  value: string;
  className?: string;
  /** Override the displayed label. Defaults to `value`. */
  children?: ReactNode;
}

export function Badge({ variant, value, className, children }: BadgeProps) {
  const styles = variantStyles[variant] as Record<string, string>;
  const colorClass = styles[value] ?? 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border border-zinc-500/20';

  return (
    <span
      className={clsx(
        'inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
        colorClass,
        className,
      )}
    >
      {children ?? value}
    </span>
  );
}
