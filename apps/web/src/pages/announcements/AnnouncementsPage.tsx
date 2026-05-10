import { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@wep/ui';
import { fetchApi } from '../../lib/api';

interface Announcement {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
  createdAt: string;
  author: string;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const SEVERITY_CONFIG: Record<string, { label: string; classes: string }> = {
  info:     { label: 'Info',     classes: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20 dark:bg-blue-950/30 dark:text-blue-400' },
  warning:  { label: 'Warning',  classes: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-950/30 dark:text-amber-400' },
  critical: { label: 'Critical', classes: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20 dark:bg-red-950/30 dark:text-red-400' },
};

export function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState<'info' | 'warning' | 'critical'>('info');
  const [author, setAuthor] = useState(() => localStorage.getItem('wep:slackUsername') ?? '');

  const fetchList = useCallback(async () => {
    setLoading(true);
    fetchApi<Announcement[]>('/announcements')
      .then(setAnnouncements)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchList(); }, [fetchList]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim() || !author.trim()) return;
    setSubmitting(true);
    try {
      await fetchApi('/announcements', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), body: body.trim(), severity, author: author.trim() }),
      });
      setTitle('');
      setBody('');
      setSeverity('info');
      await fetchList();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white';

  return (
    <div>
      <PageHeader title="Announcements" onRefresh={fetchList} refreshing={loading} />

      <div className="grid grid-cols-2 gap-8">
        {/* Left: send form */}
        <div className="rounded-2xl border border-slate-200/60 bg-white/60 p-6 shadow-xl shadow-slate-200/20 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40">
          <h2 className="mb-5 text-sm font-semibold text-gray-900 dark:text-white">Send Announcement</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Brief title"
                className={inputClass}
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">Body</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                placeholder="Details…"
                className={inputClass}
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">Severity</label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as 'info' | 'warning' | 'critical')}
                className={inputClass}
              >
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">Author (Slack username)</label>
              <input
                type="text"
                value={author}
                onChange={(e) => {
                  const val = e.target.value.replace(/^@/, '');
                  setAuthor(val);
                  localStorage.setItem('wep:slackUsername', val);
                }}
                placeholder="your-username"
                className={inputClass}
                required
              />
            </div>
            <button
              type="submit"
              disabled={submitting || !title.trim() || !body.trim() || !author.trim()}
              className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Sending…' : 'Send Announcement'}
            </button>
          </form>
        </div>

        {/* Right: history */}
        <div className="rounded-2xl border border-slate-200/60 bg-white/60 shadow-xl shadow-slate-200/20 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40">
          <div className="border-b border-gray-100 px-5 py-4 dark:border-gray-800">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">History</h2>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {announcements.map((ann) => {
              const cfg = SEVERITY_CONFIG[ann.severity] ?? SEVERITY_CONFIG['info']!;
              return (
                <div key={ann.id} className="px-5 py-4">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${cfg.classes}`}>
                      {cfg.label}
                    </span>
                  </div>
                  <p className="font-medium text-gray-900 dark:text-white">{ann.title}</p>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{ann.body}</p>
                  <p className="mt-1.5 text-xs text-gray-400">
                    {ann.author} · {formatRelativeTime(ann.createdAt)}
                  </p>
                </div>
              );
            })}
            {!loading && announcements.length === 0 && (
              <p className="px-5 py-8 text-center text-sm text-gray-400">No announcements yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
