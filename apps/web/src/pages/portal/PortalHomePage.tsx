import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@wep/ui';
import { ChevronRight, Inbox, Shield, User } from 'lucide-react';
import { fetchApi, portalApi } from '../../lib/api';

interface Operation {
  operationId: string;
  name: string;
  description: string;
  category: string;
  tier: string;
  isEnabled: boolean;
}

const tierConfig: Record<string, { label: string; classes: string }> = {
  'self-serve':      { label: 'Self-serve',     classes: 'bg-emerald-50 text-emerald-700 ring-emerald-600/10' },
  'peer-approved':   { label: 'Peer approved',  classes: 'bg-amber-50 text-amber-700 ring-amber-600/10' },
  'devops-approved': { label: 'DevOps review',  classes: 'bg-orange-50 text-orange-700 ring-orange-600/10' },
};

export function PortalHomePage() {
  const [operations, setOperations] = useState<Operation[]>([]);
  const [loading, setLoading] = useState(true);
  const [identity, setIdentity] = useState<{
    username: string | null; email: string | null; role: 'devops' | 'engineer'; roleName: string | null;
  } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    fetchApi<Operation[]>('/portal/operations')
      .then(setOperations)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchData();
    // Resolve identity from AWS credentials (set in Settings). No manual email entry needed.
    portalApi.getRole().then(setIdentity).catch(() => undefined);
  }, [fetchData]);

  const grouped = operations.reduce((acc, op) => {
    const cat = op.category;
    if (!acc[cat]) acc[cat] = [];
    acc[cat]!.push(op);
    return acc;
  }, {} as Record<string, Operation[]>);

  const isDevOps = identity?.role === 'devops';

  return (
    <div>
      <PageHeader
        title="Self-Service Portal"
        onRefresh={fetchData}
        refreshing={loading}
        actions={
          <>
            {/* Identity badge — shows who is logged in based on AWS credentials */}
            {identity?.username ? (
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${
                isDevOps
                  ? 'bg-orange-50 text-orange-700 ring-orange-600/10 dark:bg-orange-950/20 dark:text-orange-400'
                  : 'bg-gray-50 text-gray-600 ring-gray-500/10 dark:bg-gray-800 dark:text-gray-300'
              }`}>
                {isDevOps ? <Shield className="h-3 w-3" /> : <User className="h-3 w-3" />}
                {identity.username}
              </span>
            ) : (
              <span className="text-xs text-gray-400">Add AWS credentials in Settings to identify yourself</span>
            )}
            <Link to="/portal/requests" className="shrink-0 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
              View all requests →
            </Link>
            <Link
              to="/portal/jit-sessions"
              className="shrink-0 inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 shadow-sm transition-all hover:bg-gray-50 hover:shadow dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              My JIT sessions
            </Link>
            {isDevOps && (
              <Link
                to="/portal/operations/manage"
                className="shrink-0 inline-flex items-center rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-sm font-medium text-orange-700 shadow-sm transition-all hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/20 dark:text-orange-400"
              >
                <Shield className="mr-1.5 h-3.5 w-3.5" /> Manage operations
              </Link>
            )}
          </>
        }
      />

      {!loading && Object.keys(grouped).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800">
            <Inbox className="h-6 w-6 text-gray-400" />
          </div>
          <p className="font-medium text-gray-500 dark:text-gray-400">No operations configured yet.</p>
          <p className="mt-1 text-sm text-gray-400">Operations will appear here once the catalog is seeded.</p>
        </div>
      ) : (
        Object.entries(grouped).map(([category, ops]) => (
          <div key={category} className="mb-8">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400 capitalize">{category}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ops.map((op) => {
                const tier = tierConfig[op.tier] ?? { label: op.tier, classes: 'bg-gray-50 text-gray-600 ring-gray-500/10' };
                return (
                  <Link
                    key={op.operationId}
                    to={op.isEnabled ? `/portal/request/${op.operationId}` : '#'}
                    className={`group flex flex-col rounded-2xl border bg-white/60 backdrop-blur-xl p-5 shadow-xl shadow-slate-200/20 transition-all dark:bg-zinc-900/40 dark:shadow-black/40 hover:-translate-y-1 ${
                      op.isEnabled
                        ? 'cursor-pointer border-slate-200/60 hover:border-cyan-500/30 hover:shadow-2xl dark:border-white/10 dark:hover:border-cyan-500/30'
                        : 'pointer-events-none border-slate-200/60 opacity-50 dark:border-white/10'
                    }`}
                  >
                    <div className="mb-3 flex items-start justify-between">
                      <p className="font-semibold text-gray-900 dark:text-white">{op.name}</p>
                      <span className={`ml-2 shrink-0 inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${tier.classes}`}>
                        {tier.label}
                      </span>
                    </div>
                    <p className="flex-1 text-sm text-gray-500 dark:text-gray-400">{op.description}</p>
                    {op.isEnabled && (
                      <div className="mt-4 flex items-center gap-1 text-xs font-medium text-blue-600 opacity-0 transition-opacity group-hover:opacity-100 dark:text-blue-400">
                        Request <ChevronRight className="h-3 w-3" />
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
