import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, Spinner } from '@wep/ui';
import { ShieldOff, Clock, ChevronLeft, Database, Cloud, ExternalLink } from 'lucide-react';
import { fetchApi } from '../../lib/api';

interface JitSession {
  sessionId: string;
  requestId: string;
  requesterId: string;
  requesterEmail: string | null;
  resourceId: string;
  resourceType: string;
  resourceName: string;
  sessionType: 'db' | 'aws-console';
  dbUsername?: string;
  awsService?: string;
  awsResourceArn?: string;
  awsAction?: string;
  grantedAt: string;
  expiresAt: string;
  status: 'active' | 'expired' | 'revoked';
  revokedAt: string | null;
  revokedBy: string | null;
  /** Joined from the originating ServiceRequest. */
  approvalMode?: 'manual' | 'auto';
  /** Description of the auto-approval rule that fired (only when approvalMode === 'auto'). */
  autoApprovalRuleDescription?: string;
  operationName?: string;
}

function ApprovalBadge({ mode, rule }: { mode?: 'manual' | 'auto'; rule?: string }) {
  if (mode === 'auto') {
    return (
      <span
        title={rule ? `Auto-approved: ${rule}` : 'Auto-approved'}
        className="inline-flex items-center gap-1 rounded-md bg-cyan-50 px-2 py-0.5 text-[11px] font-semibold text-cyan-700 ring-1 ring-inset ring-cyan-600/20 dark:bg-cyan-500/10 dark:text-cyan-300"
      >
        ⚡ Auto
      </span>
    );
  }
  if (mode === 'manual') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300">
        Approved
      </span>
    );
  }
  return null;
}

function Countdown({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    const calc = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) { setRemaining('Expired'); return; }
      const m = Math.floor(diff / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      setRemaining(`${m}m ${s}s`);
    };
    calc();
    const id = setInterval(calc, 1_000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const isLow = new Date(expiresAt).getTime() - Date.now() < 5 * 60_000;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-mono ${isLow ? 'text-red-500' : 'text-amber-600 dark:text-amber-400'}`}>
      <Clock className="h-3 w-3" /> {remaining}
    </span>
  );
}

const statusClasses: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  expired: 'bg-gray-50 text-gray-500 ring-gray-400/20',
  revoked: 'bg-red-50 text-red-700 ring-red-600/20',
};

export function JitSessionsPage() {
  const [sessions, setSessions]   = useState<JitSession[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [revoking, setRevoking]   = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchApi<JitSession[]>('/portal/jit-sessions/mine');
      setSessions(data.sort((a, b) => new Date(b.grantedAt).getTime() - new Date(a.grantedAt).getTime()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Poll every 15 s to reflect scheduler revocations
    pollRef.current = setInterval(() => { void load(); }, 15_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  const handleOpenConsole = async (sessionId: string) => {
    try {
      const data = await fetchApi<{ consoleUrl: string }>(`/portal/jit-sessions/${sessionId}/console-url`);
      window.open(data.consoleUrl, '_blank', 'noopener,noreferrer');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to generate console URL');
    }
  };

  const handleRevoke = async (sessionId: string) => {
    if (!confirm('Revoke this session early? The database user will be dropped immediately.')) return;
    setRevoking(sessionId);
    try {
      await fetchApi(`/portal/jit-sessions/${sessionId}/revoke`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Revocation failed');
    } finally {
      setRevoking(null);
    }
  };

  const active   = sessions.filter((s) => s.status === 'active');
  const inactive = sessions.filter((s) => s.status !== 'active');

  return (
    <div>
      <Link to="/portal" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
        <ChevronLeft className="h-4 w-4" /> Back to Portal
      </Link>

      <div className="mt-4 mb-6">
        <PageHeader title="Active Credentials" />
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Short-lived credentials issued to you — database access, AWS console federation, and aws-action STS tokens. Auto-approved sessions show the rule that fired.</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : sessions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 py-12 text-center dark:border-gray-700">
          <Database className="mx-auto mb-3 h-8 w-8 text-gray-300" />
          <p className="text-sm text-gray-500">No JIT sessions found.</p>
          <Link to="/portal" className="mt-3 inline-block text-sm text-blue-600 hover:underline">Request access</Link>
        </div>
      ) : (
        <div className="space-y-6">
          {active.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Active</h2>
              <div className="space-y-3">
                {active.map((s) => (
                  <div key={s.sessionId} className="flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50/40 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                        {s.sessionType === 'aws-console'
                          ? <Cloud className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                          : <Database className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-gray-900 dark:text-white">{s.resourceName}</p>
                          <ApprovalBadge mode={s.approvalMode} rule={s.autoApprovalRuleDescription} />
                        </div>
                        {s.operationName && (
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">{s.operationName}</p>
                        )}
                        {s.sessionType === 'aws-console' ? (
                          <>
                            <p className="text-xs text-gray-500">
                              <span className="font-mono">{s.awsAction}</span>
                            </p>
                            <p className="mt-0.5 text-xs text-gray-400 font-mono truncate max-w-xs">{s.awsResourceArn}</p>
                          </>
                        ) : (
                          <p className="text-xs text-gray-500">User: <span className="font-mono">{s.dbUsername}</span></p>
                        )}
                        {s.approvalMode === 'auto' && s.autoApprovalRuleDescription && (
                          <p className="mt-0.5 text-[11px] text-cyan-700 dark:text-cyan-400">
                            Rule: <span className="font-medium">{s.autoApprovalRuleDescription}</span>
                          </p>
                        )}
                        <p className="mt-0.5 text-xs text-gray-400">Granted {new Date(s.grantedAt).toLocaleString()}</p>
                        <Countdown expiresAt={s.expiresAt} />
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">Active</span>
                      {s.sessionType === 'aws-console' && (
                        <button
                          onClick={() => { void handleOpenConsole(s.sessionId); }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:border-blue-900/50 dark:bg-transparent dark:hover:bg-blue-950/20"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open in AWS Console
                        </button>
                      )}
                      <button
                        onClick={() => { void handleRevoke(s.sessionId); }}
                        disabled={revoking === s.sessionId}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:bg-transparent dark:hover:bg-red-950/20"
                      >
                        <ShieldOff className="h-3.5 w-3.5" />
                        {revoking === s.sessionId ? 'Revoking…' : 'Revoke'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {inactive.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">History</h2>
              <div className="divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
                {inactive.map((s) => (
                  <div key={s.sessionId} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{s.resourceName}</p>
                        <ApprovalBadge mode={s.approvalMode} rule={s.autoApprovalRuleDescription} />
                      </div>
                      <p className="text-xs text-gray-400">
                        {new Date(s.grantedAt).toLocaleString()} →{' '}
                        {s.revokedAt ? new Date(s.revokedAt).toLocaleString() : new Date(s.expiresAt).toLocaleString()}
                        {s.revokedBy && s.revokedBy !== 'scheduler' ? ` · revoked by ${s.revokedBy}` : ''}
                      </p>
                    </div>
                    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset capitalize ${statusClasses[s.status] ?? 'bg-gray-50 text-gray-500 ring-gray-400/20'}`}>{s.status}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
