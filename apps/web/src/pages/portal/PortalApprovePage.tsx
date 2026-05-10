import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { CheckCircle2, XCircle, Loader2, ExternalLink } from 'lucide-react';
import { clsx } from 'clsx';
import { PageHeader } from '@wep/ui';
import { portalApi, type PortalServiceRequest, type PortalApproveResponse } from '../../lib/api';

export function PortalApprovePage() {
  const { requestId = '' } = useParams<{ requestId: string }>();
  const [request, setRequest] = useState<PortalServiceRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [denying, setDenying] = useState(false);
  const [denyReason, setDenyReason] = useState('');
  const [approveNote, setApproveNote] = useState('');
  const [outcome, setOutcome] = useState<{ kind: 'approved' | 'denied'; result?: PortalApproveResponse } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    portalApi.getRequest(requestId)
      .then(setRequest)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [requestId]);

  useEffect(() => { load(); }, [load]);

  const handleApprove = useCallback(async () => {
    if (!request) return;
    setApproving(true);
    setError(null);
    try {
      const res = await portalApi.approve(request.requestId, undefined, approveNote || undefined);
      setOutcome({ kind: 'approved', result: res });
      setRequest(res.request);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApproving(false);
    }
  }, [request, approveNote]);

  const handleDeny = useCallback(async () => {
    if (!request) return;
    if (!denyReason.trim()) {
      setError('Please provide a reason for denial.');
      return;
    }
    setDenying(true);
    setError(null);
    try {
      const res = await portalApi.reject(request.requestId, denyReason.trim());
      setOutcome({ kind: 'denied' });
      setRequest(res.request);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDenying(false);
    }
  }, [request, denyReason]);

  if (loading && !request) {
    return (
      <div className="space-y-4">
        <PageHeader title="Request" />
        <div className="h-64 rounded-2xl bg-zinc-100 dark:bg-zinc-800/40 animate-pulse" />
      </div>
    );
  }
  if (!request) {
    return (
      <div className="space-y-4">
        <PageHeader title="Request not found" />
        <p className="text-sm text-zinc-500">
          {error ?? 'No request found at that ID.'}
        </p>
        <Link to="/portal/requests" className="text-cyan-600 dark:text-cyan-400">← Back to requests</Link>
      </div>
    );
  }

  const isPending = request.status === 'pending-approval';
  const isAuto = request.approvalMode === 'auto';

  return (
    <div className="space-y-6">
      <PageHeader title={request.operationName} actions={<StatusPill status={request.status} />} />

      {outcome && (
        <div className={clsx(
          'rounded-2xl border p-5',
          outcome.kind === 'approved'
            ? 'border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
            : 'border-rose-300 bg-rose-50/60 dark:bg-rose-950/20 dark:border-rose-500/30 text-rose-800 dark:text-rose-300',
        )}>
          <p className="font-bold inline-flex items-center gap-2">
            {outcome.kind === 'approved' ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            {outcome.kind === 'approved' ? 'Approved' : 'Denied'}
          </p>
          {outcome.result?.credentials && (
            <p className="text-xs mt-1">Credentials were sent to the requester via Slack DM. The platform does not store them.</p>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-rose-300 bg-rose-50/60 dark:bg-rose-950/20 dark:border-rose-500/30 p-4 text-sm text-rose-700 dark:text-rose-400">
          {error}
        </div>
      )}

      {/* Summary card */}
      <div className="rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur p-5 dark:border-white/10 dark:bg-zinc-900/40 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <Fact label="Requester">
            <div className="font-mono">{request.requesterName}</div>
            {request.requesterEmail && <div className="text-xs text-zinc-500">{request.requesterEmail}</div>}
            {request.requesterAwsUsername && (
              <div className="text-xs"><span className="text-zinc-400">AWS username: </span><span className="font-mono">{request.requesterAwsUsername}</span></div>
            )}
          </Fact>
          <Fact label="Submitted">{new Date(request.submittedAt).toLocaleString()}</Fact>
          {request.durationMinutes && <Fact label="Requested duration">{request.durationMinutes} min</Fact>}
          {isAuto && (
            <Fact label="Auto-approved">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">✓ rule matched</span>
              <p className="text-xs text-zinc-500 mt-1">{request.autoApprovalRuleDescription}</p>
            </Fact>
          )}
        </div>
      </div>

      {/* Parameters */}
      <div className="rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur p-5 dark:border-white/10 dark:bg-zinc-900/40">
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-3">Parameters</p>
        {Object.keys(request.parameters).length === 0 ? (
          <p className="text-xs text-zinc-400 italic">no parameters</p>
        ) : (
          <table className="min-w-full text-xs">
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {Object.entries(request.parameters).map(([k, v]) => (
                <tr key={k}>
                  <td className="py-2 pr-4 font-mono text-zinc-500 align-top w-1/3">{k}</td>
                  <td className="py-2 font-mono text-zinc-800 dark:text-zinc-200 break-all">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Justification */}
      {Boolean(request.metadata?.['justification']) && (
        <div className="rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur p-5 dark:border-white/10 dark:bg-zinc-900/40">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-2">Justification</p>
          <p className="text-sm text-zinc-700 dark:text-zinc-300 italic">{String(request.metadata?.['justification'] ?? '')}</p>
        </div>
      )}

      {/* Audit timeline */}
      {request.audit && request.audit.length > 0 && (
        <div className="rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur p-5 dark:border-white/10 dark:bg-zinc-900/40">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-3">Audit timeline</p>
          <ol className="space-y-2 text-xs">
            {request.audit.map((e, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="font-mono text-zinc-400 whitespace-nowrap">{new Date(e.at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</span>
                <span className="font-bold text-zinc-700 dark:text-zinc-300">{e.type}</span>
                <span className="text-zinc-500">by</span>
                <span className="font-mono text-zinc-700 dark:text-zinc-300">{e.actor}</span>
                {e.detail && <span className="text-zinc-500">— {e.detail}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Action bar */}
      {isPending && (
        <div className="rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur p-5 dark:border-white/10 dark:bg-zinc-900/40 space-y-4">
          <p className="text-sm text-zinc-700 dark:text-zinc-300 font-semibold">Decide</p>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1">Approval note (optional)</label>
            <input
              type="text"
              value={approveNote}
              onChange={(e) => setApproveNote(e.target.value)}
              placeholder="Optional context for the audit log"
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1">Denial reason (required to deny)</label>
            <textarea
              value={denyReason}
              onChange={(e) => setDenyReason(e.target.value)}
              rows={2}
              placeholder="Why is this request being denied?"
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleApprove}
              disabled={approving || denying}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 text-white text-sm font-bold hover:bg-emerald-600 disabled:opacity-50 transition-colors"
            >
              {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Approve & issue credentials
            </button>
            <button
              onClick={handleDeny}
              disabled={approving || denying || !denyReason.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-500 text-white text-sm font-bold hover:bg-rose-600 disabled:opacity-50 transition-colors"
            >
              {denying ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
              Deny
            </button>
            <p className="text-xs text-zinc-400 self-center">Approving will issue short-lived credentials and DM them to the requester.</p>
          </div>
        </div>
      )}

      <p className="text-[10px] text-zinc-400">
        <Link to="/portal/requests" className="text-cyan-600 dark:text-cyan-400 inline-flex items-center gap-1">
          ← All requests <ExternalLink className="h-3 w-3" />
        </Link>
      </p>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-1">{label}</p>
      <div className="text-sm text-zinc-700 dark:text-zinc-300">{children}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === 'approved' || status === 'completed' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' :
    status === 'pending-approval'                   ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400' :
    status === 'rejected' || status === 'failed'    ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400' :
                                                       'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400';
  return <span className={clsx('px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider', cls)}>{status}</span>;
}
