import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { Link, useParams, useNavigate, useLocation } from 'react-router-dom';
import { PageHeader } from '@wep/ui';
import { ArrowLeft, Plus, Trash2, Send, Save } from 'lucide-react';
import { fetchApi } from '../../lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TimelineEntry {
  time: string;
  event: string;
  author?: string;
}

interface ActionItem {
  id: string;
  description: string;
  owner: string;
  dueDate: string;
  status: 'open' | 'in_progress' | 'done';
}

interface Postmortem {
  id: string;
  incidentId?: string;
  title: string;
  severity: 'p1' | 'p2' | 'p3';
  status: 'draft' | 'in_review' | 'published';
  incidentDate: string;
  detectedAt: string;
  resolvedAt: string;
  duration: number;
  affectedServices: string[];
  summary: string;
  timeline: TimelineEntry[];
  rootCause: string;
  contributingFactors: string[];
  impact: string;
  actionItems: ActionItem[];
  author: string;
  authorName: string;
  reviewers: string[];
  createdAt: string;
  updatedAt: string;
}

type PostmortemDraft = Omit<Postmortem, 'id' | 'status' | 'createdAt' | 'updatedAt'>;

function emptyDraft(): PostmortemDraft {
  return {
    incidentId: '',
    title: '',
    severity: 'p3',
    incidentDate: '',
    detectedAt: '',
    resolvedAt: '',
    duration: 0,
    affectedServices: [],
    summary: '',
    timeline: [],
    rootCause: '',
    contributingFactors: [],
    impact: '',
    actionItems: [],
    author: '',
    authorName: '',
    reviewers: [],
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-4 text-sm font-black uppercase tracking-tight text-zinc-500 dark:text-zinc-400">
        {title}
      </h2>
      {children}
    </div>
  );
}

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-zinc-500 dark:text-zinc-400">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputClass =
  'w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500';

const selectClass =
  'w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white';

