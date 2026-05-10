import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { PageHeader, Spinner } from '@wep/ui';
import { ChevronLeft, CheckCircle, XCircle, Clock } from 'lucide-react';
import { fetchApi } from '../../lib/api';

interface ServiceRequest {
  requestId: string;
  operationName: string;
  operationType: string;
  requesterName: string;
  requesterEmail: string | null;
  tier: string;
  status: string;
  submittedAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  failureReason: string | null;
  parameters: Record<string, string>;
}

const statusConfig: Record<string, { label: string; classes: string; icon: React.ReactNode }> = {
  'pending-approval': { label: 'Pending approval', classes: 'bg-amber-50 text-amber-700 ring-amber-600/10', icon: <Clock className="h-3 w-3" /> },
  'approved':  { label: 'Approved',  classes: 'bg-emerald-50 text-emerald-700 ring-emerald-600/10', icon: <CheckCircle className="h-3 w-3" /> },
  'rejected':  { label: 'Rejected',  classes: 'bg-red-50 text-red-700 ring-red-600/10',             icon: <XCircle className="h-3 w-3" /> },
  'completed': { label: 'Completed', classes: 'bg-blue-50 text-blue-700 ring-blue-600/10',           icon: <CheckCircle className="h-3 w-3" /> },
};

export function PortalRequestDetailPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const [request, setRequest] = useState<ServiceRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject]     = useState(false);
  const [actioning, setActioning]       = useState(false);
  const [actionDone, setActionDone]     = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!requestId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetchApi<ServiceRequest>(`/portal/requests/${requestId}`);
      setRequest(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load request');
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const approve = async () => {
    setActioning(true);
    const approverId = localStorage.getItem('wep:slackUsername') ?? 'devops';
    try {
      await fetchApi(`/portal/requests/${requestId}/approve`, { method: 'POST', body: JSON.stringify({ approverId }) });
      setActionDone('approved');
      await fetchData();
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed'); }
    finally { setActioning(false); }
  };

  const reject = async () => {
    if (!rejectReason.trim()) return;
    setActioning(true);
    const approverId = localStorage.getItem('wep:slackUsername') ?? 'devops';
    try {
      await fetchApi(`/portal/requests/${requestId}/reject`, { method: 'POST', body: JSON.stringify({ rejectedBy: approverId, reason: rejectReason }) });
      setActionDone('rejected');
      setShowReject(false);
      await fetchData();
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed'); }
    finally { setActioning(false); }
  };

  return (
    <div>
      <Link to="/portal/requests" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
        <ChevronLeft className="h-4 w-4" /> All Requests
      </Link>

      {loading && <div className="flex justify-center py-16"><Spinner size="lg" /></div>}

      {error && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20">{error}</div>
      )}

      {!loading && request && (() => {
        const sc = statusConfig[request.status] ?? { label: request.status, classes: 'bg-gray-50 text-gray-600 ring-gray-500/10', icon: null };
        const isPending = request.status === 'pending-approval';
        return (
          <div className="mt-6">
            <div className="mb-6 flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{request.operationName}</h1>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Requested by <strong>{request.requesterEmail ?? request.requesterName}</strong>
                  {' · '}{new Date(request.submittedAt).toLocaleString()}
                </p>
              </div>
              <span className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${sc.classes}`}>
                {sc.icon}{sc.label}
              </span>
            </div>

            {actionDone && (
              <div className={`mb-4 rounded-xl border p-4 text-sm font-medium ${actionDone === 'approved' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                Request {actionDone} successfully. Requester has been notified on Slack.
              </div>
            )}

            {/* Parameters */}
            <div className="mb-6 rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <h2 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-200">Request Parameters</h2>
              <dl className="space-y-3">
                {Object.entries(request.parameters).map(([k, v]) => (
                  <div key={k} className="flex gap-4">
                    <dt className="w-40 shrink-0 text-sm font-medium text-gray-500 dark:text-gray-400 capitalize">{k.replace(/([A-Z])/g, ' $1')}</dt>
                    <dd className="text-sm text-gray-900 dark:text-white">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Approve / Deny */}
            {isPending && !actionDone && (
              <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                <h2 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-200">Decision</h2>
                {!showReject ? (
                  <div className="flex gap-3">
                    <button onClick={() => { void approve(); }} disabled={actioning}
                      className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                      {actioning ? 'Processing…' : 'Approve'}
                    </button>
                    <button onClick={() => setShowReject(true)}
                      className="rounded-lg border border-red-200 px-5 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/20">
                      Deny
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Reason for rejection…"
                      rows={3}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-red-400 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    />
                    <div className="flex gap-3">
                      <button onClick={() => { void reject(); }} disabled={!rejectReason.trim() || actioning}
                        className="rounded-lg bg-red-600 px-5 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                        {actioning ? 'Processing…' : 'Confirm Deny'}
                      </button>
                      <button onClick={() => setShowReject(false)}
                        className="text-sm text-gray-500 hover:text-gray-700">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Resolution info */}
            {!isPending && request.approvedBy && (
              <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                <p className="text-sm text-gray-500">
                  {request.status === 'approved' ? 'Approved' : 'Rejected'} by <strong>{request.approvedBy}</strong>
                  {request.approvedAt ? ` · ${new Date(request.approvedAt).toLocaleString()}` : ''}
                </p>
                {request.failureReason && <p className="mt-1 text-sm text-red-600">{request.failureReason}</p>}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
