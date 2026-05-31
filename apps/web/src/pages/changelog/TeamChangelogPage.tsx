import { useState, useEffect, useCallback } from 'react';
import {
  Rocket, Tag, ShieldCheck, PenLine, ChevronLeft, ChevronRight,
  ExternalLink, Trash2, Plus, X, Send, RotateCcw,
} from 'lucide-react';
import { PageHeader } from '@wep/ui';
import {
  changelogApi,
  type ChangelogEntry,
  type ChangelogEntryType,
  type ChangelogEnvironment,
} from '../../lib/api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getMondayOfWeek(date: Date): string {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function addWeeks(isoDate: string, delta: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta * 7);
  return getMondayOfWeek(d);
}

function formatWeekLabel(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

function formatDayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function groupByDay(entries: ChangelogEntry[]): Map<string, ChangelogEntry[]> {
  const groups = new Map<string, ChangelogEntry[]>();
  for (const entry of entries) {
    const day = entry.createdAt.slice(0, 10);
    const existing = groups.get(day);
    if (existing) {
      existing.push(entry);
    } else {
      groups.set(day, [entry]);
    }
  }
  return groups;
}

// ─── Type config ──────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<ChangelogEntryType, { label: string; icon: React.ReactNode; bg: string; text: string }> = {
  deployment:        { label: 'Deployment',        icon: <Rocket className="h-3.5 w-3.5" />,    bg: 'bg-teal-500/20',   text: 'text-teal-400' },
  release:           { label: 'Release',           icon: <Tag className="h-3.5 w-3.5" />,       bg: 'bg-violet-500/20', text: 'text-violet-400' },
  incident_resolved: { label: 'Incident Resolved', icon: <ShieldCheck className="h-3.5 w-3.5" />, bg: 'bg-red-500/20',  text: 'text-red-400' },
  manual:            { label: 'Note',              icon: <PenLine className="h-3.5 w-3.5" />,   bg: 'bg-zinc-500/20',   text: 'text-zinc-400' },
};

