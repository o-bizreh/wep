import { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@wep/ui';
import { AlertTriangle, Flame, CheckCircle2, Loader2, Plus, X, ChevronDown, ChevronRight } from 'lucide-react';
import { fetchApi } from '../../lib/api';

interface IncidentTimelineEvent {
  timestamp: string;
  actor: string;
  message: string;
  status?: string;
}

interface Incident {
  incidentId: string;
  title: string;
  severity: 'P1' | 'P2' | 'P3' | 'P4';
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved';
  linkedServiceName: string | null;
  assignedTeamName: string | null;
  commanderId: string | null;
  startedAt: string;
  resolvedAt: string | null;
  timeline: IncidentTimelineEvent[];
  customerImpact: boolean;
  affectedEnvironments: string[];
}

const SEV_STYLE: Record<string, string> = {
  P1: 'bg-red-100 text-red-700 ring-1 ring-red-600/20 dark:bg-red-950/30 dark:text-red-400',
  P2: 'bg-orange-100 text-orange-700 ring-1 ring-orange-600/20 dark:bg-orange-950/30 dark:text-orange-400',
  P3: 'bg-amber-100 text-amber-700 ring-1 ring-amber-600/20 dark:bg-amber-950/30 dark:text-amber-400',
  P4: 'bg-blue-100 text-blue-700 ring-1 ring-blue-600/20 dark:bg-blue-950/30 dark:text-blue-400',
};

const STATUS_STYLE: Record<string, string> = {
  investigating: 'text-red-600 dark:text-red-400',
  identified: 'text-amber-600 dark:text-amber-400',
  monitoring: 'text-blue-600 dark:text-blue-400',
  resolved: 'text-emerald-600 dark:text-emerald-400',
};

function timeOpen(startedAt: string, resolvedAt: string | null): string {
  const end = resolvedAt ? new Date(resolvedAt) : new Date();
  const ms = end.getTime() - new Date(startedAt).getTime();
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function IncidentRow({ incident, onUpdate }: { incident: Incident; onUpdate: () => void }) {
  const [open, setOpen] = useState(false);
  const [addingEvent, setAddingEvent] = useState(false);
  const [eventMsg, setEventMsg] = useState('');
  const [eventStatus, setEventStatus] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  async function submitEvent() {
    if (!eventMsg.trim()) return;
    setSubmitting(true);
    try {
      await fetchApi(`/on-call/incidents/${incident.incidentId}/timeline`, {
        method: 'POST',
        body: JSON.stringify({ actor: 'me', message: eventMsg, status: eventStatus || undefined }),
      });
      setEventMsg('');
      setEventStatus('');
      setAddingEvent(false);
      onUpdate();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
        {open ? <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />}
        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold ring-1 ring-inset ${SEV_STYLE[incident.severity]}`}>{incident.severity}</span>
        <span className="flex-1 font-medium text-sm text-gray-900 dark:text-white truncate">{incident.title}</span>
        {incident.customerImpact && <span className="text-xs text-red-500 shrink-0">Customer impact</span>}
        <span className={`text-xs font-medium shrink-0 ${STATUS_STYLE[incident.status]}`}>{incident.status}</span>
        <span className="text-xs text-gray-400 shrink-0">{timeOpen(incident.startedAt, incident.resolvedAt)}</span>
        {incident.assignedTeamName && <span className="text-xs text-gray-500 shrink-0">{incident.assignedTeamName}</span>}
      </button>

      {open && (
        <div className="border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 px-4 py-3 space-y-4">
          {/* Meta */}
          <div className="flex flex-wrap gap-4 text-xs text-gray-500">
            {incident.linkedServiceName && <span>Service: <strong>{incident.linkedServiceName}</strong></span>}
            {incident.commanderId && <span>Commander: <strong>{incident.commanderId}</strong></span>}
            {incident.affectedEnvironments.length > 0 && <span>Envs: <strong>{incident.affectedEnvironments.join(', ')}</strong></span>}
            <span>Started: <strong>{new Date(incident.startedAt).toLocaleString()}</strong></span>
            {incident.resolvedAt && <span>Resolved: <strong>{new Date(incident.resolvedAt).toLocaleString()}</strong></span>}
          </div>

          {/* Status transitions */}
          {incident.status !== 'resolved' && (
            <div className="flex gap-2 flex-wrap">
              {(['identified', 'monitoring', 'resolved'] as const)
                .filter(s => s !== incident.status)
                .map(s => (
                  <button key={s} onClick={async () => {
                    await fetchApi(`/on-call/incidents/${incident.incidentId}/timeline`, {
                      method: 'POST',
                      body: JSON.stringify({ actor: 'me', message: `Status changed to ${s}`, status: s }),
                    });
                    onUpdate();
                  }}
                    className="rounded-md border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs font-medium hover:bg-white dark:hover:bg-gray-800 transition-colors capitalize">
                    Mark {s}
                  </button>
                ))}
            </div>
          )}

          {/* Timeline */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Timeline</p>
            {incident.timeline.map((ev, i) => (
              <div key={i} className="flex gap-2 text-xs">
                <span className="text-gray-400 shrink-0 w-32">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                <span className="text-gray-500 shrink-0">{ev.actor}</span>
                <span className="text-gray-700 dark:text-gray-300">{ev.message}</span>
                {ev.status && <span className={`font-medium ${STATUS_STYLE[ev.status] ?? ''}`}>→ {ev.status}</span>}
              </div>
            ))}
          </div>

          {/* Add timeline event */}
          {!addingEvent ? (
            <button onClick={() => setAddingEvent(true)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">+ Add update</button>
          ) : (
            <div className="flex gap-2 items-start">
              <input value={eventMsg} onChange={e => setEventMsg(e.target.value)} placeholder="Update message…"
                className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <select value={eventStatus} onChange={e => setEventStatus(e.target.value)}
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm">
                <option value="">No status change</option>
                <option value="investigating">Investigating</option>
                <option value="identified">Identified</option>
                <option value="monitoring">Monitoring</option>
                <option value="resolved">Resolved</option>
              </select>
              <button onClick={() => { void submitEvent(); }} disabled={submitting}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
                {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Post'}
              </button>
              <button onClick={() => setAddingEvent(false)} className="text-gray-400 hover:text-gray-600 p-1"><X className="h-4 w-4" /></button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface OnCallEntry {
  teamId: string;
  teamName: string;
  primary: string;
  secondary: string | null;
}

export function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [oncall, setOncall] = useState<OnCallEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [showCreate, setShowCreate] = useState(false);

  // Create form state
  const [newTitle, setNewTitle] = useState('');
  const [newSev, setNewSev] = useState<'P1'|'P2'|'P3'|'P4'>('P2');
  const [newService, setNewService] = useState('');
  const [newTeam, setNewTeam] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const [inc, oc] = await Promise.all([
      fetchApi<Incident[]>('/on-call/incidents'),
      fetchApi<{ oncall: OnCallEntry[] }>('/on-call/who').then(r => r.oncall).catch(() => [] as OnCallEntry[]),
    ]);
    setIncidents(inc);
    setOncall(oc);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const displayed = filter === 'active'
    ? incidents.filter(i => i.status !== 'resolved')
    : incidents;

  const activeCount = incidents.filter(i => i.status !== 'resolved').length;
  const p1Count = incidents.filter(i => i.severity === 'P1' && i.status !== 'resolved').length;

  async function createIncident() {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      await fetchApi('/on-call/incidents', {
        method: 'POST',
        body: JSON.stringify({
          title: newTitle, severity: newSev,
          linkedServiceName: newService || null,
          assignedTeamName: newTeam || null,
          customerImpact: newSev === 'P1',
        }),
      });
      setNewTitle(''); setNewSev('P2'); setNewService(''); setNewTeam('');
      setShowCreate(false);
      await load();
    } finally { setCreating(false); }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Incidents"
        actions={
          <button onClick={() => setShowCreate(!showCreate)}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors">
            <Plus className="h-4 w-4" /> Open Incident
          </button>
        }
      />

      {/* Who's on call */}
      {oncall.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {oncall.map(oc => (
            <div key={oc.teamId} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm">
              <span className="text-gray-500 text-xs">On call · {oc.teamName}</span>
              <div className="font-medium">{oc.primary} {oc.secondary && <span className="text-gray-400 text-xs">/ {oc.secondary}</span>}</div>
            </div>
          ))}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {[
          { label: 'Active incidents', value: activeCount, icon: Flame, color: 'text-red-600 dark:text-red-400' },
          { label: 'P1 / Critical', value: p1Count, icon: AlertTriangle, color: 'text-red-600 dark:text-red-400' },
          { label: 'Resolved (total)', value: incidents.filter(i => i.status === 'resolved').length, icon: CheckCircle2, color: 'text-emerald-600 dark:text-emerald-400' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
            <div className="flex items-center gap-2 text-xs text-gray-500 mb-1"><Icon className={`h-4 w-4 ${color}`} />{label}</div>
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Create incident form */}
      {showCreate && (
        <div className="rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/10 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">Open new incident</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Incident title *"
              className="col-span-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
            <select value={newSev} onChange={e => setNewSev(e.target.value as 'P1'|'P2'|'P3'|'P4')}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm">
              <option value="P1">P1 — Critical</option>
              <option value="P2">P2 — Major</option>
              <option value="P3">P3 — Minor</option>
              <option value="P4">P4 — Low</option>
            </select>
            <input value={newService} onChange={e => setNewService(e.target.value)} placeholder="Affected service (optional)"
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <input value={newTeam} onChange={e => setNewTeam(e.target.value)} placeholder="Assigned team (optional)"
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => { void createIncident(); }} disabled={creating || !newTitle.trim()}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60 inline-flex items-center gap-2">
              {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Open Incident
            </button>
            <button onClick={() => setShowCreate(false)} className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2">
        {(['active', 'all'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${filter === f ? 'bg-indigo-600 text-white' : 'border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
            {f === 'active' ? 'Active' : 'All'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
      ) : displayed.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 py-16 text-center text-sm text-gray-500">
          {filter === 'active' ? 'No active incidents' : 'No incidents yet.'}
        </div>
      ) : (
        <div className="space-y-2">
          {displayed.map(i => <IncidentRow key={i.incidentId} incident={i} onUpdate={load} />)}
        </div>
      )}
    </div>
  );
}
