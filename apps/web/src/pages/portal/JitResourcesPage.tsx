import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, Spinner } from '@wep/ui';
import { Plus, Pencil, Trash2, Database, ChevronLeft } from 'lucide-react';
import { fetchApi } from '../../lib/api';

interface JitResource {
  resourceId: string;
  type: 'rds-postgres' | 'ec2-ssh';
  name: string;
  environment: string;
  region: string;
  isEnabled: boolean;
  notes: string | null;
  host: string | null;
  port: number | null;
  dbName: string | null;
  masterSecretId: string | null;
  instanceId: string | null;
  bastionHost: string | null;
}

const EMPTY: Omit<JitResource, 'resourceId'> = {
  type: 'rds-postgres',
  name: '',
  environment: 'prod',
  region: 'us-east-1',
  isEnabled: true,
  notes: null,
  host: null,
  port: 5432,
  dbName: null,
  masterSecretId: null,
  instanceId: null,
  bastionHost: null,
};

function ResourceForm({ initial, onSave, onCancel }: {
  initial: Partial<JitResource>;
  onSave: (data: Partial<JitResource>) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Partial<JitResource>>({ ...EMPTY, ...initial });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = <K extends keyof JitResource>(k: K, v: JitResource[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    try { await onSave(form); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : 'Save failed'); setSaving(false); }
  };

  const inputCls = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white';

  return (
    <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Name *</label>
          <input className={inputCls} required value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="prod-payments-db" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Type *</label>
          <select className={inputCls} value={form.type} onChange={(e) => set('type', e.target.value as JitResource['type'])}>
            <option value="rds-postgres">RDS PostgreSQL</option>
            <option value="ec2-ssh">EC2 SSH</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Environment *</label>
          <select className={inputCls} value={form.environment ?? 'prod'} onChange={(e) => set('environment', e.target.value)}>
            <option value="dev">Development</option>
            <option value="staging">Staging</option>
            <option value="prod">Production</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Region *</label>
          <input className={inputCls} required value={form.region ?? ''} onChange={(e) => set('region', e.target.value)} placeholder="us-east-1" />
        </div>
      </div>

      {form.type === 'rds-postgres' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Host</label>
            <input className={inputCls} value={form.host ?? ''} onChange={(e) => set('host', e.target.value || null)} placeholder="mydb.cluster.us-east-1.rds.amazonaws.com" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Port</label>
            <input className={inputCls} type="number" value={form.port ?? 5432} onChange={(e) => set('port', parseInt(e.target.value, 10))} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Database name</label>
            <input className={inputCls} value={form.dbName ?? ''} onChange={(e) => set('dbName', e.target.value || null)} placeholder="payments" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Master secret ID (Secrets Manager)</label>
            <input className={inputCls} value={form.masterSecretId ?? ''} onChange={(e) => set('masterSecretId', e.target.value || null)} placeholder="prod/payments/db-master-url" />
          </div>
        </div>
      )}

      {form.type === 'ec2-ssh' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Instance ID</label>
            <input className={inputCls} value={form.instanceId ?? ''} onChange={(e) => set('instanceId', e.target.value || null)} placeholder="i-0abc1234def56789" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Bastion host (optional)</label>
            <input className={inputCls} value={form.bastionHost ?? ''} onChange={(e) => set('bastionHost', e.target.value || null)} placeholder="bastion.internal.washmen.com" />
          </div>
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Notes</label>
        <input className={inputCls} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value || null)} placeholder="Optional admin notes" />
      </div>

      <div className="flex items-center gap-2">
        <input id="enabled" type="checkbox" checked={form.isEnabled ?? true} onChange={(e) => set('isEnabled', e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-blue-600" />
        <label htmlFor="enabled" className="text-sm text-gray-700 dark:text-gray-300">Enabled (visible to engineers in request forms)</label>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? <Spinner size="sm" /> : null} Save
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800">Cancel</button>
      </div>
    </form>
  );
}

export function JitResourcesPage() {
  const [resources, setResources] = useState<JitResource[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [editing, setEditing]     = useState<JitResource | null | 'new'>(null);
  const [deleting, setDeleting]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setResources(await fetchApi<JitResource[]>('/portal/jit-resources')); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleSave = async (data: Partial<JitResource>) => {
    if (editing === 'new') {
      await fetchApi('/portal/jit-resources', { method: 'POST', body: JSON.stringify(data) });
    } else if (editing) {
      await fetchApi(`/portal/jit-resources/${editing.resourceId}`, { method: 'PUT', body: JSON.stringify(data) });
    }
    setEditing(null);
    await load();
  };

  const handleDelete = async (resourceId: string) => {
    if (!confirm('Delete this JIT resource? Existing sessions will not be affected.')) return;
    setDeleting(resourceId);
    try { await fetchApi(`/portal/jit-resources/${resourceId}`, { method: 'DELETE' }); }
    finally { setDeleting(null); await load(); }
  };

  return (
    <div>
      <Link to="/portal" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
        <ChevronLeft className="h-4 w-4" /> Back to Portal
      </Link>

      <div className="mt-4 mb-6 flex items-center justify-between">
        <div>
          <PageHeader title="JIT Resource Catalog" />
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Configure databases and servers engineers can request temporary access to.</p>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> Add resource
        </button>
      </div>

      {editing && (
        <div className="mb-6 rounded-xl border border-blue-100 bg-blue-50/50 p-6 dark:border-blue-900/40 dark:bg-blue-950/20">
          <h3 className="mb-4 font-semibold text-gray-900 dark:text-white">
            {editing === 'new' ? 'New JIT resource' : `Edit: ${editing.name}`}
          </h3>
          <ResourceForm
            initial={editing === 'new' ? {} : editing}
            onSave={handleSave}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : resources.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 py-12 text-center dark:border-gray-700">
          <Database className="mx-auto mb-3 h-8 w-8 text-gray-300" />
          <p className="text-sm text-gray-500">No JIT resources configured yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {resources.map((r) => (
            <div key={r.resourceId} className="flex items-center justify-between rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-900/30">
                  <Database className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{r.name}</p>
                  <p className="text-xs text-gray-500">{r.type} · {r.environment} · {r.region}</p>
                  {r.host && <p className="text-xs text-gray-400">{r.host}{r.dbName ? `/${r.dbName}` : ''}</p>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${r.isEnabled ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' : 'bg-gray-50 text-gray-500 ring-gray-400/20'}`}>
                  {r.isEnabled ? 'Enabled' : 'Disabled'}
                </span>
                <button onClick={() => setEditing(r)} className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800">
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => { void handleDelete(r.resourceId); }}
                  disabled={deleting === r.resourceId}
                  className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/20"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
