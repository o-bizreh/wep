import { useState, useEffect } from 'react';
import { ExternalLink, Users, AlertTriangle } from 'lucide-react';
import { fetchApi } from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ServiceStub {
  name: string;
  type: string;
  language: string;
  repositoryUrl: string;
}

interface TeamStat {
  teamId: string;
  teamName: string;
  serviceCount: number;
  services: ServiceStub[];
  languages: string[];
  types: string[];
  healthScore?: number;
}

interface OwnershipSummary {
  totalServices: number;
  teamsWithServices: number;
  unownedServices: number;
  sharedServices: number;
  teamBreakdown: TeamStat[];
  unownedList: ServiceStub[];
  largestTeams: TeamStat[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SERVICE_TYPE_COLORS: Record<string, string> = {
  api:       'bg-teal-600 dark:bg-teal-500',
  worker:    'bg-violet-600 dark:bg-violet-500',
  frontend:  'bg-amber-500 dark:bg-amber-400',
  lambda:    'bg-blue-600 dark:bg-blue-500',
  other:     'bg-zinc-500 dark:bg-zinc-400',
};

function serviceTypeColor(type: string): string {
  const key = type.toLowerCase();
  return SERVICE_TYPE_COLORS[key] ?? SERVICE_TYPE_COLORS['other']!;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: 'teal' | 'red' | 'zinc';
}) {
  const valueClass =
    accent === 'teal'
      ? 'text-teal-400'
      : accent === 'red'
      ? 'text-red-400'
      : 'text-zinc-100';

  return (
    <div className="rounded-2xl bg-zinc-900 border border-zinc-800 px-6 py-5">
      <p className="text-xs font-medium uppercase tracking-widest text-zinc-500 mb-1">{label}</p>
      <p className={`text-3xl font-black tracking-tight ${valueClass}`}>{value}</p>
    </div>
  );
}

function ServiceTile({ service }: { service: ServiceStub }) {
  return (
    <div
      title={`${service.name} · ${service.type} · ${service.language}`}
      className={`h-8 w-full rounded-lg ${serviceTypeColor(service.type)} opacity-80 hover:opacity-100 transition-opacity cursor-default`}
    />
  );
}

function TeamCard({
  team,
  onClick,
  isSelected,
}: {
  team: TeamStat;
  onClick: () => void;
  isSelected: boolean;
}) {
  const borderClass = isSelected
    ? 'border-teal-500 ring-2 ring-teal-500/30'
    : 'border-zinc-700 hover:border-zinc-500';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      className={`rounded-2xl bg-zinc-900 border ${borderClass} p-5 cursor-pointer transition-all`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <h3 className="text-sm font-black tracking-tight text-zinc-100 truncate">{team.teamName}</h3>
        <span className="shrink-0 inline-flex items-center rounded-full bg-teal-950 text-teal-300 text-xs font-semibold px-2 py-0.5">
          {team.serviceCount}
        </span>
      </div>

      {/* Language chips */}
      {team.languages.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {team.languages.slice(0, 4).map((lang) => (
            <span
              key={lang}
              className="rounded-md bg-zinc-800 text-zinc-400 text-[10px] font-medium px-1.5 py-0.5"
            >
              {lang}
            </span>
          ))}
          {team.languages.length > 4 && (
            <span className="rounded-md bg-zinc-800 text-zinc-500 text-[10px] font-medium px-1.5 py-0.5">
              +{team.languages.length - 4}
            </span>
          )}
        </div>
      )}

      {/* Service tile grid */}
      <div className="grid grid-cols-4 gap-1">
        {team.services.slice(0, 12).map((svc) => (
          <ServiceTile key={svc.name} service={svc} />
        ))}
        {team.services.length > 12 && (
          <div className="h-8 col-span-4 rounded-lg bg-zinc-800 flex items-center justify-center">
            <span className="text-[10px] text-zinc-500">+{team.services.length - 12} more</span>
          </div>
        )}
      </div>
    </div>
  );
}

