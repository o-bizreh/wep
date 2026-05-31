import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '@wep/ui';
import { Plus, FileText, Clock, AlertTriangle } from 'lucide-react';
import { fetchApi } from '../../lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActionItem {
  id: string;
  description: string;
  owner: string;
  dueDate: string;
  status: 'open' | 'in_progress' | 'done';
}

interface PostmortemSummary {
  id: string;
  title: string;
  severity: 'p1' | 'p2' | 'p3';
  status: 'draft' | 'in_review' | 'published';
  incidentDate: string;
  affectedServices: string[];
  duration: number;
  authorName: string;
  actionItems: ActionItem[];
  createdAt: string;
}

type StatusFilter = 'all' | 'draft' | 'in_review' | 'published';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

// ---------------------------------------------------------------------------
// Badge components
// ---------------------------------------------------------------------------

function SeverityBadge({ severity }: { severity: 'p1' | 'p2' | 'p3' }) {
  const classes: Record<'p1' | 'p2' | 'p3', string> = {
    p1: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    p2: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    p3: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  };
  const labels: Record<'p1' | 'p2' | 'p3', string> = {
    p1: 'P1',
    p2: 'P2',
    p3: 'P3',
  };
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold ${classes[severity]}`}>
      {labels[severity]}
    </span>
  );
}

function StatusBadge({ status }: { status: 'draft' | 'in_review' | 'published' }) {
  const classes: Record<string, string> = {
    draft: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
    in_review: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    published: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  };
  const labels: Record<string, string> = {
    draft: 'Draft',
    in_review: 'In Review',
    published: 'Published',
  };
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${classes[status]}`}>
      {labels[status]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function PostmortemListPage() {
  const navigate = useNavigate();
  const [postmortems, setPostmortems] = useState<PostmortemSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const loadPostmortems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchApi<PostmortemSummary[]>('/postmortems');
      setPostmortems(data);
    } catch (err) {
      console.error('Failed to load postmortems', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPostmortems();
  }, [loadPostmortems]);

  const filtered = postmortems.filter(
    (p) => statusFilter === 'all' || p.status === statusFilter,
  );

  const totalOpenActionItems = postmortems.reduce(
    (acc, p) => acc + p.actionItems.filter((a) => a.status !== 'done').length,
    0,
  );

  const avgResolutionMinutes =
    postmortems.length > 0
      ? Math.round(postmortems.reduce((acc, p) => acc + p.duration, 0) / postmortems.length)
      : 0;

  const filterPills: { label: string; value: StatusFilter }[] = [
    { label: 'All', value: 'all' },
    { label: 'Draft', value: 'draft' },
    { label: 'In Review', value: 'in_review' },
    { label: 'Published', value: 'published' },
  ];

  return (
    <div>
      <PageHeader
        title="Postmortems"
        onRefresh={loadPostmortems}
        refreshing={loading}
        actions={
          <button
            onClick={() => navigate('/postmortems/new')}
            className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-700"
          >
            <Plus className="h-4 w-4" />
            New Postmortem
          </button>
        }
      />

      {/* Stats row */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        {[
          { label: 'Total Postmortems', value: postmortems.length.toString(), icon: <FileText className="h-5 w-5 text-zinc-400" /> },
          { label: 'Open Action Items', value: totalOpenActionItems.toString(), icon: <AlertTriangle className="h-5 w-5 text-amber-400" /> },
          { label: 'Avg Resolution Time', value: avgResolutionMinutes > 0 ? formatDuration(avgResolutionMinutes) : '—', icon: <Clock className="h-5 w-5 text-teal-400" /> },
        ].map(({ label, value, icon }) => (
          <div
            key={label}
            className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-center gap-2">
              {icon}
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">{label}</p>
            </div>
            <p className="mt-2 text-2xl font-black tracking-tight text-zinc-900 dark:text-white">{value}</p>
          </div>
        ))}
      </div>

      {/* Filter pills */}
      <div className="mb-4 flex gap-2">
        {filterPills.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => setStatusFilter(value)}
            className={`rounded-xl px-4 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === value
                ? 'bg-teal-600 text-white'
                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Table */}
      {!loading && filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-zinc-200 bg-white py-16 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800">
            <FileText className="h-6 w-6 text-zinc-400" />
          </div>
          <p className="font-medium text-zinc-500 dark:text-zinc-400">
            {statusFilter !== 'all' ? 'No postmortems match this filter.' : 'No postmortems yet.'}
          </p>
          {statusFilter === 'all' && (
            <button
              onClick={() => navigate('/postmortems/new')}
              className="mt-3 text-sm font-medium text-teal-600 hover:text-teal-700 dark:text-teal-400"
            >
              Write your first postmortem →
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <table className="min-w-full divide-y divide-zinc-100 dark:divide-zinc-800">
            <thead>
              <tr>
                {['Severity', 'Title', 'Incident Date', 'Affected Services', 'Duration', 'Status', 'Author', 'Actions'].map(
                  (col) => (
                    <th
                      key={col}
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400"
                    >
                      {col}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
              {filtered.map((pm) => (
                <tr
                  key={pm.id}
                  onClick={() => navigate(`/postmortems/${pm.id}`)}
                  className="cursor-pointer transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                >
                  <td className="px-4 py-3">
                    <SeverityBadge severity={pm.severity} />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/postmortems/${pm.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium text-zinc-900 hover:text-teal-600 dark:text-white dark:hover:text-teal-400"
                    >
                      {pm.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      {pm.actionItems.length} action item{pm.actionItems.length !== 1 ? 's' : ''}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">
                    {formatDate(pm.incidentDate)}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">
                    {pm.affectedServices.join(', ') || '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">
                    {pm.duration > 0 ? formatDuration(pm.duration) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={pm.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">
                    {pm.authorName}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-400">
                    {pm.actionItems.filter((a) => a.status !== 'done').length > 0 && (
                      <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                        {pm.actionItems.filter((a) => a.status !== 'done').length} open
                      </span>
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
