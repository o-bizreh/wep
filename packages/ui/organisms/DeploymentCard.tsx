import { Badge } from '../atoms/Badge.js';
import { CheckCircle, XCircle, Clock, RotateCcw } from 'lucide-react';

interface DeploymentCardProps {
  serviceName: string;
  environment: string;
  sha: string;
  actor: string;
  status: string;
  timestamp: string;
  repositoryUrl?: string;
  durationSeconds?: number;
  deltaSummary?: string;
  onClick?: () => void;
}

const statusIcons: Record<string, React.ReactNode> = {
  success:      <CheckCircle className="h-5 w-5 text-emerald-500" />,
  failure:      <XCircle     className="h-5 w-5 text-red-500" />,
  started:      <Clock       className="h-5 w-5 text-cyan-500 animate-pulse" />,
  'rolled-back':<RotateCcw   className="h-5 w-5 text-orange-500" />,
};

export function DeploymentCard({
  serviceName,
  environment,
  sha,
  actor,
  status,
  timestamp,
  repositoryUrl,
  durationSeconds,
  deltaSummary,
  onClick,
}: DeploymentCardProps) {
  const shortSha = sha.slice(0, 7);
  const timeAgo = formatTimeAgo(timestamp);

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-slate-200/60 bg-white/60 p-5 shadow-sm backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:shadow-lg dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40"
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="flex-shrink-0">
             {statusIcons[status] ?? statusIcons['started']}
          </div>
          <div>
            <p className="font-bold text-zinc-900 dark:text-white">{serviceName}</p>
            <div className="mt-1 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
              <Badge variant="environment" value={environment} />
              <span className="text-zinc-300 dark:text-zinc-600">·</span>
              <span>
                {repositoryUrl ? (
                  <a
                    href={`${repositoryUrl}/commit/${sha}`}
                    className="font-mono text-[11px] font-bold text-cyan-600 hover:text-cyan-500 hover:underline dark:text-cyan-400"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {shortSha}
                  </a>
                ) : (
                  <span className="font-mono text-[11px] font-bold text-zinc-500">{shortSha}</span>
                )}
              </span>
              <span>by <span className="font-semibold text-zinc-700 dark:text-zinc-300">{actor}</span></span>
              {durationSeconds !== undefined && <span className="text-zinc-400 text-xs">· {durationSeconds}s</span>}
            </div>
          </div>
        </div>
        <span className="shrink-0 text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">{timeAgo}</span>
      </div>
      {deltaSummary && (
        <p className="mt-3 rounded-xl bg-zinc-50/50 px-4 py-2.5 text-sm font-medium text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-300">{deltaSummary}</p>
      )}
    </div>
  );
}

function formatTimeAgo(timestamp: string): string {
  const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