const textareaClass =
  'w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500 resize-none';

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function PostmortemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const isNew = !id || location.pathname === '/postmortems/new';
  const isEdit = location.pathname.endsWith('/edit') || isNew;

  const [postmortem, setPostmortem] = useState<Postmortem | null>(null);
  const [draft, setDraft] = useState<PostmortemDraft>(emptyDraft());
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // New timeline / action item forms
  const [newTimelineEntry, setNewTimelineEntry] = useState<{ time: string; event: string; author: string }>({ time: '', event: '', author: '' });
  const [newActionItem, setNewActionItem] = useState<{ description: string; owner: string; dueDate: string }>({ description: '', owner: '', dueDate: '' });

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadPostmortem = useCallback(async () => {
    if (!id || isNew) return;
    setLoading(true);
    try {
      const data = await fetchApi<Postmortem>(`/postmortems/${id}`);
      setPostmortem(data);
      const { id: _id, status: _status, createdAt: _ca, updatedAt: _ua, ...rest } = data;
      setDraft(rest);
    } catch (err) {
      showToast(`Failed to load postmortem: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [id, isNew]);

  useEffect(() => {
    void loadPostmortem();
  }, [loadPostmortem]);

  function updateDraft<K extends keyof PostmortemDraft>(key: K, value: PostmortemDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      if (isNew) {
        const created = await fetchApi<Postmortem>('/postmortems', {
          method: 'POST',
          body: JSON.stringify(draft),
        });
        showToast('Postmortem created');
        navigate(`/postmortems/${created.id}`);
      } else {
        const updated = await fetchApi<Postmortem>(`/postmortems/${id}`, {
          method: 'PUT',
          body: JSON.stringify(draft),
        });
        setPostmortem(updated);
        showToast('Postmortem saved');
        if (location.pathname.endsWith('/edit')) {
          navigate(`/postmortems/${id}`);
        }
      }
    } catch (err) {
      showToast(`Save failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!id) return;
    setPublishing(true);
    try {
      const updated = await fetchApi<Postmortem>(`/postmortems/${id}/publish`, { method: 'POST' });
      setPostmortem(updated);
      showToast('Postmortem published');
    } catch (err) {
      showToast(`Publish failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setPublishing(false);
    }
  };

  const handleActionItemStatusChange = async (actionId: string, status: ActionItem['status']) => {
    if (!id) return;
    try {
      const updated = await fetchApi<Postmortem>(`/postmortems/${id}/action-items/${actionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setPostmortem(updated);
      updateDraft('actionItems', updated.actionItems);
    } catch (err) {
      showToast(`Failed to update action item: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const addTimelineEntry = () => {
    if (!newTimelineEntry.time || !newTimelineEntry.event) return;
    const entry: TimelineEntry = {
      time: newTimelineEntry.time,
      event: newTimelineEntry.event,
      ...(newTimelineEntry.author ? { author: newTimelineEntry.author } : {}),
    };
    updateDraft('timeline', [...draft.timeline, entry].sort((a, b) => a.time.localeCompare(b.time)));
    setNewTimelineEntry({ time: '', event: '', author: '' });
  };

  const removeTimelineEntry = (index: number) => {
    updateDraft('timeline', draft.timeline.filter((_, i) => i !== index));
  };

  const addActionItem = () => {
    if (!newActionItem.description || !newActionItem.owner || !newActionItem.dueDate) return;
    const item: ActionItem = {
      id: crypto.randomUUID(),
      description: newActionItem.description,
      owner: newActionItem.owner,
      dueDate: newActionItem.dueDate,
      status: 'open',
    };
    updateDraft('actionItems', [...draft.actionItems, item]);
    setNewActionItem({ description: '', owner: '', dueDate: '' });
  };

  const removeActionItem = (itemId: string) => {
    updateDraft('actionItems', draft.actionItems.filter((a) => a.id !== itemId));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-teal-600" />
      </div>
    );
  }

  const currentStatus = postmortem?.status ?? 'draft';

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border px-4 py-3 shadow-lg ${
            toast.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400'
              : 'border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'
          }`}
        >
          <p className="text-sm">{toast.message}</p>
        </div>
      )}

      <PageHeader
        title={isNew ? 'New Postmortem' : (draft.title || 'Postmortem')}
        actions={
          <div className="flex items-center gap-2">
            <Link
              to="/postmortems"
              className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
            {!isNew && !isEdit && currentStatus !== 'published' && (
              <Link
                to={`/postmortems/${id}/edit`}
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Edit
              </Link>
            )}
            {isEdit && (
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-700 dark:hover:bg-zinc-600"
              >
                <Save className="h-4 w-4" />
                {saving ? 'Saving…' : 'Save Draft'}
              </button>
            )}
            {!isNew && currentStatus !== 'published' && (
              <button
                onClick={() => void handlePublish()}
                disabled={publishing}
                className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                {publishing ? 'Publishing…' : 'Publish'}
              </button>
            )}
          </div>
        }
      />

      <div className="space-y-6">
        {/* Metadata */}
        <SectionCard title="Incident Details">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <FormField label="Title" required>
                <input
                  type="text"
                  value={draft.title}
                  onChange={(e) => updateDraft('title', e.target.value)}
                  disabled={!isEdit}
                  placeholder="e.g. Payment service outage"
                  className={inputClass}
                />
              </FormField>
            </div>

            <FormField label="Incident ID (optional)">
              <input
                type="text"
                value={draft.incidentId ?? ''}
                onChange={(e) => updateDraft('incidentId', e.target.value || undefined)}
                disabled={!isEdit}
                placeholder="e.g. INC-1234"
                className={inputClass}
              />
            </FormField>

            <FormField label="Severity" required>
              <select
                value={draft.severity}
                onChange={(e) => updateDraft('severity', e.target.value as 'p1' | 'p2' | 'p3')}
                disabled={!isEdit}
                className={selectClass}
              >
                <option value="p1">P1 — Critical</option>
                <option value="p2">P2 — High</option>
                <option value="p3">P3 — Medium</option>
              </select>
            </FormField>

            <FormField label="Incident Date" required>
              <input
                type="date"
                value={draft.incidentDate}
                onChange={(e) => updateDraft('incidentDate', e.target.value)}
                disabled={!isEdit}
                className={inputClass}
              />
            </FormField>

            <FormField label="Duration (minutes)">
              <input
                type="number"
                value={draft.duration}
                onChange={(e) => updateDraft('duration', parseInt(e.target.value, 10) || 0)}
                disabled={!isEdit}
                min={0}
                className={inputClass}
              />
            </FormField>

            <FormField label="Detected At" required>
              <input
                type="datetime-local"
                value={draft.detectedAt ? draft.detectedAt.slice(0, 16) : ''}
                onChange={(e) => updateDraft('detectedAt', e.target.value ? new Date(e.target.value).toISOString() : '')}
                disabled={!isEdit}
                className={inputClass}
              />
            </FormField>

            <FormField label="Resolved At" required>
              <input
                type="datetime-local"
                value={draft.resolvedAt ? draft.resolvedAt.slice(0, 16) : ''}
                onChange={(e) => updateDraft('resolvedAt', e.target.value ? new Date(e.target.value).toISOString() : '')}
                disabled={!isEdit}
                className={inputClass}
              />
            </FormField>

            <div className="col-span-2">
              <FormField label="Affected Services (comma-separated)">
                <input
                  type="text"
                  value={draft.affectedServices.join(', ')}
                  onChange={(e) =>
                    updateDraft(
                      'affectedServices',
                      e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                    )
                  }
                  disabled={!isEdit}
                  placeholder="e.g. payments-api, checkout-service"
                  className={inputClass}
                />
              </FormField>
            </div>

            <FormField label="Author ID" required>
              <input
                type="text"
                value={draft.author}
                onChange={(e) => updateDraft('author', e.target.value)}
                disabled={!isEdit}
                placeholder="e.g. omar.bizreh"
                className={inputClass}
              />
            </FormField>

            <FormField label="Author Name" required>
              <input
                type="text"
                value={draft.authorName}
                onChange={(e) => updateDraft('authorName', e.target.value)}
                disabled={!isEdit}
                placeholder="e.g. Omar Bizreh"
                className={inputClass}
              />
            </FormField>

            <div className="col-span-2">
              <FormField label="Reviewers (comma-separated)">
                <input
                  type="text"
                  value={draft.reviewers.join(', ')}
                  onChange={(e) =>
                    updateDraft(
                      'reviewers',
                      e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                    )
                  }
                  disabled={!isEdit}
                  placeholder="e.g. alice, bob"
                  className={inputClass}
                />
              </FormField>
            </div>
          </div>
        </SectionCard>

        {/* Impact + Summary */}
        <SectionCard title="Analysis">
          <div className="space-y-4">
            <FormField label="Summary">
              <textarea
                rows={3}
                value={draft.summary}
                onChange={(e) => updateDraft('summary', e.target.value)}
                disabled={!isEdit}
                placeholder="Brief description of what happened"
                className={textareaClass}
              />
            </FormField>

            <FormField label="Impact">
              <textarea
                rows={3}
                value={draft.impact}
                onChange={(e) => updateDraft('impact', e.target.value)}
                disabled={!isEdit}
                placeholder="Who and what was affected, and to what extent"
                className={textareaClass}
              />
            </FormField>

            <FormField label="Root Cause">
              <textarea
                rows={3}
                value={draft.rootCause}
                onChange={(e) => updateDraft('rootCause', e.target.value)}
                disabled={!isEdit}
                placeholder="The underlying cause of the incident"
                className={textareaClass}
              />
            </FormField>

            <FormField label="Contributing Factors (one per line)">
              <textarea
                rows={3}
                value={draft.contributingFactors.join('\n')}
                onChange={(e) =>
                  updateDraft(
                    'contributingFactors',
                    e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                  )
                }
                disabled={!isEdit}
                placeholder="Factors that contributed to the incident"
                className={textareaClass}
              />
            </FormField>
          </div>
        </SectionCard>

        {/* Timeline */}
        <SectionCard title="Timeline">
          {draft.timeline.length > 0 && (
            <div className="mb-4 space-y-2">
              {draft.timeline.map((entry, index) => (
                <div
                  key={index}
                  className="flex items-start gap-3 rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/50"
                >
                  <div className="mt-0.5 flex-shrink-0">
                    <div className="h-2 w-2 rounded-full bg-teal-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                      {new Date(entry.time).toLocaleString()}
                      {entry.author && <span className="ml-2 text-zinc-400">— {entry.author}</span>}
                    </p>
                    <p className="mt-0.5 text-sm text-zinc-900 dark:text-white">{entry.event}</p>
                  </div>
                  {isEdit && (
                    <button
                      onClick={() => removeTimelineEntry(index)}
                      className="flex-shrink-0 rounded-lg p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {isEdit && (
            <div className="rounded-xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Add Entry</p>
              <div className="grid grid-cols-3 gap-3">
                <FormField label="Time">
                  <input
                    type="datetime-local"
                    value={newTimelineEntry.time}
                    onChange={(e) => setNewTimelineEntry((p) => ({ ...p, time: e.target.value }))}
                    className={inputClass}
                  />
                </FormField>
                <div className="col-span-2">
                  <FormField label="Event">
                    <input
                      type="text"
                      value={newTimelineEntry.event}
                      onChange={(e) => setNewTimelineEntry((p) => ({ ...p, event: e.target.value }))}
                      placeholder="What happened"
                      className={inputClass}
                    />
                  </FormField>
                </div>
                <FormField label="Author (optional)">
                  <input
                    type="text"
                    value={newTimelineEntry.author}
                    onChange={(e) => setNewTimelineEntry((p) => ({ ...p, author: e.target.value }))}
                    placeholder="Who added this"
                    className={inputClass}
                  />
                </FormField>
                <div className="col-span-2 flex items-end">
                  <button
                    onClick={addTimelineEntry}
                    disabled={!newTimelineEntry.time || !newTimelineEntry.event}
                    className="inline-flex items-center gap-2 rounded-xl bg-zinc-800 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-700"
                  >
                    <Plus className="h-4 w-4" />
                    Add Entry
                  </button>
                </div>
              </div>
            </div>
          )}
        </SectionCard>

        {/* Action Items */}
        <SectionCard title="Action Items">
          {draft.actionItems.length > 0 && (
            <div className="mb-4 overflow-hidden rounded-xl border border-zinc-100 dark:border-zinc-800">
              <table className="min-w-full divide-y divide-zinc-100 dark:divide-zinc-800">
                <thead>
                  <tr>
                    {['Description', 'Owner', 'Due Date', 'Status', ''].map((col) => (
                      <th
                        key={col}
                        className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
                  {draft.actionItems.map((item) => (
                    <tr key={item.id} className="bg-white dark:bg-zinc-900">
                      <td className="px-4 py-3 text-sm text-zinc-900 dark:text-white">{item.description}</td>
                      <td className="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">{item.owner}</td>
                      <td className="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">{item.dueDate}</td>
                      <td className="px-4 py-3">
                        {!isNew && postmortem ? (
                          <select
                            value={item.status}
                            onChange={(e) =>
                              void handleActionItemStatusChange(item.id, e.target.value as ActionItem['status'])
                            }
                            className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                          >
                            <option value="open">Open</option>
                            <option value="in_progress">In Progress</option>
                            <option value="done">Done</option>
                          </select>
                        ) : (
                          <select
                            value={item.status}
                            onChange={(e) => {
                              const updated = draft.actionItems.map((a) =>
                                a.id === item.id ? { ...a, status: e.target.value as ActionItem['status'] } : a,
                              );
                              updateDraft('actionItems', updated);
                            }}
                            className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                          >
                            <option value="open">Open</option>
                            <option value="in_progress">In Progress</option>
                            <option value="done">Done</option>
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEdit && (
                          <button
                            onClick={() => removeActionItem(item.id)}
                            className="rounded-lg p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {isEdit && (
            <div className="rounded-xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Add Action Item</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-3">
                  <FormField label="Description">
                    <input
                      type="text"
                      value={newActionItem.description}
                      onChange={(e) => setNewActionItem((p) => ({ ...p, description: e.target.value }))}
                      placeholder="What needs to be done"
                      className={inputClass}
                    />
                  </FormField>
                </div>
                <FormField label="Owner">
                  <input
                    type="text"
                    value={newActionItem.owner}
                    onChange={(e) => setNewActionItem((p) => ({ ...p, owner: e.target.value }))}
                    placeholder="e.g. alice"
                    className={inputClass}
                  />
                </FormField>
                <FormField label="Due Date">
                  <input
                    type="date"
                    value={newActionItem.dueDate}
                    onChange={(e) => setNewActionItem((p) => ({ ...p, dueDate: e.target.value }))}
                    className={inputClass}
                  />
                </FormField>
                <div className="flex items-end">
                  <button
                    onClick={addActionItem}
                    disabled={!newActionItem.description || !newActionItem.owner || !newActionItem.dueDate}
                    className="inline-flex items-center gap-2 rounded-xl bg-zinc-800 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-700"
                  >
                    <Plus className="h-4 w-4" />
                    Add Item
                  </button>
                </div>
              </div>
            </div>
          )}
        </SectionCard>

        {/* Bottom save bar */}
        {isEdit && (
          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => (isNew ? navigate('/postmortems') : navigate(`/postmortems/${id}`))}
              className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-700"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving…' : 'Save Draft'}
            </button>
            {!isNew && currentStatus !== 'published' && (
              <button
                onClick={() => void handlePublish()}
                disabled={publishing}
                className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                {publishing ? 'Publishing…' : 'Publish'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
