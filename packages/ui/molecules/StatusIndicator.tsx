import { clsx } from 'clsx';

const statusConfig = {
  healthy:   { dot: 'bg-emerald-500', ring: 'ring-emerald-500/20', pulse: true },
  degraded:  { dot: 'bg-amber-500',   ring: 'ring-amber-500/20',   pulse: false },
  unhealthy: { dot: 'bg-red-500',     ring: 'ring-red-500/20',     pulse: false },
  unknown:   { dot: 'bg-gray-400',    ring: 'ring-gray-400/20',    pulse: false },
  success:   { dot: 'bg-emerald-500', ring: 'ring-emerald-500/20', pulse: false },
  failure:   { dot: 'bg-red-500',     ring: 'ring-red-500/20',     pulse: false },
  started:   { dot: 'bg-blue-500',    ring: 'ring-blue-500/20',    pulse: true  },
  cancelled: { dot: 'bg-gray-400',    ring: 'ring-gray-400/20',    pulse: false },
} as const;

interface StatusIndicatorProps {
  status: string;
  label?: string;
  showLabel?: boolean;
}

export function StatusIndicator({ status, label, showLabel = true }: StatusIndicatorProps) {
  const cfg = statusConfig[status as keyof typeof statusConfig] ?? statusConfig.unknown;
  const displayLabel = label ?? status;

  return (
    <div className="inline-flex items-center gap-2">
      <span className={clsx('relative flex h-2.5 w-2.5')}>
        {cfg.pulse && (
          <span className={clsx('animate-ping absolute inline-flex h-full w-full rounded-full opacity-60', cfg.dot)} />
        )}
        <span className={clsx('relative inline-flex h-2.5 w-2.5 rounded-full', cfg.dot)} />
      </span>
      {showLabel && <span className="text-sm capitalize text-gray-700 dark:text-gray-300">{displayLabel}</span>}
    </div>
  );
}
