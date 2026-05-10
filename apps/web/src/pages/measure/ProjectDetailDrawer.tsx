import { useEffect, useState } from 'react';
import {
  X, ExternalLink, GitPullRequest, Rocket, Server, AlertTriangle, DollarSign,
  Activity, CheckCircle2, XCircle, Clock, Loader2,
} from 'lucide-react';
import { clsx } from 'clsx';
import {
  projectsApi,
  type ProjectMetrics,
  type ProjectDetail,
  type ProjectRecentRun,
  type ProjectLinkedAwsResource,
} from '../../lib/api';

interface DrawerProps {
  open: boolean;
  project: ProjectMetrics | null;
  onClose: () => void;
}

export function ProjectDetailDrawer({ open, project, onClose }: DrawerProps) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Esc-to-close
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !project) {
      setDetail(null);
      return;
    }
    setLoading(true);
    setError(null);
    setDetail(null);
    projectsApi.detail(project.owner, project.repo)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [open, project]);

  if (!open || !project) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-zinc-900/30 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose} />
      <aside className="fixed top-0 right-0 z-50 h-screen w-full md:w-2/3 lg:w-3/5 bg-white dark:bg-zinc-950 border-l border-slate-200 dark:border-white/10 shadow-2xl shadow-black/20 animate-in slide-in-from-right duration-300 flex flex-col">
        <DrawerHeader project={project} onClose={onClose} />
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-32 rounded-2xl bg-zinc-100 dark:bg-zinc-800/40 animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <div className="p-6">
              <div className="rounded-2xl border border-rose-300 bg-rose-50 dark:bg-rose-950/20 dark:border-rose-500/30 p-5 text-rose-700 dark:text-rose-400 text-sm">
                Failed to load detail: {error}
              </div>
            </div>
          ) : detail ? (
            <div className="p-6 space-y-6">
              <ActivitySection detail={detail} />
              <PipelinesSection detail={detail} />
              <PullRequestsSection detail={detail} />
              <CloudFootprintSection detail={detail} />
              <ProductionErrorsSection detail={detail} />
              <SpendSection detail={detail} />
              <p className="text-[10px] text-zinc-400 text-right pt-2">
                Generated {new Date(detail.generatedAt).toLocaleString()} · cached 5 min
              </p>
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}

function DrawerHeader({ project, onClose }: { project: ProjectMetrics; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between px-6 py-5 border-b border-slate-200 dark:border-white/5">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-white tracking-tight truncate">{project.repo}</h2>
          <a href={project.htmlUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-500 hover:text-cyan-600" title="Open in GitHub">
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-zinc-400">
          {project.language && <span className="font-mono">{project.language}</span>}
          <span>·</span>
          <span>default branch <span className="font-mono">{project.defaultBranch}</span></span>
          {project.linkedServiceCount > 0 && (
            <>
              <span>·</span>
              <span>{project.linkedServiceCount} catalogued service{project.linkedServiceCount === 1 ? '' : 's'}</span>
            </>
          )}
        </div>
      </div>
      <button onClick={onClose} className="shrink-0 p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-400 hover:text-zinc-700 dark:hover:text-white transition-colors" title="Close (Esc)">
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}

function SectionHeader({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-3">
      <span className="text-zinc-500">{icon}</span>
      <h3 className="text-sm font-bold text-zinc-900 dark:text-white tracking-tight">{title}</h3>
      {hint && <span className="text-[10px] text-zinc-400 uppercase tracking-widest">{hint}</span>}
    </div>
  );
}

function StatBox({ label, value, sublabel, accent }: { label: string; value: string | number; sublabel?: string; accent?: 'rose' | 'emerald' | 'amber' }) {
  const accentClasses = accent === 'rose'
    ? 'text-rose-600 dark:text-rose-400'
    : accent === 'emerald'
      ? 'text-emerald-600 dark:text-emerald-400'
      : accent === 'amber'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-zinc-900 dark:text-white';
  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white/40 px-4 py-3 dark:border-white/10 dark:bg-zinc-900/30">
      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">{label}</p>
      <p className={clsx('mt-1 text-xl font-bold', accentClasses)}>{value}</p>
      {sublabel && <p className="text-[10px] text-zinc-400 mt-0.5">{sublabel}</p>}
    </div>
  );
}

// ─── Activity ────────────────────────────────────────────────────────────────

function ActivitySection({ detail }: { detail: ProjectDetail }) {
  const m = detail.metrics;
  return (
    <section>
      <SectionHeader icon={<Activity className="h-4 w-4" />} title="Activity" hint="Last 30 days" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatBox label="Commits" value={m.commits30d} />
        <StatBox label="Merged PRs" value={m.mergedPrs30d} />
        <StatBox label="Contributors" value={m.contributors30d} accent={m.contributors30d <= 1 && m.commits30d > 5 ? 'rose' : undefined} />
        <StatBox label="Last activity" value={m.daysSinceActivity === null ? '—' : m.daysSinceActivity === 0 ? 'today' : `${m.daysSinceActivity}d ago`} accent={m.isStale ? 'rose' : undefined} />
      </div>
      {m.topContributors.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-2">Top contributors · 30d</p>
          <PersonList people={m.topContributors} unit="commit" />
        </div>
      )}
    </section>
  );
}