function TeamDetailPanel({
  team,
  onClose,
}: {
  team: TeamStat;
  onClose: () => void;
}) {
  return (
    <div className="rounded-2xl bg-zinc-900 border border-teal-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-black tracking-tight text-zinc-100">{team.teamName}</h2>
          <p className="text-xs text-zinc-500 mt-0.5">{team.serviceCount} service{team.serviceCount !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={onClose}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors font-medium"
        >
          Close
        </button>
      </div>

      <div className="space-y-2">
        {team.services.map((svc) => (
          <div
            key={svc.name}
            className="flex items-center gap-3 rounded-xl bg-zinc-800 px-4 py-3"
          >
            <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${serviceTypeColor(svc.type)}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-zinc-200 truncate">{svc.name}</p>
              <p className="text-xs text-zinc-500">
                {svc.type} · {svc.language}
              </p>
            </div>
            {svc.repositoryUrl && (
              <a
                href={svc.repositoryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-zinc-500 hover:text-teal-400 transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function UnownedPanel({ services }: { services: ServiceStub[] }) {
  if (services.length === 0) return null;

  return (
    <section className="mt-10">
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className="h-4 w-4 text-red-400" />
        <h2 className="text-base font-black tracking-tight text-zinc-100">
          Unowned Services
          <span className="ml-2 text-sm font-semibold text-red-400">({services.length})</span>
        </h2>
      </div>
      <div className="space-y-2">
        {services.map((svc) => (
          <div
            key={svc.name}
            className="flex items-center gap-4 rounded-xl bg-zinc-900 border-l-4 border-red-500 px-4 py-3"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-zinc-200 truncate">{svc.name}</p>
              <p className="text-xs text-zinc-500">
                {svc.type} · {svc.language}
              </p>
            </div>
            {svc.repositoryUrl && (
              <a
                href={svc.repositoryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-zinc-500 hover:text-teal-400 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            <button
              disabled
              className="shrink-0 text-xs font-semibold text-red-400 border border-red-600/40 rounded-lg px-3 py-1 opacity-60 cursor-not-allowed"
            >
              Assign Owner
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function TypeLegend() {
  const entries = [
    { label: 'API', color: 'bg-teal-600' },
    { label: 'Worker', color: 'bg-violet-600' },
    { label: 'Frontend', color: 'bg-amber-500' },
    { label: 'Lambda', color: 'bg-blue-600' },
    { label: 'Other', color: 'bg-zinc-500' },
  ];

  return (
    <div className="flex flex-wrap gap-3">
      {entries.map(({ label, color }) => (
        <div key={label} className="flex items-center gap-1.5">
          <div className={`h-2.5 w-2.5 rounded-full ${color}`} />
          <span className="text-xs text-zinc-500">{label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function OwnershipHeatmapPage() {
  const [summary, setSummary] = useState<OwnershipSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchApi<OwnershipSummary>('/ownership/summary')
      .then((data) => {
        setSummary(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load ownership data');
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-zinc-500 text-sm">
        Loading ownership data…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-red-400 text-sm">
        {error}
      </div>
    );
  }

  if (!summary) return null;

  const avgServicesPerTeam =
    summary.teamsWithServices > 0
      ? (summary.totalServices / summary.teamsWithServices).toFixed(1)
      : '0';

  const selectedTeam = selectedTeamId
    ? summary.teamBreakdown.find((t) => t.teamId === selectedTeamId) ?? null
    : null;

  const handleTeamClick = (teamId: string) => {
    setSelectedTeamId((prev) => (prev === teamId ? null : teamId));
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <Users className="h-5 w-5 text-teal-400" />
          <h1 className="text-2xl font-black tracking-tight text-zinc-100">Service Ownership</h1>
        </div>
        <p className="text-sm text-zinc-500 ml-8">
          Which teams own what, and what has no owner.
        </p>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Services" value={summary.totalServices} accent="zinc" />
        <StatCard label="Teams with Services" value={summary.teamsWithServices} accent="teal" />
        <StatCard
          label="Unowned Services"
          value={summary.unownedServices}
          accent={summary.unownedServices > 0 ? 'red' : 'zinc'}
        />
        <StatCard label="Avg per Team" value={avgServicesPerTeam} accent="zinc" />
      </div>

      {/* Type legend */}
      <div className="mb-6">
        <TypeLegend />
      </div>

      {/* Heatmap grid + detail panel */}
      {summary.teamBreakdown.length === 0 ? (
        <div className="flex items-center justify-center h-40 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-500 text-sm">
          No team ownership data found. Register services and assign owners in the catalog.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Team cards */}
          <div className={selectedTeam ? 'lg:col-span-2' : 'lg:col-span-3'}>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {summary.teamBreakdown.map((team) => (
                <TeamCard
                  key={team.teamId}
                  team={team}
                  onClick={() => handleTeamClick(team.teamId)}
                  isSelected={selectedTeamId === team.teamId}
                />
              ))}
            </div>
          </div>

          {/* Detail panel */}
          {selectedTeam && (
            <div className="lg:col-span-1">
              <TeamDetailPanel team={selectedTeam} onClose={() => setSelectedTeamId(null)} />
            </div>
          )}
        </div>
      )}

      {/* Unowned panel */}
      <UnownedPanel services={summary.unownedList} />
    </div>
  );
}
