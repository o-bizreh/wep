import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader, Spinner } from '@wep/ui';
import { ChevronLeft, Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Lock } from 'lucide-react';
import { fetchApi, portalApi } from '../../lib/api';

interface Operation {
  operationId: string;
  name: string;
  description: string;
  category: string;
  tier: string;
  isEnabled: boolean;
  estimatedDuration: string;
}

const tierClasses: Record<string, string> = {
  'self-serve':      'bg-emerald-50 text-emerald-700 ring-emerald-600/10',
  'peer-approved':   'bg-amber-50 text-amber-700 ring-amber-600/10',
  'devops-approved': 'bg-orange-50 text-orange-700 ring-orange-600/10',
};

export function PortalOperationsManagePage() {
  const navigate = useNavigate();
  const [operations, setOperations] = useState<Operation[]>([]);
  const [loading, setLoading]       = useState(true);
  const [deleting, setDeleting]     = useState<string | null>(null);
  const [isDevOps, setIsDevOps]     = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [ops, role] = await Promise.all([
        fetchApi<Operation[]>('/portal/operations'),
        portalApi.getRole(),
      ]);
      setOperations(ops);
      setIsDevOps(role.role === 'devops');
    }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const toggleEnabled = async (op: Operation) => {
    try {
      await fetchApi(`/portal/operations/${op.operationId}`, {
        method: 'PUT',
        body: JSON.stringify({ ...op, isEnabled: !op.isEnabled }),
      });
      await fetchData();
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed'); }
  };

  const deleteOp = async (operationId: string) => {
    if (!confirm('Delete this operation? This cannot be undone.')) return;
    setDeleting(operationId);
    try {
      await fetchApi(`/portal/operations/${operationId}`, { method: 'DELETE' });
      await fetchData();
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed'); }
    finally { setDeleting(null); }
  };

  return (
    <div>
      <Link to="/portal" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
        <ChevronLeft className="h-4 w-4" /> Back to Portal
      </Link>

      <div className="mt-4 flex items-center justify-between">
        <PageHeader title="Manage Operations" onRefresh={fetchData} refreshing={loading} />
        {isDevOps ? (
          <button
            onClick={() => navigate('/portal/operations/new')}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> New Operation
          </button>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-400 dark:border-gray-700">
            <Lock className="h-3.5 w-3.5" /> Read-only — DevOps role required
          </span>
        )}
      </div>

      {loading && <div className="flex justify-center py-16"><Spinner size="lg" /></div>}

      {!loading && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200/60 bg-white/60 shadow-xl shadow-slate-200/20 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 text-xs text-gray-400 uppercase tracking-wide">
                <th className="px-4 py-3 text-left font-medium">Operation</th>
                <th className="px-4 py-3 text-left font-medium">Category</th>
                <th className="px-4 py-3 text-left font-medium">Tier</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {operations.map((op) => (
                <tr key={op.operationId} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 dark:text-white">{op.name}</p>
                    <p className="text-xs text-gray-400 truncate max-w-xs">{op.description}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 capitalize">{op.category}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${tierClasses[op.tier] ?? 'bg-gray-50 text-gray-600 ring-gray-500/10'}`}>
                      {op.tier}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => { if (isDevOps) void toggleEnabled(op); }}
                      disabled={!isDevOps}
                      className={`inline-flex items-center gap-1.5 text-xs font-medium ${!isDevOps ? 'cursor-not-allowed opacity-50' : ''}`}
                    >
                      {op.isEnabled
                        ? <><ToggleRight className="h-4 w-4 text-emerald-500" /><span className="text-emerald-600">Enabled</span></>
                        : <><ToggleLeft className="h-4 w-4 text-gray-400" /><span className="text-gray-400">Disabled</span></>}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    {isDevOps ? (
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/portal/operations/${op.operationId}/edit`}
                          className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </Link>
                        <button
                          onClick={() => { void deleteOp(op.operationId); }}
                          disabled={deleting === op.operationId}
                          className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:hover:bg-red-950/20"
                        >
                          <Trash2 className="h-3 w-3" /> {deleting === op.operationId ? '…' : 'Delete'}
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