function PersonList({ people, unit }: { people: { login: string; count: number }[]; unit: string }) {
  const max = Math.max(...people.map((p) => p.count), 1);
  return (
    <ul className="space-y-1.5">
      {people.map((p) => (
        <li key={p.login} className="flex items-center gap-2 text-xs">
          <span className="font-mono text-zinc-700 dark:text-zinc-300 min-w-0 flex-1 truncate">{p.login}</span>
          <div className="relative flex-1 h-1.5 bg-slate-100 dark:bg-zinc-800 rounded-full overflow-hidden max-w-[160px]">
            <div className="absolute inset-y-0 left-0 bg-cyan-500/60" style={{ width: `${(p.count / max) * 100}%` }} />
          </div>
          <span className="text-zinc-400 tabular-nums w-16 text-right">{p.count} {unit}{p.count === 1 ? '' : 's'}</span>
        </li>
      ))}
    </ul>
  );
}

// ─── Pipelines ───────────────────────────────────────────────────────────────

function ConclusionIcon({ conclusion, status }: { conclusion: string | null; status: string }) {
  if (status === 'in_progress' || status === 'queued') return <Clock className="h-3.5 w-3.5 text-blue-500" />;
  if (conclusion === 'success') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  if (conclusion === 'failure' || conclusion === 'timed_out') return <XCircle className="h-3.5 w-3.5 text-rose-500" />;
  if (conclusion === 'cancelled' || conclusion === 'skipped') return <X className="h-3.5 w-3.5 text-zinc-400" />;
  return <Clock className="h-3.5 w-3.5 text-zinc-400" />;
}

