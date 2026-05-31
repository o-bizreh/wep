import { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@wep/ui';
import {
  Plus, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2,
  Loader2, Pencil, Trash2, X, Save, TriangleAlert,
} from 'lucide-react';
import { fetchApi } from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type Environment = 'development' | 'staging' | 'production';
const ALL_ENVS: Environment[] = ['development', 'staging', 'production'];

interface EnvKey {
  name: string;
  isSecret: boolean;
  isRequired: boolean;
  description?: string;
  source?: 'parameter-store' | 'secrets-manager' | 'env-file' | 'injected' | '';
  presentInEnv: boolean;
}

interface EnvConfig {
  serviceName: string;
  environment: Environment;
  keys: EnvKey[];
  updatedAt: string;
  updatedBy: string;
}

interface Diff {
  missing: Record<string, string[]>;
  extra: Record<string, string[]>;
  consistent: string[];
}

interface Summary {
  totalServices: number;
  totalKeys: number;
  totalMismatches: number;
  servicesWithMismatches: number;
  configuredEnvironments: string[];
  topMismatchServices: Array<{ serviceName: string; mismatches: number }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ENV_LABELS: Record<Environment, string> = {
  development: 'Dev',
  staging: 'Staging',
  production: 'Prod',
};

const SOURCE_OPTIONS: Array<EnvKey['source']> = [
  '', 'parameter-store', 'secrets-manager', 'env-file', 'injected',
];

function envPill(env: Environment, configured: boolean) {
  const label = ENV_LABELS[env];
  if (configured) {
    return (
      <span
        key={env}
        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300"
      >
        {label}
      </span>
    );
  }
  return (
    <span
      key={env}
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
    >
      {label}
    </span>
  );
}

function mismatchBadge(count: number) {
  if (count === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
      <TriangleAlert className="h-3 w-3" />
      {count} missing key{count !== 1 ? 's' : ''}
    </span>
  );
}

// ─── Key Row in Edit Modal ─────────────────────────────────────────────────────

function KeyRow({
  envKey,
  onChange,
  onDelete,
}: {
  envKey: EnvKey;
  onChange: (updated: EnvKey) => void;
  onDelete: () => void;
}) {
  function update(patch: Partial<EnvKey>) {
    onChange({ ...envKey, ...patch });
  }

  return (
    <tr className="border-b border-zinc-100 dark:border-zinc-800">
      <td className="py-2 pr-2">
        <input
          value={envKey.name}
          onChange={(e) => update({ name: e.target.value.toUpperCase().replace(/\s/g, '_') })}
          placeholder="KEY_NAME"
          className="w-full rounded-lg bg-zinc-100 dark:bg-zinc-800 px-2 py-1.5 text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
      </td>
      <td className="py-2 pr-2">
        <input
          value={envKey.description ?? ''}
          onChange={(e) => update({ description: e.target.value })}
          placeholder="Description"
          className="w-full rounded-lg bg-zinc-100 dark:bg-zinc-800 px-2 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
      </td>
      <td className="py-2 pr-2">
        <select
          value={envKey.source ?? ''}
          onChange={(e) => update({ source: e.target.value as EnvKey['source'] })}
          className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-2 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          {SOURCE_OPTIONS.map((s) => (
            <option key={s ?? '__none'} value={s ?? ''}>
              {s || '—'}
            </option>
          ))}
        </select>
      </td>
      <td className="py-2 pr-2 text-center">
        <input
          type="checkbox"
          checked={envKey.isRequired}
          onChange={(e) => update({ isRequired: e.target.checked })}
          className="rounded accent-teal-500"
        />
      </td>
      <td className="py-2 pr-2 text-center">
        <input
          type="checkbox"
          checked={envKey.isSecret}
          onChange={(e) => update({ isSecret: e.target.checked })}
          className="rounded accent-teal-500"
        />
      </td>
      <td className="py-2 pr-2 text-center">
        <input
          type="checkbox"
          checked={envKey.presentInEnv}
          onChange={(e) => update({ presentInEnv: e.target.checked })}
          className="rounded accent-teal-500"
        />
      </td>
      <td className="py-2 text-center">
        <button
          onClick={onDelete}
          className="text-zinc-400 hover:text-red-500 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────

function EditModal({
  initialServiceName,
  initialEnvironment,
  initialKeys,
  onClose,
  onSaved,
}: {
  initialServiceName: string;
  initialEnvironment: Environment | null;
  initialKeys: EnvKey[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEditing = Boolean(initialServiceName);
  const [serviceName, setServiceName] = useState(initialServiceName);
  const [environment, setEnvironment] = useState<Environment>(initialEnvironment ?? 'development');
  const [keys, setKeys] = useState<EnvKey[]>(initialKeys);
  const [updatedBy, setUpdatedBy] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addKey() {
    setKeys((prev) => [
      ...prev,
      { name: '', isSecret: false, isRequired: false, presentInEnv: true, source: '' },
    ]);
  }

  function updateKey(index: number, updated: EnvKey) {
    setKeys((prev) => prev.map((k, i) => (i === index ? updated : k)));
  }

  function removeKey(index: number) {
    setKeys((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    if (!serviceName.trim()) { setError('Service name is required'); return; }
    if (!updatedBy.trim()) { setError('Updated by is required'); return; }

    const invalidKey = keys.find((k) => !k.name.trim());
    if (invalidKey !== undefined) { setError('All keys must have a name'); return; }

    setSaving(true);
    setError(null);
    try {
      await fetchApi(`/env-config/services/${encodeURIComponent(serviceName.trim())}/${environment}`, {
        method: 'POST',
        body: JSON.stringify({ keys, updatedBy: updatedBy.trim() }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl ring-1 ring-zinc-200 dark:ring-zinc-700">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
          <div>
            <h2 className="font-black text-zinc-900 dark:text-zinc-100">
              {isEditing ? 'Edit Env Config' : 'Register Service'}
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">Values are never stored — only key metadata</p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Service Name</label>
              <input
                value={serviceName}
                onChange={(e) => setServiceName(e.target.value)}
                disabled={isEditing}
                placeholder="e.g. payments-api"
                className="w-full rounded-xl bg-zinc-100 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Environment</label>
              <select
                value={environment}
                onChange={(e) => setEnvironment(e.target.value as Environment)}
                disabled={isEditing}
                className="w-full rounded-xl bg-zinc-100 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50"
              >
                {ALL_ENVS.map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Updated By</label>
            <input
              value={updatedBy}
              onChange={(e) => setUpdatedBy(e.target.value)}
              placeholder="your-username"
              className="w-full rounded-xl bg-zinc-100 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          {/* Key table */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Environment Keys</label>
              <button
                onClick={addKey}
                className="flex items-center gap-1 text-xs font-medium text-teal-600 dark:text-teal-400 hover:underline"
              >
                <Plus className="h-3.5 w-3.5" /> Add Key
              </button>
            </div>
            {keys.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-700 py-6 text-center text-xs text-zinc-400">
                No keys yet — click "Add Key" to register the first one
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-700">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-zinc-50 dark:bg-zinc-800/50 text-left text-zinc-500 dark:text-zinc-400">
                      <th className="px-2 py-2 font-medium">Key Name</th>
                      <th className="px-2 py-2 font-medium">Description</th>
                      <th className="px-2 py-2 font-medium">Source</th>
                      <th className="px-2 py-2 font-medium text-center">Required</th>
                      <th className="px-2 py-2 font-medium text-center">Secret</th>
                      <th className="px-2 py-2 font-medium text-center">Present</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {keys.map((k, i) => (
                      <KeyRow
                        key={i}
                        envKey={k}
                        onChange={(updated) => updateKey(i, updated)}
                        onDelete={() => removeKey(i)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {error && (
            <p className="text-xs text-red-500 dark:text-red-400 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" /> {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-100 dark:border-zinc-800 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Diff View ────────────────────────────────────────────────────────────────

function DiffView({
  serviceName,
  configs,
}: {
  serviceName: string;
  configs: EnvConfig[];
}) {
  const [diff, setDiff] = useState<Diff | null>(null);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState<{ env: Environment; keys: EnvKey[] } | null>(null);

  const fetchDiff = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchApi<Diff>(`/env-config/services/${encodeURIComponent(serviceName)}/diff`);
      setDiff(data);
    } catch {
      setDiff(null);
    } finally {
      setLoading(false);
    }
  }, [serviceName]);

  useEffect(() => {
    void fetchDiff();
  }, [fetchDiff]);

  function openEdit(env: Environment) {
    const config = configs.find((c) => c.environment === env);
    setEditTarget({ env, keys: config?.keys ?? [] });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading diff…
      </div>
    );
  }

  if (!diff) {
    return (
      <div className="py-6 text-center text-sm text-zinc-400">Failed to load diff</div>
    );
  }

  return (
    <>
      {editTarget && (
        <EditModal
          initialServiceName={serviceName}
          initialEnvironment={editTarget.env}
          initialKeys={editTarget.keys}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); void fetchDiff(); }}
        />
      )}
      <div className="grid grid-cols-3 gap-4 pt-4">
        {ALL_ENVS.map((env) => {
          const config = configs.find((c) => c.environment === env);
          const allKeyNames = [
            ...(diff.consistent),
            ...(diff.missing[env] ?? []),
            ...(diff.extra[env] ?? []).filter(
              (k) => !diff.consistent.includes(k) && !(diff.missing[env] ?? []).includes(k),
            ),
          ];
          // Keys only in this env (in extra but not missing here, not consistent)
          const onlyHere = (diff.extra[env] ?? []).filter(
            (k) => !diff.consistent.includes(k),
          );

          return (
            <div key={env} className="rounded-2xl ring-1 ring-zinc-200 dark:ring-zinc-700 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50">
                <span className="text-xs font-black text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
                  {env}
                </span>
                <button
                  onClick={() => openEdit(env)}
                  className="flex items-center gap-1 text-xs text-teal-600 dark:text-teal-400 hover:underline"
                >
                  <Pencil className="h-3 w-3" />
                  {config ? 'Edit' : 'Register'}
                </button>
              </div>

              {!config ? (
                <div className="px-4 py-6 text-center text-xs text-zinc-400">
                  Not configured
                </div>
              ) : allKeyNames.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-zinc-400">
                  No keys registered
                </div>
              ) : (
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {config.keys.map((key) => {
                    const isMissing = (diff.missing[env] ?? []).includes(key.name);
                    const isOnlyHere = onlyHere.includes(key.name);
                    const isConsistent = diff.consistent.includes(key.name);

                    let rowClass = '';
                    let icon: React.ReactNode = null;

                    if (isMissing) {
                      rowClass = 'text-red-600 dark:text-red-400';
                      icon = <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />;
                    } else if (isOnlyHere) {
                      rowClass = 'text-amber-600 dark:text-amber-400';
                      icon = <TriangleAlert className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
                    } else if (isConsistent) {
                      rowClass = 'text-teal-700 dark:text-teal-400';
                      icon = <CheckCircle2 className="h-3.5 w-3.5 text-teal-500 shrink-0" />;
                    } else {
                      rowClass = 'text-zinc-600 dark:text-zinc-400';
                    }

                    return (
                      <li key={key.name} className={`flex items-center gap-2 px-4 py-2 text-xs font-mono ${rowClass}`}>
                        {icon}
                        <span className="truncate">{key.name}</span>
                        {key.isSecret && (
                          <span className="ml-auto shrink-0 text-zinc-400 text-[10px]">secret</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* Show keys missing in this env (present elsewhere) */}
              {(diff.missing[env] ?? []).length > 0 && (
                <ul className="border-t border-dashed border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-800">
                  {(diff.missing[env] ?? []).map((keyName) => (
                    <li key={keyName} className="flex items-center gap-2 px-4 py-2 text-xs font-mono text-red-500 dark:text-red-400 bg-red-50/50 dark:bg-red-950/10">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{keyName}</span>
                      <span className="ml-auto shrink-0 text-[10px] font-sans">missing</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-teal-500" /> Present in all envs ({diff.consistent.length})</span>
        <span className="flex items-center gap-1"><TriangleAlert className="h-3.5 w-3.5 text-amber-500" /> Only in this env</span>
        <span className="flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5 text-red-500" /> Missing here</span>
      </div>
    </>
  );
}

// ─── Service Row ──────────────────────────────────────────────────────────────

function ServiceRow({
  serviceName,
  configs,
  mismatchCount,
  onRefresh,
}: {
  serviceName: string;
  configs: EnvConfig[];
  mismatchCount: number;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const configuredEnvs = new Set(configs.map((c) => c.environment));

  return (
    <div className="rounded-2xl ring-1 ring-zinc-200 dark:ring-zinc-700 overflow-hidden bg-white dark:bg-zinc-900">
      <button
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded
          ? <ChevronDown className="h-4 w-4 text-zinc-400 shrink-0" />
          : <ChevronRight className="h-4 w-4 text-zinc-400 shrink-0" />
        }
        <span className="font-black text-zinc-900 dark:text-zinc-100 text-sm">{serviceName}</span>
        <div className="flex items-center gap-1.5 ml-3">
          {ALL_ENVS.map((e) => envPill(e, configuredEnvs.has(e)))}
        </div>
        <div className="ml-auto">
          {mismatchBadge(mismatchCount)}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-zinc-100 dark:border-zinc-800 px-5 pb-5">
          <DiffView
            serviceName={serviceName}
            configs={configs}
            key={`${serviceName}-${configs.length}`}
          />
          <div className="mt-2 text-right">
            <button
              onClick={() => { onRefresh(); }}
              className="text-xs text-zinc-400 hover:text-teal-500 transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function EnvConfigPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [services, setServices] = useState<string[]>([]);
  const [configsByService, setConfigsByService] = useState<Record<string, EnvConfig[]>>({});
  const [mismatchByService, setMismatchByService] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRegister, setShowRegister] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryData, servicesData] = await Promise.all([
        fetchApi<Summary>('/env-config/summary'),
        fetchApi<{ services: string[] }>('/env-config/services'),
      ]);

      setSummary(summaryData);
      setServices(servicesData.services);

      // Build mismatch map from summary
      const mmMap: Record<string, number> = {};
      for (const { serviceName, mismatches } of summaryData.topMismatchServices) {
        mmMap[serviceName] = mismatches;
      }
      setMismatchByService(mmMap);

      // Load configs for all services in parallel
      const configResults = await Promise.all(
        servicesData.services.map(async (name) => {
          try {
            const configs = await fetchApi<EnvConfig[]>(`/env-config/services/${encodeURIComponent(name)}`);
            return { name, configs };
          } catch {
            return { name, configs: [] };
          }
        }),
      );

      const cfgMap: Record<string, EnvConfig[]> = {};
      for (const { name, configs } of configResults) {
        cfgMap[name] = configs;
      }
      setConfigsByService(cfgMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load env config');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  return (
    <div className="space-y-6 pb-12">
      {showRegister && (
        <EditModal
          initialServiceName=""
          initialEnvironment={null}
          initialKeys={[]}
          onClose={() => setShowRegister(false)}
          onSaved={() => { setShowRegister(false); void loadAll(); }}
        />
      )}

      <div className="mb-2">
        <PageHeader
          title="Environment Config"
          actions={
            <button
              onClick={() => setShowRegister(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-teal-600 text-white hover:bg-teal-700 transition-colors"
            >
              <Plus className="h-4 w-4" /> Register Service
            </button>
          }
        />
        <p className="text-sm text-zinc-500 dark:text-zinc-400 -mt-6">
          Track which env vars each service expects across environments
        </p>
      </div>

      {/* Summary Bar */}
      {summary && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Services Registered', value: summary.totalServices, color: 'text-zinc-900 dark:text-zinc-100' },
            { label: 'Total Keys', value: summary.totalKeys, color: 'text-zinc-900 dark:text-zinc-100' },
            {
              label: 'Services with Mismatches',
              value: summary.servicesWithMismatches,
              color: summary.servicesWithMismatches > 0 ? 'text-red-600 dark:text-red-400' : 'text-teal-600 dark:text-teal-400',
            },
            {
              label: 'Environments Covered',
              value: summary.configuredEnvironments.length,
              color: 'text-zinc-900 dark:text-zinc-100',
            },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              className="rounded-2xl ring-1 ring-zinc-200 dark:ring-zinc-700 bg-white dark:bg-zinc-900 px-5 py-4"
            >
              <div className={`text-2xl font-black ${color}`}>{value}</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-2xl bg-red-50 dark:bg-red-950/20 ring-1 ring-red-200 dark:ring-red-800 px-5 py-4 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-zinc-400">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading…
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && services.length === 0 && (
        <div className="rounded-2xl ring-1 ring-dashed ring-zinc-300 dark:ring-zinc-700 py-16 text-center">
          <div className="text-3xl mb-3">🔑</div>
          <div className="font-black text-zinc-700 dark:text-zinc-300">No services registered yet</div>
          <div className="text-sm text-zinc-400 mt-1 mb-4">Register a service to start tracking its environment variables</div>
          <button
            onClick={() => setShowRegister(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-teal-600 text-white hover:bg-teal-700 transition-colors"
          >
            <Plus className="h-4 w-4" /> Register Service
          </button>
        </div>
      )}

      {/* Service list */}
      {!loading && services.length > 0 && (
        <div className="space-y-3">
          {services.map((serviceName) => (
            <ServiceRow
              key={serviceName}
              serviceName={serviceName}
              configs={configsByService[serviceName] ?? []}
              mismatchCount={mismatchByService[serviceName] ?? 0}
              onRefresh={loadAll}
            />
          ))}
        </div>
      )}
    </div>
  );
}
