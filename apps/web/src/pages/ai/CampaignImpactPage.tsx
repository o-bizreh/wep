import { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Loader2, Server, Zap, CheckCircle2, Circle, Bell, Share2, X, CalendarClock, CheckCircle, RotateCcw, Trash2, Eye } from 'lucide-react';
import { PageHeader } from '@wep/ui';
import { aiApi, campaignRevertApi, portalApi, infraApi } from '../../lib/api';
import { cacheGet, cacheSet } from '../../lib/cache';
import { OutputCard, RunBtn, TextInput, FormCard } from './shared';

const RESOURCE_CACHE_KEY = 'infra-resources-all';

type Phase = 'idle' | 'gathering' | 'preparing' | 'analyzing' | 'done';

const PHASES: { key: Phase; label: string }[] = [
  { key: 'gathering',  label: 'Gathering details'  },
  { key: 'preparing',  label: 'Preparing data'     },
  { key: 'analyzing',  label: 'Analyzing'          },
];

function PhaseIndicator({ phase }: { phase: Phase }) {
  if (phase === 'idle' || phase === 'done') return null;
  return (
    <div className="flex items-center gap-3">
      {PHASES.map(({ key, label }, i) => {
        const active  = phase === key;
        const done    = PHASES.findIndex((p) => p.key === phase) > i;
        return (
          <div key={key} className="flex items-center gap-1.5">
            {done
              ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              : active
                ? <Loader2 className="h-3.5 w-3.5 text-indigo-500 animate-spin shrink-0" />
                : <Circle className="h-3.5 w-3.5 text-gray-300 dark:text-gray-600 shrink-0" />}
            <span className={`text-xs ${active ? 'text-indigo-600 dark:text-indigo-400 font-medium' : done ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`}>
              {label}
            </span>
            {i < PHASES.length - 1 && <span className="text-gray-300 dark:text-gray-600 ml-1">›</span>}
          </div>
        );
      })}
    </div>
  );
}

interface EcsResource { type: 'ecs-service'; name: string; cluster: string }
interface LambdaResource { type: 'lambda'; name: string }
type Resource = EcsResource | LambdaResource;

type ResourceCache = Awaited<ReturnType<typeof infraApi.getResources>>;

function resourceKey(r: Resource): string {
  return r.type === 'ecs-service' ? `ecs:${r.cluster}:${r.name}` : `lambda:${r.name}`;
}

// ---------------------------------------------------------------------------
// Remind Drawer
// ---------------------------------------------------------------------------

interface RemindDrawerProps {
  output: string;
  collectedData: unknown[];
  channels: Set<string>;
  totalUsers: string;
  onClose: () => void;
}