function durationLabel(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 360) / 10}h`;
}

function PipelinesSection({ detail }: { detail: ProjectDetail }) {
  const m = detail.metrics;
  const runs = detail.recentRuns;
  return (
    <section>
      <SectionHeader icon={<Rocket className="h-4 w-4" />} title="Pipelines" hint="Last 30 days" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatBox label="Total deploys" value={m.deploys30d.total} />
        <StatBox label="Production" value={m.deploys30d.production} />
        <StatBox label="Development" value={m.deploys30d.development} />
        <StatBox label="Success rate" value={m.deploySuccessRate30d === null ? '—' : `${m.deploySuccessRate30d}%`} accent={m.deploySuccessRate30d !== null && m.deploySuccessRate30d < 80 ? 'rose' : 'emerald'} />
      </div>
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <TopDeployersBlock label="Top deployers · Production" people={m.topDeployers.production} accent="emerald" />
        <TopDeployersBlock label="Top deployers · Development" people={m.topDeployers.development} accent="amber" />
      </div>
      {m.topDeployers.production.length === 0 && m.topDeployers.development.length === 0 && m.topDeployers.overall.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-2">Top deployers · 30d</p>
          <PersonList people={m.topDeployers.overall} unit="deploy" />
        </div>
      )}
      {runs.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-2">Recent runs</p>
          <div className="rounded-2xl border border-slate-200/60 dark:border-white/10 overflow-hidden">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 dark:bg-zinc-900 text-[10px] uppercase tracking-widest text-zinc-400">
                <tr>
                  <th className="px-3 py-2 text-left">Run</th>
                  <th className="px-3 py-2 text-left">Branch</th>
                  <th className="px-3 py-2 text-left">Env</th>
                  <th className="px-3 py-2 text-left">Actor</th>
                  <th className="px-3 py-2 text-right">Duration</th>
                  <th className="px-3 py-2 text-right">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {runs.slice(0, 12).map((run) => <RecentRunRow key={run.id} run={run} />)}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function RecentRunRow({ run }: { run: ProjectRecentRun }) {
  return (
    <tr className="hover:bg-slate-50 dark:hover:bg-white/5">
      <td className="px-3 py-2">
        <a href={run.htmlUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300 hover:text-cyan-600">
          <ConclusionIcon conclusion={run.conclusion} status={run.status} />
          <span className="font-mono">{run.name}</span>
        </a>
      </td>
      <td className="px-3 py-2 font-mono text-zinc-500">{run.branch ?? '—'}</td>
      <td className="px-3 py-2">
        {run.env === 'production' && <span className="font-bold text-emerald-600 dark:text-emerald-400">PROD</span>}
        {run.env === 'development' && <span className="font-bold text-amber-600 dark:text-amber-400">DEV</span>}
        {run.env === 'unknown' && <span className="text-zinc-400">—</span>}
      </td>
      <td className="px-3 py-2 font-mono text-zinc-500">{run.actor ?? '—'}</td>
      <td className="px-3 py-2 text-right text-zinc-500">{durationLabel(run.durationSeconds)}</td>
      <td className="px-3 py-2 text-right text-zinc-400">{relativeTime(run.startedAt)}</td>
    </tr>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function TopDeployersBlock({ label, people, accent }: { label: string; people: { login: string; count: number }[]; accent: 'emerald' | 'amber' }) {
  const dotColor = accent === 'emerald' ? 'bg-emerald-500' : 'bg-amber-500';
  const labelColor = accent === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400';
  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white/40 px-4 py-3 dark:border-white/10 dark:bg-zinc-900/30">
      <p className={clsx('text-[10px] font-bold uppercase tracking-widest', labelColor)}>{label}</p>
      {people.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-400">no deploys to this environment</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {people.map((p) => (
            <li key={p.login} className="flex items-center gap-2 text-xs">
              <span className={clsx('h-1.5 w-1.5 rounded-full shrink-0', dotColor)} />
              <span className="font-mono text-zinc-700 dark:text-zinc-300 min-w-0 flex-1 truncate">{p.login}</span>
              <span className="text-zinc-400 tabular-nums">{p.count} deploy{p.count === 1 ? '' : 's'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Pull Requests ───────────────────────────────────────────────────────────

function PullRequestsSection({ detail }: { detail: ProjectDetail }) {
  const r = detail.reviewStats;
  return (
    <section>
      <SectionHeader icon={<GitPullRequest className="h-4 w-4" />} title="Pull Requests" hint="Open + review wait" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatBox label="Open" value={detail.openPrs.length} accent={detail.openPrs.length > 10 ? 'amber' : undefined} />
        <StatBox label="Oldest open" value={detail.openPrs[0] ? `${detail.openPrs[0].ageDays}d` : '—'} accent={(detail.openPrs[0]?.ageDays ?? 0) > 14 ? 'rose' : undefined} />
        <StatBox label="Median review wait" value={r.medianTimeToFirstReviewHours === null ? '—' : `${r.medianTimeToFirstReviewHours}h`} sublabel={r.sampleSize > 0 ? `${r.sampleSize} merged PRs` : undefined} />
        <StatBox label="P90 review wait" value={r.p90TimeToFirstReviewHours === null ? '—' : `${r.p90TimeToFirstReviewHours}h`} accent={(r.p90TimeToFirstReviewHours ?? 0) > 24 ? 'rose' : undefined} />
      </div>
      {detail.openPrs.length > 0 && (
        <div className="mt-4 rounded-2xl border border-slate-200/60 dark:border-white/10 overflow-hidden">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 dark:bg-zinc-900 text-[10px] uppercase tracking-widest text-zinc-400">
              <tr>
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">Title</th>
                <th className="px-3 py-2 text-left">Author</th>
                <th className="px-3 py-2 text-right">Age</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {detail.openPrs.slice(0, 15).map((pr) => (
                <tr key={pr.number} className="hover:bg-slate-50 dark:hover:bg-white/5">
                  <td className="px-3 py-2 font-mono text-zinc-500">#{pr.number}</td>
                  <td className="px-3 py-2">
                    <a href={pr.htmlUrl} target="_blank" rel="noopener noreferrer" className="text-zinc-700 dark:text-zinc-300 hover:text-cyan-600 inline-flex items-center gap-1">
                      {pr.draft && <span className="text-[9px] uppercase font-bold text-zinc-400">draft</span>}
                      {pr.title}
                    </a>
                  </td>
                  <td className="px-3 py-2 font-mono text-zinc-500">{pr.author}</td>
                  <td className={clsx('px-3 py-2 text-right', pr.ageDays > 14 ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-zinc-500')}>
                    {pr.ageDays}d
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {r.sampleSize === 0 && (
        <p className="mt-3 text-xs text-zinc-400 italic">No merged PRs in the last 30 days to compute review wait times.</p>
      )}
    </section>
  );
}

// ─── Cloud Footprint ─────────────────────────────────────────────────────────

function CloudFootprintSection({ detail }: { detail: ProjectDetail }) {
  if (detail.linkedServices.length === 0) {
    return (
      <section>
        <SectionHeader icon={<Server className="h-4 w-4" />} title="Cloud Footprint" hint="Catalogued services" />
        <p className="text-xs text-zinc-400 italic">No catalogued services link to this repo. Run a catalog sync, or check the repo's GitHub topics for an owner tag.</p>
      </section>
    );
  }
  return (
    <section>
      <SectionHeader icon={<Server className="h-4 w-4" />} title="Cloud Footprint" hint={`${detail.linkedServices.length} service${detail.linkedServices.length === 1 ? '' : 's'}`} />
      <div className="space-y-3">
        {detail.linkedServices.map((svc) => (
          <div key={svc.serviceId} className="rounded-2xl border border-slate-200/60 dark:border-white/10 p-4 bg-white/40 dark:bg-zinc-900/30">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-bold text-zinc-800 dark:text-zinc-200">{svc.serviceName}</p>
              <div className="flex items-center gap-1">
                {svc.environments.map((env) => (
                  <span key={env} className={clsx(
                    'px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider',
                    env === 'production' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : env === 'staging' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        : 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
                  )}>{env}</span>
                ))}
              </div>
            </div>
            {(['production', 'development'] as const).map((env) => {
              const list = svc.resources[env];
              if (list.length === 0) return null;
              return (
                <div key={env} className="mt-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-1">{env}</p>
                  <ul className="space-y-1">
                    {list.map((res) => <ResourceRow key={`${env}-${res.identifier}`} res={res} />)}
                  </ul>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

function ResourceRow({ res }: { res: ProjectLinkedAwsResource }) {
  return (
    <li className="flex items-center justify-between gap-2 text-xs">
      <span className="inline-flex items-center gap-2 min-w-0">
        <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 font-mono text-[9px] uppercase text-zinc-500 shrink-0">
          {res.resourceType.replace('_', ' ').replace('SERVICE', 'svc')}
        </span>
        <span className="font-mono text-zinc-700 dark:text-zinc-300 truncate">{res.identifier}</span>
      </span>
      <a href={res.consoleUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-cyan-600 dark:text-cyan-400 hover:text-cyan-700 shrink-0">
        Console <ExternalLink className="h-3 w-3" />
      </a>
    </li>
  );
}

// ─── Production Errors ───────────────────────────────────────────────────────

function ProductionErrorsSection({ detail }: { detail: ProjectDetail }) {
  const lambdas = detail.linkedServices
    .flatMap((s) => [...s.resources.production, ...s.resources.development])
    .filter((r) => r.resourceType === 'LAMBDA');
  const withErrors = lambdas.filter((r) => (r.errors24h ?? 0) > 0);
  if (lambdas.length === 0) {
    return (
      <section>
        <SectionHeader icon={<AlertTriangle className="h-4 w-4" />} title="Production Errors" hint="Last 24 hours" />
        <p className="text-xs text-zinc-400 italic">No Lambda resources to monitor for this repo. ECS error metrics aren't tracked yet.</p>
      </section>
    );
  }
  return (
    <section>
      <SectionHeader icon={<AlertTriangle className="h-4 w-4" />} title="Production Errors" hint="Last 24 hours · Lambda" />
      {withErrors.length === 0 ? (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">✓ All linked Lambdas at zero errors over the last 24h.</p>
      ) : (
        <div className="rounded-2xl border border-slate-200/60 dark:border-white/10 overflow-hidden">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 dark:bg-zinc-900 text-[10px] uppercase tracking-widest text-zinc-400">
              <tr>
                <th className="px-3 py-2 text-left">Function</th>
                <th className="px-3 py-2 text-right">Errors</th>
                <th className="px-3 py-2 text-right">Invocations</th>
                <th className="px-3 py-2 text-right">Error rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {withErrors.sort((a, b) => (b.errors24h ?? 0) - (a.errors24h ?? 0)).map((r) => {
                const rate = r.invocations24h && r.invocations24h > 0 && r.errors24h !== null
                  ? Math.round((r.errors24h / r.invocations24h) * 1000) / 10
                  : null;
                return (
                  <tr key={r.identifier} className="hover:bg-slate-50 dark:hover:bg-white/5">
                    <td className="px-3 py-2">
                      <a href={r.consoleUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-zinc-700 dark:text-zinc-300 hover:text-cyan-600">{r.identifier}</a>
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-rose-600 dark:text-rose-400">{r.errors24h?.toLocaleString() ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-zinc-500">{r.invocations24h?.toLocaleString() ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-zinc-500">{rate === null ? '—' : `${rate}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Spend ───────────────────────────────────────────────────────────────────

function SpendSection({ detail }: { detail: ProjectDetail }) {
  const c = detail.cost;
  return (
    <section>
      <SectionHeader icon={<DollarSign className="h-4 w-4" />} title="Spend" hint="Month-to-date" />
      {!c.available ? (
        <div className="rounded-2xl border border-amber-300/50 dark:border-amber-500/30 bg-amber-50/40 dark:bg-amber-950/10 p-4">
          <div className="flex items-start gap-2">
            <Loader2 className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">{c.reason}</p>
          </div>
        </div>
      ) : (
        <>
          <StatBox label={`Total · ${c.currency ?? 'USD'}`} value={c.monthlyTotal !== null ? c.monthlyTotal.toFixed(2) : '—'} />
          {c.byTag.length > 0 && (
            <div className="mt-3 space-y-1">
              {c.byTag.sort((a, b) => b.amount - a.amount).map((t) => (
                <div key={t.tag} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-zinc-700 dark:text-zinc-300">{t.tag}</span>
                  <span className="text-zinc-500">{t.amount.toFixed(2)} {c.currency}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
