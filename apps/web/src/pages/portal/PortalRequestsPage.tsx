import { useState, useEffect, useCallback } from 'react';
import { PageHeader, Spinner } from '@wep/ui';
import { CheckCircle, XCircle, Clock, CheckCheck, Lock, AlertTriangle, X } from 'lucide-react';
import { fetchApi, portalApi } from '../../lib/api';
import { useDialog } from '../../components/Dialog';

interface ServiceRequest {
  requestId: string;
  operationName: string;
  requesterName: string;
  requesterEmail: string | null;
  tier: string;
  status: string;
  submittedAt: string;
  approvedBy: string | null;
  failureReason: string | null;
  parameters: Record<string, string>;
}

const statusConfig: Record<string, { label: string; classes: string; icon: React.ReactNode }> = {
  'pending-approval': { label: 'Pending approval', classes: 'bg-amber-50 text-amber-700 ring-amber-600/10', icon: <Clock className="h-3 w-3" /> },
  'approved':         { label: 'Approved',         classes: 'bg-emerald-50 text-emerald-700 ring-emerald-600/10', icon: <CheckCircle className="h-3 w-3" /> },
  'rejected':         { label: 'Rejected',         classes: 'bg-red-50 text-red-700 ring-red-600/10', icon: <XCircle className="h-3 w-3" /> },
  'completed':        { label: 'Completed',        classes: 'bg-blue-50 text-blue-700 ring-blue-600/10', icon: <CheckCheck className="h-3 w-3" /> },
  'failed':           { label: 'Failed',           classes: 'bg-red-50 text-red-700 ring-red-600/10', icon: <AlertTriangle className="h-3 w-3" /> },
  'submitted':        { label: 'Submitted',        classes: 'bg-gray-50 text-gray-600 ring-gray-500/10', icon: <Clock className="h-3 w-3" /> },
};

function ErrorModal({ reason, onClose }: { reason: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative mx-4 w-full max-w-lg rounded-2xl border border-red-200 bg-white p-6 shadow-2xl dark:border-red-900 dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0 text-red-500" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Request failed</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        <pre className="overflow-auto rounded-lg bg-red-50 p-4 text-xs text-red-700 whitespace-pre-wrap break-words dark:bg-red-950/20 dark:text-red-400">
          {reason}
        </pre>
        <button
          onClick={onClose}
          className="mt-4 w-full rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          Close
        </button>
      </div>
    </div>
  );
}

export function PortalRequestsPage() {
  const { alert } = useDialog();
  const [requests, setRequests]     = useState<ServiceRequest[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [rejectId, setRejectId]     = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actioning, setActioning]   = useState<string | null>(null);
  const [isDevOps, setIsDevOps]     = useState(false);
  const [errorModal, setErrorModal] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [items, role] = await Promise.all([
        fetchApi<ServiceRequest[]>('/portal/requests/all'),
        portalApi.getRole(),
      ]);
      setRequests(items.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)));
      setIsDevOps(role.role === 'devops');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load requests');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const approve = async (requestId: string) => {
    setActioning(requestId);
    try {
      await fetchApi(`/portal/requests/${requestId}/approve`, { method: 'POST', body: JSON.stringify({}) });
      await fetchData();
    } catch (e) {
      void alert({ title: 'Approve failed', message: e instanceof Error ? e.message : 'Approve failed', variant: 'error' });
    } finally {
      setActioning(null);
    }
  };

  const reject = async (requestId: string) => {
    if (!rejectReason.trim()) return;
    setActioning(requestId);
    try {
      await fetchApi(`/portal/requests/${requestId}/reject`, { method: 'POST', body: JSON.stringify({ reason: rejectReason }) });
      setRejectId(null);
      setRejectReason('');
      await fetchData();
    } catch (e) {
      void alert({ title: 'Reject failed', message: e instanceof Error ? e.message : 'Reject failed', variant: 'error' });
    } finally {
      setActioning(null);
    }
  };

  return (
    <div>
      <PageHeader title="All Requests" onRefresh={fetchData} refreshing={loading} />

      {errorModal && <ErrorModal reason={errorModal} onClose={() => setErrorModal(null)} />}

      {loading && <div className="flex justify-center py-16"><Spinner size="lg" /></div>}

      {error && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-400">{error}</div>
      )}

      {!loading && !error && requests.length === 0 && (
        <div className="mt-10 flex flex-col items-center justify-center py-16 text-center">
          <p className="font-medium text-gray-500 dark:text-gray-400">No requests yet.</p>
        </div>
      )}

      {!loading && requests.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 text-xs text-gray-400 uppercase tracking-wide">
                <th className="px-4 py-3 text-left font-medium">Operation</th>
                <th className="px-4 py-3 text-left font-medium">Requester</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Submitted</th>
                <th className="px-4 py-3 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {requests.map((r) => {
                const sc = statusConfig[r.status] ?? { label: r.status, classes: 'bg-gray-50 text-gray-600 ring-gray-500/10', icon: null };
                const isPending = r.status === 'pending-approval';
                const isFailed  = r.status === 'failed' || (r.status === 'rejected' && r.failureReason);
                const isActioning = actioning === r.requestId;
                return (
                  <>
                    <tr key={r.requestId} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 dark:text-white">{r.operationName}</p>
                        <p className="text-xs text-gray-400">{r.tier}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                        {r.requesterEmail ?? r.requesterName}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${sc.classes}`}>
                            {sc.icon}{sc.label}
                          </span>
                          {isFailed && r.failureReason && (
                            <button
                              onClick={() => setErrorModal(r.failureReason!)}
                              title="View error details"
                              className="rounded-md p-0.5 text-red-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/20"
                            >
                              <AlertTriangle className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">{new Date(r.submittedAt).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        {isPending && isDevOps && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => { void approve(r.requestId); }}
                              disabled={isActioning}
                              className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              {isActioning ? '…' : 'Approve'}
                            </button>
                            <button
                              onClick={() => { setRejectId(r.requestId); setRejectReason(''); }}
                              disabled={isActioning}
                              className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:hover:bg-red-950/20"
                            >
                              Deny
                            </button>
                          </div>
                        )}
                        {isPending && !isDevOps && (
                          <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                            <Lock className="h-3 w-3" /> DevOps only
                          </span>
                        )}
                      </td>
                    </tr>
                    {rejectId === r.requestId && (
                      <tr key={`${r.requestId}-reject`} className="bg-red-50/50 dark:bg-red-950/10">
                        <td colSpan={5} className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <input
                              type="text"
                              value={rejectReason}
                              onChange={(e) => setRejectReason(e.target.value)}
                              placeholder="Reason for rejection…"
                              className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm focus:border-red-400 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                            />
                            <button
                              onClick={() => { void reject(r.requestId); }}
                              disabled={!rejectReason.trim() || actioning === r.requestId}
                              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                            >
                              Confirm Deny
                            </button>
                            <button
                              onClick={() => setRejectId(null)}
                              className="text-xs text-gray-400 hover:text-gray-600"
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