function RemindDrawer({ output, collectedData, channels, totalUsers, onClose }: RemindDrawerProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [campaignName, setCampaignName] = useState(`Campaign ${today}`);
  const [campaignStartDate, setCampaignStartDate] = useState(today);
  const [durationDays, setDurationDays] = useState('7');
  const [notificationWebhook, setNotificationWebhook] = useState('');
  const [notificationChannel, setNotificationChannel] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createdBy, setCreatedBy] = useState('');
  const [createdByEmail, setCreatedByEmail] = useState('');

  const revertDate = (() => {
    if (!campaignStartDate || !durationDays || isNaN(Number(durationDays))) return '';
    const ts = new Date(campaignStartDate).getTime() + Number(durationDays) * 86_400_000;
    return new Date(ts).toISOString().slice(0, 10);
  })();

  useEffect(() => {
    void portalApi.getRole().then((role) => {
      if (role.username) setCreatedBy(role.username);
      if (role.email) setCreatedByEmail(role.email);
    }).catch(() => { /* ignore */ });
  }, []);

  async function handleSubmit() {
    if (!campaignStartDate || !durationDays || !revertDate) return;
    setLoading(true);
    setError(null);
    try {
      const { suggestions } = await aiApi.generateSuggestions({
        name: campaignName,
        campaignStartDate,
        durationDays: Number(durationDays),
        revertDate,
        targetUsers: Number(totalUsers) || 0,
        channels: [...channels],
        resourceSnapshot: collectedData,
      });

      const result = await campaignRevertApi.remind({
        name: campaignName,
        report: output,
        resourceSnapshot: collectedData,
        campaignStartDate,
        durationDays: Number(durationDays),
        revertSuggestions: suggestions,
        createdBy,
        createdByEmail,
        notificationWebhook: notificationWebhook.trim() || undefined,
        notificationChannel: notificationChannel.trim() || undefined,
      });

      setSuccess(`Reminder set for ${result.revertDate}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set reminder');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-[560px] bg-white dark:bg-zinc-900 shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-white/10 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Set Revert Reminder</h2>
            <p className="text-xs text-gray-400 mt-0.5">Snapshot resources and schedule a revert reminder.</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors">
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {success ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <CheckCircle className="h-10 w-10 text-emerald-500" />
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{success}</p>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">Campaign name</label>
                <input type="text" value={campaignName} onChange={(e) => setCampaignName(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-zinc-900 text-sm text-gray-900 dark:text-white placeholder-gray-400 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">Campaign start date</label>
                <input type="date" value={campaignStartDate} onChange={(e) => setCampaignStartDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-zinc-900 text-sm text-gray-900 dark:text-white px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">Duration (days)</label>
                <input type="number" min={1} value={durationDays} onChange={(e) => setDurationDays(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-zinc-900 text-sm text-gray-900 dark:text-white px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              </div>

              {revertDate && (
                <div className="flex items-center gap-2 rounded-lg border border-indigo-300 dark:border-indigo-700 bg-indigo-50/40 dark:bg-indigo-950/10 px-3 py-2 text-sm text-indigo-700 dark:text-indigo-300 font-medium">
                  <CalendarClock className="h-4 w-4 shrink-0" />
                  Revert date: {revertDate}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">Slack webhook URL (optional)</label>
                <input type="text" value={notificationWebhook} onChange={(e) => setNotificationWebhook(e.target.value)}
                  placeholder="https://hooks.slack.com/..."
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-zinc-900 text-sm text-gray-900 dark:text-white placeholder-gray-400 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">Notification channel (optional)</label>
                <input type="text" value={notificationChannel} onChange={(e) => setNotificationChannel(e.target.value)}
                  placeholder="#deployments"
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-zinc-900 text-sm text-gray-900 dark:text-white placeholder-gray-400 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              </div>

              {error && <p className="text-xs text-red-500">{error}</p>}

              <button
                onClick={() => { void handleSubmit(); }}
                disabled={loading || !campaignStartDate || !durationDays}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 transition-colors"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
                {loading ? 'Saving…' : 'Generate & Save Reminder'}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Share Drawer
// ---------------------------------------------------------------------------

interface ShareDrawerProps {
  output: string;
  collectedData: unknown[];
  onClose: () => void;
}

function ShareDrawer({ output, collectedData, onClose }: ShareDrawerProps) {
  const [slackWebhook, setSlackWebhook] = useState('');
  const [targetChannel, setTargetChannel] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharedByName, setSharedByName] = useState('');
  const [sharedByEmail, setSharedByEmail] = useState('');

  useEffect(() => {
    void portalApi.getRole().then((role) => {
      if (role.username) setSharedByName(role.username);
      if (role.email) setSharedByEmail(role.email);
    }).catch(() => { /* ignore */ });
  }, []);

  async function handleShare() {
    if (!slackWebhook.trim() || !targetChannel.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await campaignRevertApi.share({
        report: output,
        resourceData: collectedData,
        sharedByName,
        sharedByEmail,
        targetChannel: targetChannel.trim(),
        slackWebhook: slackWebhook.trim(),
      });
      setSuccess(`Shared to ${targetChannel.trim()}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to share');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-[560px] bg-white dark:bg-zinc-900 shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-white/10 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Share for Approval</h2>
            <p className="text-xs text-gray-400 mt-0.5">Send this analysis to a Slack channel for review.</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors">
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {success ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <CheckCircle className="h-10 w-10 text-emerald-500" />
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{success}</p>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">Slack webhook URL</label>
                <input type="text" value={slackWebhook} onChange={(e) => setSlackWebhook(e.target.value)}
                  placeholder="https://hooks.slack.com/services/..."
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-zinc-900 text-sm text-gray-900 dark:text-white placeholder-gray-400 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">Target channel or user</label>
                <input type="text" value={targetChannel} onChange={(e) => setTargetChannel(e.target.value)}
                  placeholder="#team-backend or @username"
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-zinc-900 text-sm text-gray-900 dark:text-white placeholder-gray-400 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              </div>

              {error && <p className="text-xs text-red-500">{error}</p>}

              <button
                onClick={() => { void handleShare(); }}
                disabled={loading || !slackWebhook.trim() || !targetChannel.trim()}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 transition-colors"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
                {loading ? 'Sending…' : 'Send for Approval'}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function CampaignImpactPage() {
  const DEFAULT_CONTEXT = `Known call chain (request flows in this order):
1. prod-customer-public-api → prod-srv-customer-backend → prod-srv-order-backend
2. prod-facility-ai-public-api → prod-srv-order-backend (independent flow)

Baseline peaks (current production, handles without issues):
- prod-customer-public-api: ~2,000 req/min at peak
- prod-facility-ai-public-api: ~7,000 req/min at peak (this is the heaviest load order-backend currently sees)
- prod-srv-customer-backend and prod-srv-order-backend handle the above without degradation at current task counts

Use these baselines as the 100% reference point. Campaign traffic is a multiplier on top of these baselines.`;

  const [totalUsers, setTotalUsers] = useState<string>('');
  const [context, setContext] = useState<string>(DEFAULT_CONTEXT);
  const [search, setSearch] = useState('');
  const [ecsServices, setEcsServices] = useState<EcsResource[]>([]);
  const [lambdaFunctions, setLambdaFunctions] = useState<LambdaResource[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [channels, setChannels] = useState<Set<string>>(new Set(['whatsapp', 'email', 'push']));
  const [loadingResources, setLoadingResources] = useState(true);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [collectedData, setCollectedData] = useState<unknown[]>([]);
  const [activeDrawer, setActiveDrawer] = useState<'remind' | 'share' | null>(null);

  // Reminders list
  interface Reminder {
    campaignId: string;
    name: string;
    campaignStartDate: string;
    revertDate: string;
    status: 'pending-revert' | 'reverted';
    createdBy: string;
    revertSuggestions: string;
    revertedAt: string | null;
  }
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loadingReminders, setLoadingReminders] = useState(true);
  const [viewingReminder, setViewingReminder] = useState<Reminder | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [revertingId, setRevertingId] = useState<string | null>(null);

  const loadReminders = useCallback(() => {
    setLoadingReminders(true);
    void campaignRevertApi.list()
      .then((res) => setReminders((res.items as Reminder[]).filter((r) => r.campaignId && !r.campaignId.startsWith('approval_'))))
      .catch(() => {})
      .finally(() => setLoadingReminders(false));
  }, []);

  useEffect(() => { loadReminders(); }, [loadReminders]);

  useEffect(() => {
    function isDevResource(name: string, env: string | null | undefined): boolean {
      const e = (env ?? '').toLowerCase();
      const n = name.toLowerCase();
      return e.includes('dev') || n.includes('-dev') || n.startsWith('dev-') || n.includes('_dev');
    }

    const cached = cacheGet<ResourceCache>(RESOURCE_CACHE_KEY);
    if (cached) {
      setEcsServices(cached.ecsServices.filter((s) => !isDevResource(s.name, s.environment)).map((s) => ({ type: 'ecs-service' as const, name: s.name, cluster: s.cluster })));
      setLambdaFunctions(cached.lambdaFunctions.filter((f) => !isDevResource(f.name, f.environment)).map((f) => ({ type: 'lambda' as const, name: f.name })));
      setLoadingResources(false);
      return;
    }
    void infraApi.getResources().then((data) => {
      cacheSet(RESOURCE_CACHE_KEY, data);
      setEcsServices(data.ecsServices.filter((s) => !isDevResource(s.name, s.environment)).map((s) => ({ type: 'ecs-service' as const, name: s.name, cluster: s.cluster })));
      setLambdaFunctions(data.lambdaFunctions.filter((f) => !isDevResource(f.name, f.environment)).map((f) => ({ type: 'lambda' as const, name: f.name })));
    }).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : 'Failed to load resources');
    }).finally(() => setLoadingResources(false));
  }, []);

  function toggle(r: Resource) {
    const key = resourceKey(r);
    setSelected((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  const q = search.toLowerCase();
  const filteredEcs = ecsServices.filter((s) => s.name.toLowerCase().includes(q) || s.cluster.toLowerCase().includes(q));
  const filteredLambda = lambdaFunctions.filter((f) => f.name.toLowerCase().includes(q));
  const allResources: Resource[] = [...ecsServices, ...lambdaFunctions];
  const selectedResources = allResources.filter((r) => selected.has(resourceKey(r)));
  const canRun = selectedResources.length > 0 && Number(totalUsers) > 0 && phase === 'idle';

  async function run() {
    setError(null);
    setOutput(null);
    setCollectedData([]);

    setPhase('gathering');
    await new Promise((r) => setTimeout(r, 0));

    try {
      const payload = selectedResources.map((r) =>
        r.type === 'ecs-service' ? { type: r.type, name: r.name, cluster: r.cluster } : { type: r.type, name: r.name },
      );

      setPhase('preparing');
      const apiPromise = aiApi.campaignImpact(Number(totalUsers), payload, [...channels], context.trim() || undefined);
      await new Promise((r) => setTimeout(r, 600));
      setPhase('analyzing');

      const result = await apiPromise;
      setOutput(result.report);
      setCollectedData(result.data ?? []);
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
      setPhase('idle');
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Campaign Impact Analyzer" />
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Select ECS services and Lambda functions, enter your expected user load, and get an AI-powered readiness report with specific recommendations.
      </p>

      <FormCard>
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">Target users</label>
          <input type="number" min={1} value={totalUsers} onChange={(e) => setTotalUsers(e.target.value)}
            placeholder="e.g. 50000"
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-zinc-900 text-sm text-gray-900 dark:text-white placeholder-gray-400 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">Campaign channels</label>
          <div className="flex flex-wrap gap-3">
            {[
              { id: 'whatsapp', label: 'WhatsApp' },
              { id: 'email',    label: 'Email'     },
              { id: 'push',     label: 'Push Notifications' },
            ].map(({ id, label }) => {
              const checked = channels.has(id);
              return (
                <label key={id} className={`flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer border transition-colors text-sm ${checked ? 'bg-indigo-50 dark:bg-indigo-950/30 border-indigo-400 text-indigo-700 dark:text-indigo-300' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-zinc-800'}`}>
                  <input type="checkbox" checked={checked} onChange={() => setChannels((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; })} className="h-4 w-4 rounded accent-indigo-600" />
                  {label}
                </label>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">System context & baselines</label>
          <p className="text-xs text-gray-400">Describe known call chains, baseline traffic, and anything the AI should treat as ground truth.</p>
          <textarea
            rows={7}
            value={context}
            onChange={(e) => setContext(e.target.value)}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-zinc-900 text-sm text-gray-900 dark:text-white placeholder-gray-400 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono resize-y"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">Select resources</label>
          <TextInput value={search} onChange={setSearch} placeholder="Search by name or cluster…" />
        </div>

        {loadingResources ? (
          <div className="flex items-center gap-2 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading resources…</div>
        ) : (
          <div className="max-h-56 overflow-y-auto space-y-1 pr-1 border border-gray-100 dark:border-gray-800 rounded-lg p-2">
            {filteredEcs.length === 0 && filteredLambda.length === 0 ? (
              <p className="text-sm text-gray-400 p-2">No resources match your search.</p>
            ) : (
              [...filteredEcs, ...filteredLambda].map((r) => {
                const key = resourceKey(r);
                const isChecked = selected.has(key);
                return (
                  <label key={key} className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 cursor-pointer transition-colors ${isChecked ? 'bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-400' : 'hover:bg-gray-50 dark:hover:bg-zinc-800 border border-transparent'}`}>
                    <input type="checkbox" checked={isChecked} onChange={() => toggle(r)} className="h-4 w-4 rounded accent-indigo-600 shrink-0" />
                    {r.type === 'ecs-service' ? <Server className="h-4 w-4 text-blue-500 shrink-0" /> : <Zap className="h-4 w-4 text-amber-500 shrink-0" />}
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-gray-900 dark:text-white truncate">{r.name}</span>
                      <span className="block text-xs text-gray-400 truncate">{r.type === 'ecs-service' ? `ECS · ${r.cluster}` : 'Lambda'}</span>
                    </span>
                    <span className={`text-xs rounded-full px-2 py-0.5 font-medium shrink-0 ${r.type === 'ecs-service' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                      {r.type === 'ecs-service' ? 'ECS' : 'Lambda'}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        )}

        {selected.size > 0 && (
          <p className="text-xs text-indigo-600 dark:text-indigo-400">{selected.size} resource{selected.size !== 1 ? 's' : ''} selected</p>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <RunBtn loading={phase !== 'idle' && phase !== 'done'} disabled={!canRun} onClick={() => { void run(); }} label="Analyze Impact" />
          <PhaseIndicator phase={phase} />
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}
      </FormCard>

      {output && phase === 'done' && (
        <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-950/10 px-5 py-4 flex flex-wrap items-center gap-3">
          <span className="text-sm text-indigo-700 dark:text-indigo-300 font-medium flex-1 min-w-0">
            Analysis complete — take action:
          </span>
          <button
            onClick={() => setActiveDrawer(activeDrawer === 'remind' ? null : 'remind')}
            className="inline-flex items-center gap-2 rounded-lg border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-zinc-900 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/20 text-sm font-medium px-3 py-1.5 transition-colors"
          >
            <Bell className="h-4 w-4" /> Remind me to undo
          </button>
          <button
            onClick={() => setActiveDrawer(activeDrawer === 'share' ? null : 'share')}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-zinc-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-zinc-800 text-sm font-medium px-3 py-1.5 transition-colors"
          >
            <Share2 className="h-4 w-4" /> Share for approval
          </button>
        </div>
      )}

      {output && <OutputCard output={output} onClear={() => { setOutput(null); setPhase('idle'); setCollectedData([]); }} />}

      {activeDrawer === 'remind' && output && (
        <RemindDrawer
          output={output}
          collectedData={collectedData}
          channels={channels}
          totalUsers={totalUsers}
          onClose={() => setActiveDrawer(null)}
        />
      )}

      {activeDrawer === 'share' && output && (
        <ShareDrawer
          output={output}
          collectedData={collectedData}
          onClose={() => setActiveDrawer(null)}
        />
      )}

      {/* Revert Reminders */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Revert Reminders</h2>
        {loadingReminders ? (
          <div className="flex items-center gap-2 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading reminders…</div>
        ) : reminders.length === 0 ? (
          <p className="text-sm text-gray-400">No reminders yet. Use "Remind me to undo" after an analysis.</p>
        ) : (
          <div className="space-y-2">
            {reminders.map((r) => (
              <div key={r.campaignId} className="rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-zinc-900 px-4 py-3 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{r.name}</p>
                  <p className="text-xs text-gray-400">
                    Started {r.campaignStartDate} · Revert by {r.revertDate}
                    {r.revertedAt && <> · Reverted {r.revertedAt.slice(0, 10)}</>}
                  </p>
                </div>

                <span className={`text-xs font-medium rounded-full px-2.5 py-0.5 shrink-0 ${r.status === 'reverted' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                  {r.status === 'reverted' ? 'Reverted' : 'Pending Revert'}
                </span>

                <button
                  onClick={() => setViewingReminder(r)}
                  className="inline-flex items-center gap-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-zinc-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-zinc-800 px-2.5 py-1.5 transition-colors shrink-0"
                >
                  <Eye className="h-3.5 w-3.5" /> View Plan
                </button>

                {r.status === 'pending-revert' && (
                  <button
                    onClick={() => {
                      setRevertingId(r.campaignId);
                      void campaignRevertApi.markReverted(r.campaignId)
                        .then(() => loadReminders())
                        .catch(() => {})
                        .finally(() => setRevertingId(null));
                    }}
                    disabled={revertingId === r.campaignId}
                    className="inline-flex items-center gap-1.5 text-xs rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-zinc-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 px-2.5 py-1.5 transition-colors shrink-0 disabled:opacity-50"
                  >
                    {revertingId === r.campaignId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                    Mark Reverted
                  </button>
                )}

                {confirmDeleteId === r.campaignId ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-xs text-gray-500">Delete?</span>
                    <button
                      onClick={() => {
                        void campaignRevertApi.delete(r.campaignId)
                          .then(() => loadReminders())
                          .catch(() => {})
                          .finally(() => setConfirmDeleteId(null));
                      }}
                      className="text-xs text-red-600 hover:underline"
                    >Yes</button>
                    <button onClick={() => setConfirmDeleteId(null)} className="text-xs text-gray-400 hover:underline">No</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(r.campaignId)}
                    className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-500 transition-colors shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* View Plan Drawer */}
      {viewingReminder && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setViewingReminder(null)} />
          <div className="fixed inset-y-0 right-0 z-50 w-[560px] bg-white dark:bg-zinc-900 shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-white/10 shrink-0">
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{viewingReminder.name}</h2>
                <p className="text-xs text-gray-400 mt-0.5">Revert by {viewingReminder.revertDate}</p>
              </div>
              <button onClick={() => setViewingReminder(null)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors">
                <X className="h-4 w-4 text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => <h1 className="text-base font-bold text-gray-900 dark:text-white mt-4 mb-2">{children}</h1>,
                  h2: ({ children }) => <h2 className="text-sm font-bold text-gray-900 dark:text-white mt-3 mb-1">{children}</h2>,
                  h3: ({ children }) => <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mt-2 mb-1">{children}</h3>,
                  p:  ({ children }) => <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed mb-2">{children}</p>,
                  ul: ({ children }) => <ul className="space-y-1 mb-2 pl-1">{children}</ul>,
                  ol: ({ children }) => <ol className="space-y-1 mb-2 pl-1 list-decimal list-inside">{children}</ol>,
                  li: ({ children }) => (
                    <li className="flex gap-2 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                      <span className="text-indigo-400 mt-0.5 shrink-0">•</span>
                      <span>{children}</span>
                    </li>
                  ),
                  strong: ({ children }) => <strong className="font-semibold text-gray-900 dark:text-white">{children}</strong>,
                  code: ({ children, className }) => {
                    const isBlock = className?.includes('language-');
                    return isBlock
                      ? <code className="block bg-gray-100 dark:bg-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-gray-800 dark:text-gray-200 my-2 overflow-x-auto whitespace-pre">{children}</code>
                      : <code className="bg-gray-100 dark:bg-zinc-800 rounded px-1 py-0.5 text-xs font-mono text-gray-800 dark:text-gray-200">{children}</code>;
                  },
                  blockquote: ({ children }) => <blockquote className="border-l-2 border-indigo-300 dark:border-indigo-700 pl-3 my-2 text-sm text-gray-500 dark:text-gray-400 italic">{children}</blockquote>,
                  hr: () => <hr className="border-gray-200 dark:border-white/10 my-3" />,
                  table: ({ children }) => <div className="overflow-x-auto my-2"><table className="w-full text-xs border-collapse">{children}</table></div>,
                  th: ({ children }) => <th className="text-left px-3 py-1.5 bg-gray-50 dark:bg-zinc-800 font-semibold text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-white/10">{children}</th>,
                  td: ({ children }) => <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-white/10">{children}</td>,
                }}
              >
                {viewingReminder.revertSuggestions}
              </ReactMarkdown>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
