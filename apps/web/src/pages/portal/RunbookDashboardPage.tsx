import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '@wep/ui';
import { Play, Trash2, Plus, Search, BookOpen } from 'lucide-react';
import { fetchApi, portalApi } from '../../lib/api';

interface RunbookSummary {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  blockCount: number;
  ownerId: string;
  ownerName: string;
  createdAt: string;
  updatedAt: string;
}

interface ExecuteResponse {
  execId: string;
  runbookId: string;
  status: string;
  startedAt: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function useCurrentUser() {
  const [user, setUser] = useState({ id: 'anonymous', name: 'Anonymous' });
  useEffect(() => {
    portalApi.getRole()
      .then((identity) => {
        if (identity.username) {
          setUser({ id: identity.email ?? identity.username, name: identity.username });
        }
      })
      .catch(() => {});
  }, []);
  return user;
}

export function RunbookDashboardPage() {
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const [runbooks, setRunbooks] = useState<RunbookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  };

  const loadRunbooks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchApi<RunbookSummary[]>('/runbooks');
      setRunbooks(data);
    } catch (err) {
      console.error('Failed to load runbooks', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRunbooks();
  }, [loadRunbooks]);

  const filtered = runbooks.filter((rb) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      rb.name.toLowerCase().includes(q) ||
      (rb.description ?? '').toLowerCase().includes(q)
    );
  });

  const handleDelete = async (runbook: RunbookSummary) => {
    setConfirmDeleteId(null);
    setDeletingId(runbook.id);
    try {
      await fetchApi(`/runbooks/${runbook.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ requesterId: currentUser.id }),
      });
      setRunbooks((prev) => prev.filter((rb) => rb.id !== runbook.id));
      showToast(`Deleted "${runbook.name}"`);
    } catch (err) {
      showToast(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeletingId(null);
    }
  };

  const handlePlay = async (runbook: RunbookSummary) => {
    setPlayingId(runbook.id);
    try {
      const response = await fetchApi<ExecuteResponse>(`/runbooks/${runbook.id}/execute`, {
        method: 'POST',
        body: JSON.stringify({ executedBy: currentUser.id, dryRun: false }),
      });
      showToast(`Execution started: ${response.execId}`);
    } catch (err) {
      showToast(`Execution failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPlayingId(null);
    }
  };

  const canDeleteOrPlay = (runbook: RunbookSummary) =>
    currentUser.id === 'devops' || runbook.ownerId === currentUser.id;

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-lg dark:border-gray-700 dark:bg-gray-900">
          <p className="text-sm text-gray-700 dark:text-gray-300">{toast}</p>
        </div>
      )}

      <PageHeader
        title="Runbook Studio"
        onRefresh={loadRunbooks}
        refreshing={loading}
        actions={
          <button
            onClick={() => navigate('/portal/runbooks/new')}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            New Runbook
          </button>
        }
      />

      {/* Stats row */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        {[
          { label: 'Total Runbooks', value: runbooks.length.toString() },
          { label: 'Executions (30d)', value: '—' },
          { label: 'Automation Rate', value: '—' },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900"
          >
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400">{label}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search runbooks..."
          className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500"
        />
      </div>

      {/* Table */}
      {!loading && filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800">
            <BookOpen className="h-6 w-6 text-gray-400" />
          </div>
          <p className="font-medium text-gray-500 dark:text-gray-400">
            {searchQuery ? 'No runbooks match your search.' : 'No runbooks yet.'}
          </p>
          {!searchQuery && (
            <button
              onClick={() => navigate('/portal/runbooks/new')}
              className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
            >
              Create your first runbook →
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <table className="min-w-full divide-y divide-gray-100 dark:divide-gray-800">
            <thead>
              <tr>
                {['Name', 'Owner', 'Blocks', 'Tags', 'Updated', ''].map((col) => (
                  <th
                    key={col}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {filtered.map((rb) => (
                <tr
                  key={rb.id}
                  className="transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
                >
                  <td className="px-4 py-3">
                    <Link
                      to={`/portal/runbooks/${rb.id}`}
                      className="font-medium text-gray-900 hover:text-blue-600 dark:text-white dark:hover:text-blue-400"
                    >
                      {rb.name}
                    </Link>
                    {rb.description && (
                      <p className="mt-0.5 text-xs text-gray-400 line-clamp-1">{rb.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {rb.ownerName}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {rb.blockCount}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(rb.tags ?? []).slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-600/10 dark:bg-blue-900/30 dark:text-blue-300"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-400">{formatDate(rb.updatedAt)}</td>
                  <td className="px-4 py-3">
                    {canDeleteOrPlay(rb) && (
                      <div className="flex items-center justify-end gap-2">
                        {confirmDeleteId === rb.id ? (
                          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 dark:border-red-800 dark:bg-red-900/20">
                            <span className="text-xs text-red-700 dark:text-red-400">Delete?</span>
                            <button
                              onClick={() => void handleDelete(rb)}
                              disabled={deletingId === rb.id}
                              className="text-xs font-semibold text-red-600 hover:text-red-800 disabled:opacity-50 dark:text-red-400"
                            >
                              Yes
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-xs font-semibold text-gray-500 hover:text-gray-700 dark:text-gray-400"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={() => void handlePlay(rb)}
                              disabled={playingId === rb.id}
                              title="Run"
                              className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-50 dark:hover:bg-emerald-900/20"
                            >
                              <Play className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(rb.id)}
                              disabled={deletingId === rb.id}
                              title="Delete"
                              className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-900/20"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      </div>
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