const ENV_CONFIG: Record<ChangelogEnvironment, { label: string; classes: string }> = {
  production:  { label: 'prod',    classes: 'bg-red-500/15 text-red-400 ring-1 ring-inset ring-red-500/30' },
  staging:     { label: 'staging', classes: 'bg-amber-500/15 text-amber-400 ring-1 ring-inset ring-amber-500/30' },
  development: { label: 'dev',     classes: 'bg-zinc-500/15 text-zinc-400 ring-1 ring-inset ring-zinc-500/30' },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function TypeIcon({ type }: { type: ChangelogEntryType }) {
  const cfg = TYPE_CONFIG[type];
  return (
    <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${cfg.bg} ${cfg.text}`}>
      {cfg.icon}
    </div>
  );
}

function EntryCard({
  entry,
  onDelete,
}: {
  entry: ChangelogEntry;
  onDelete: (id: string) => void;
}) {
  const typeCfg = TYPE_CONFIG[entry.type];
  const envCfg = entry.environment ? ENV_CONFIG[entry.environment] : null;

  return (
    <div className="flex gap-3 rounded-xl border border-white/8 bg-zinc-900/60 p-4 transition-colors hover:bg-zinc-900/80">
      <TypeIcon type={entry.type} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-xs font-medium ${typeCfg.text}`}>{typeCfg.label}</span>
              {envCfg && (
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${envCfg.classes}`}>
                  {envCfg.label}
                </span>
              )}
            </div>
            <p className="mt-0.5 font-semibold text-white">{entry.title}</p>
            {entry.description && (
              <p className="mt-1 text-sm text-zinc-400">{entry.description}</p>
            )}
          </div>
          <button
            onClick={() => onDelete(entry.id)}
            className="flex-shrink-0 rounded p-1 text-zinc-600 transition-colors hover:bg-red-500/15 hover:text-red-400"
            title="Delete entry"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {entry.serviceNames.map((name) => (
            <span
              key={name}
              className="rounded-md bg-teal-500/10 px-2 py-0.5 text-[11px] font-medium text-teal-400"
            >
              {name}
            </span>
          ))}
          {entry.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-zinc-700/50 px-2 py-0.5 text-[11px] text-zinc-400"
            >
              #{tag}
            </span>
          ))}
        </div>

        <div className="mt-2 flex items-center gap-3 text-xs text-zinc-500">
          {entry.authorName && <span>{entry.authorName}</span>}
          <span>{formatTime(entry.createdAt)} UTC</span>
          {entry.linkedUrl && (
            <a
              href={entry.linkedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-teal-500 hover:text-teal-400"
            >
              <ExternalLink className="h-3 w-3" />
              Link
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Add Entry Modal ──────────────────────────────────────────────────────────

interface AddEntryModalProps {
  teamId: string;
  teamName: string;
  onClose: () => void;
  onSaved: () => void;
}

function AddEntryModal({ teamId, teamName, onClose, onSaved }: AddEntryModalProps) {
  const [type, setType] = useState<ChangelogEntryType>('manual');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [serviceInput, setServiceInput] = useState('');
  const [serviceNames, setServiceNames] = useState<string[]>([]);
  const [environment, setEnvironment] = useState<ChangelogEnvironment | ''>('');
  const [linkedUrl, setLinkedUrl] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const inputClass =
    'w-full rounded-lg border border-white/10 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500';

  function addService() {
    const names = serviceInput.split(',').map((s) => s.trim()).filter(Boolean);
    setServiceNames((prev) => [...new Set([...prev, ...names])]);
    setServiceInput('');
  }

  function addTags() {
    const newTags = tagInput.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
    setTags((prev) => [...new Set([...prev, ...newTags])]);
    setTagInput('');
  }

  async function handleSave() {
    if (!title.trim()) { setError('Title is required'); return; }
    setSaving(true);
    setError('');
    try {
      await changelogApi.createEntry(teamId, {
        teamId,
        teamName,
        type,
        title: title.trim(),
        description: description.trim() || undefined,
        serviceNames,
        environment: environment || undefined,
        linkedUrl: linkedUrl.trim() || undefined,
        tags,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save entry');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-zinc-900 p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-black tracking-tight text-white">Add Entry</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Type */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as ChangelogEntryType)}
              className={inputClass}
            >
              <option value="manual">Note</option>
              <option value="deployment">Deployment</option>
              <option value="release">Release</option>
              <option value="incident_resolved">Incident Resolved</option>
            </select>
          </div>

          {/* Title */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What shipped?"
              className={inputClass}
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Optional details..."
              className={inputClass}
            />
          </div>

          {/* Service names */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Services (comma-separated)</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={serviceInput}
                onChange={(e) => setServiceInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addService(); } }}
                placeholder="api-service, worker..."
                className={inputClass}
              />
              <button
                type="button"
                onClick={addService}
                className="rounded-lg border border-white/10 bg-zinc-800 px-3 text-xs text-zinc-300 hover:bg-zinc-700"
              >
                Add
              </button>
            </div>
            {serviceNames.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {serviceNames.map((name) => (
                  <span
                    key={name}
                    className="flex items-center gap-1 rounded-md bg-teal-500/10 px-2 py-0.5 text-[11px] text-teal-400"
                  >
                    {name}
                    <button
                      type="button"
                      onClick={() => setServiceNames((p) => p.filter((s) => s !== name))}
                      className="opacity-60 hover:opacity-100"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Environment */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Environment</label>
            <select
              value={environment}
              onChange={(e) => setEnvironment(e.target.value as ChangelogEnvironment | '')}
              className={inputClass}
            >
              <option value="">— none —</option>
              <option value="production">Production</option>
              <option value="staging">Staging</option>
              <option value="development">Development</option>
            </select>
          </div>

          {/* Linked URL */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Linked URL (PR, deploy, ticket)</label>
            <input
              type="url"
              value={linkedUrl}
              onChange={(e) => setLinkedUrl(e.target.value)}
              placeholder="https://..."
              className={inputClass}
            />
          </div>

          {/* Tags */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Tags (comma-separated)</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTags(); } }}
                placeholder="hotfix, security..."
                className={inputClass}
              />
              <button
                type="button"
                onClick={addTags}
                className="rounded-lg border border-white/10 bg-zinc-800 px-3 text-xs text-zinc-300 hover:bg-zinc-700"
              >
                Add
              </button>
            </div>
            {tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="flex items-center gap-1 rounded-md bg-zinc-700/50 px-2 py-0.5 text-[11px] text-zinc-400"
                  >
                    #{tag}
                    <button
                      type="button"
                      onClick={() => setTags((p) => p.filter((t) => t !== tag))}
                      className="opacity-60 hover:opacity-100"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !title.trim()}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Entry'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 3000);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-teal-500/30 bg-zinc-900 px-4 py-3 text-sm font-medium text-teal-400 shadow-2xl">
      {message}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function TeamChangelogPage() {
  const [teams, setTeams] = useState<string[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<string>('');
  const [currentWeek, setCurrentWeek] = useState(() => getMondayOfWeek(new Date()));
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [digest, setDigest] = useState<{ publishedToSlack: boolean; publishedAt?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const thisWeek = getMondayOfWeek(new Date());

  // Load teams
  useEffect(() => {
    setTeamsLoading(true);
    changelogApi.listTeams()
      .then((data) => {
        setTeams(data.teams);
        if (data.teams.length > 0 && !selectedTeam) {
          setSelectedTeam(data.teams[0]!);
        }
      })
      .catch(console.error)
      .finally(() => setTeamsLoading(false));
  }, []);

  // Load entries for selected team + week
  const loadEntries = useCallback(() => {
    if (!selectedTeam) return;
    setLoading(true);
    Promise.all([
      changelogApi.listEntries(selectedTeam, currentWeek),
      changelogApi.listWeeks(selectedTeam),
    ])
      .then(([entriesData, weeksData]) => {
        setEntries(entriesData);
        const weekDigest = weeksData.find((w) => w.weekStart === currentWeek);
        setDigest(weekDigest ?? null);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedTeam, currentWeek]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  async function handleDelete(entryId: string) {
    if (!selectedTeam) return;
    await changelogApi.deleteEntry(selectedTeam, entryId).catch(console.error);
    loadEntries();
  }

  async function handlePublish() {
    if (!selectedTeam) return;
    setPublishing(true);
    try {
      const result = await changelogApi.publishWeek(selectedTeam, currentWeek);
      setToast(`Published to ${result.channel}`);
      loadEntries();
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setPublishing(false);
    }
  }

  // Stats for the current week
  const deploymentCount = entries.filter((e) => e.type === 'deployment').length;
  const releaseCount = entries.filter((e) => e.type === 'release').length;
  const incidentCount = entries.filter((e) => e.type === 'incident_resolved').length;
  const manualCount = entries.filter((e) => e.type === 'manual').length;

  // Group entries by day, most recent first
  const sortedEntries = [...entries].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const groupedByDay = groupByDay(sortedEntries);
  const dayKeys = Array.from(groupedByDay.keys()).sort((a, b) => b.localeCompare(a));

  const isPublished = digest?.publishedToSlack ?? false;

  return (
    <div>
      <PageHeader
        title="Team Changelog"
        subtitle="What your team shipped, automatically"
        onRefresh={loadEntries}
        refreshing={loading}
      />

      {/* Header controls */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-zinc-400">Team</label>
          <select
            value={selectedTeam}
            onChange={(e) => setSelectedTeam(e.target.value)}
            disabled={teamsLoading}
            className="rounded-lg border border-white/10 bg-zinc-800 px-3 py-1.5 text-sm text-white focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:opacity-50"
          >
            {teamsLoading && <option>Loading…</option>}
            {!teamsLoading && teams.length === 0 && <option value="">No teams yet</option>}
            {teams.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <button
          onClick={() => setShowModal(true)}
          disabled={!selectedTeam}
          className="flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-40 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Entry
        </button>
      </div>

      {/* Week navigator */}
      <div className="mb-6 flex items-center justify-between rounded-2xl border border-white/8 bg-zinc-900/60 px-5 py-3">
        <button
          onClick={() => setCurrentWeek((w) => addWeeks(w, -1))}
          className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-3">
          <span className="font-black tracking-tight text-white">Week of {formatWeekLabel(currentWeek)}</span>
          {currentWeek !== thisWeek && (
            <button
              onClick={() => setCurrentWeek(thisWeek)}
              className="flex items-center gap-1.5 rounded-lg border border-teal-500/30 px-2.5 py-1 text-xs font-medium text-teal-400 hover:bg-teal-500/10 transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              This Week
            </button>
          )}
        </div>

        <button
          onClick={() => setCurrentWeek((w) => addWeeks(w, 1))}
          className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Stats row */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Deployments',        count: deploymentCount, color: 'text-teal-400' },
          { label: 'Releases',           count: releaseCount,    color: 'text-violet-400' },
          { label: 'Incidents Resolved', count: incidentCount,   color: 'text-red-400' },
          { label: 'Manual Notes',       count: manualCount,     color: 'text-zinc-300' },
        ].map(({ label, count, color }) => (
          <div
            key={label}
            className="rounded-2xl border border-white/8 bg-zinc-900/60 px-4 py-3"
          >
            <p className={`text-2xl font-black tracking-tight ${color}`}>{count}</p>
            <p className="mt-0.5 text-xs text-zinc-500">{label}</p>
          </div>
        ))}
      </div>

      {/* Publish button */}
      {selectedTeam && entries.length > 0 && (
        <div className="mb-6 flex items-center justify-end gap-3">
          {isPublished && digest?.publishedAt && (
            <span className="text-xs text-zinc-500">
              Published {new Date(digest.publishedAt).toLocaleDateString()}
            </span>
          )}
          <button
            onClick={handlePublish}
            disabled={publishing || isPublished}
            className="flex items-center gap-2 rounded-xl border border-teal-500/30 bg-teal-500/10 px-4 py-2 text-sm font-semibold text-teal-400 hover:bg-teal-500/20 disabled:opacity-40 transition-colors"
          >
            <Send className="h-4 w-4" />
            {isPublished ? 'Published to Slack' : publishing ? 'Publishing…' : 'Publish to Slack'}
          </button>
        </div>
      )}

      {/* Timeline feed */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-zinc-800/60" />
          ))}
        </div>
      )}

      {!loading && entries.length === 0 && (
        <div className="rounded-2xl border border-white/8 bg-zinc-900/40 px-8 py-16 text-center">
          <RotateCcw className="mx-auto mb-4 h-10 w-10 text-zinc-700" />
          <p className="font-black tracking-tight text-zinc-300">Nothing shipped yet this week.</p>
          <p className="mt-2 max-w-md mx-auto text-sm text-zinc-500">
            Deployments will appear here automatically once the scanner is connected. You can also add manual entries.
          </p>
          {selectedTeam && (
            <button
              onClick={() => setShowModal(true)}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add Manual Entry
            </button>
          )}
        </div>
      )}

      {!loading && dayKeys.length > 0 && (
        <div className="space-y-8">
          {dayKeys.map((day) => {
            const dayEntries = groupedByDay.get(day) ?? [];
            return (
              <div key={day}>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
                  {formatDayLabel(day)}
                </h3>
                <div className="space-y-2">
                  {dayEntries.map((entry) => (
                    <EntryCard key={entry.id} entry={entry} onDelete={handleDelete} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Entry Modal */}
      {showModal && selectedTeam && (
        <AddEntryModal
          teamId={selectedTeam}
          teamName={selectedTeam}
          onClose={() => setShowModal(false)}
          onSaved={loadEntries}
        />
      )}

      {/* Toast */}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
