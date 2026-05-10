import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Loader2, CheckCircle, Bell, CalendarClock } from 'lucide-react';
import { PageHeader } from '@wep/ui';
import { campaignRevertApi, aiApi, portalApi } from '../../lib/api';
import { OutputCard } from './shared';

interface ApprovalData {
  approvalId: string;
  report: string;
  resourceData: string;
  sharedByName: string;
  status: string;
  approvedBy?: string;
  slackWebhook?: string;
}

// ---------------------------------------------------------------------------
// Inline remind form
// ---------------------------------------------------------------------------

interface InlineRemindFormProps {
  report: string;
  resourceData: string;
  approvalId: string;
}

function InlineRemindForm({ report, resourceData, approvalId }: InlineRemindFormProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [campaignName, setCampaignName] = useState(`Approved Campaign (${approvalId.slice(0, 8)})`);
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
      let resourceSnapshot: unknown[] = [];
      try { resourceSnapshot = JSON.parse(resourceData) as unknown[]; } catch { /* ignore */ }

      const { suggestions } = await aiApi.generateSuggestions({
        name: campaignName,
        campaignStartDate,
        durationDays: Number(durationDays),
        revertDate,
        targetUsers: 0,
        channels: [],
        resourceSnapshot,
      });

      const result = await campaignRevertApi.remind({
        name: campaignName,
        report,
        resourceSnapshot,
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

  if (success) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/10">
        <CheckCircle className="h-10 w-10 text-emerald-500" />
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{success}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200/60 dark:border-white/10 bg-white dark:bg-zinc-900/40 p-6 space-y-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Set Revert Reminder</h3>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">Revert date (computed)</label>
          <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${revertDate ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50/40 dark:bg-indigo-950/10 text-indigo-700 dark:text-indigo-300 font-medium' : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-zinc-800 text-gray-400'}`}>
            <CalendarClock className="h-4 w-4 shrink-0" />
            {revertDate || 'Enter start date + duration'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">Slack webhook (optional)</label>
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
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <button
        onClick={() => { void handleSubmit(); }}
        disabled={loading || !campaignStartDate || !durationDays}
        className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 transition-colors"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
        {loading ? 'Saving…' : 'Generate & Save Reminder'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main approval page
// ---------------------------------------------------------------------------

export function CampaignApprovalPage() {
  const { approvalId } = useParams<{ approvalId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const action = searchParams.get('action') as 'approve' | 'remind' | null;

  const [approval, setApproval] = useState<ApprovalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approveSuccess, setApproveSuccess] = useState(false);
  const [currentUser, setCurrentUser] = useState('');

  useEffect(() => {
    void portalApi.getRole().then((role) => {
      if (role.username) setCurrentUser(role.username);
    }).catch(() => { /* ignore */ });
  }, []);

  const loadApproval = useCallback(async () => {
    if (!approvalId) return;
    setLoading(true);
    setFetchError(null);
    try {
      const data = await campaignRevertApi.getApproval(approvalId);
      setApproval(data);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : 'Failed to load approval');
    } finally {
      setLoading(false);
    }
  }, [approvalId]);

  useEffect(() => { void loadApproval(); }, [loadApproval]);

  // Auto-approve if action=approve
  useEffect(() => {
    if (action === 'approve' && approval && approval.status === 'pending' && !approving && !approveSuccess) {
      void handleApprove();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, approval]);

  async function handleApprove() {
    if (!approvalId) return;
    setApproving(true);
    setApproveError(null);
    try {
      await campaignRevertApi.approve(approvalId, currentUser || 'Approver');
      setApproveSuccess(true);
      if (approval) setApproval({ ...approval, status: 'approved', approvedBy: currentUser || 'Approver' });
    } catch (e) {
      setApproveError(e instanceof Error ? e.message : 'Failed to approve');
    } finally {
      setApproving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 gap-3 text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Loading approval…</span>
      </div>
    );
  }

  if (fetchError || !approval) {
    return (
      <div className="space-y-4 p-6">
        <PageHeader title="Campaign Approval" />
        <p className="text-sm text-red-500">{fetchError ?? 'Approval not found.'}</p>
      </div>
    );
  }

  const showRemindForm = action === 'remind' || (approveSuccess && action !== 'approve');

  return (
    <div className="space-y-6">
      <PageHeader title="Campaign Approval" />

      <div className="rounded-xl border border-slate-200/60 dark:border-white/10 bg-white dark:bg-zinc-900/40 px-5 py-4 space-y-1">
        <p className="text-xs text-gray-400">Shared by</p>
        <p className="text-sm font-medium text-gray-900 dark:text-white">{approval.sharedByName}</p>
        {approval.status === 'approved' ? (
          <div className="flex items-center gap-2 mt-2">
            <CheckCircle className="h-4 w-4 text-emerald-500" />
            <span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">
              Approved{approval.approvedBy ? ` by ${approval.approvedBy}` : ''}
            </span>
          </div>
        ) : (
          <span className="inline-block mt-2 text-xs rounded-full px-2 py-0.5 font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            Pending Approval
          </span>
        )}
      </div>

      {action === 'approve' && approving && (
        <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400 py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          Processing approval…
        </div>
      )}

      {approveSuccess && (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/10 px-5 py-4">
          <CheckCircle className="h-5 w-5 text-emerald-500 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Approved! The requester has been notified.</p>
          </div>
          {!showRemindForm && (
            <button
              onClick={() => setSearchParams({ action: 'remind' })}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3 py-1.5 transition-colors"
            >
              <Bell className="h-3.5 w-3.5" /> Add Revert Reminder
            </button>
          )}
        </div>
      )}

      {approveError && <p className="text-sm text-red-500">{approveError}</p>}

      {/* Approve button (only if pending and no action) */}
      {approval.status === 'pending' && !action && (
        <div className="flex gap-3">
          <button
            onClick={() => { void handleApprove(); }}
            disabled={approving}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 transition-colors"
          >
            {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
            {approving ? 'Approving…' : 'Approve Campaign'}
          </button>
        </div>
      )}

      {/* Remind form */}
      {showRemindForm && (
        <InlineRemindForm
          report={approval.report}
          resourceData={approval.resourceData}
          approvalId={approval.approvalId}
        />
      )}

      {/* Show report */}
      <OutputCard output={approval.report} onClear={() => { /* no-op on approval page */ }} />
    </div>
  );
}
