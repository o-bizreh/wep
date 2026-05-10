import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { PageHeader, Spinner } from '@wep/ui';
import { ChevronLeft, Plus, Trash2, GripVertical } from 'lucide-react';
import { fetchApi } from '../../lib/api';

interface JitResourceOption { jitResourceId: string; name: string; type: string; allowedPostgresRoles?: string[]; allowedDbUsers?: string[]; }

type OperationCategory = 'access' | 'infrastructure' | 'development' | 'configuration';
type OperationTier = 'self-serve' | 'peer-approved' | 'devops-approved';
type OperationKind = 'runbook' | 'aws-action' | 'db-credentials';
type ParameterType = 'string' | 'select' | 'boolean' | 'serviceSelector' | 'environmentSelector' | 'teamSelector';

interface SelectOption { label: string; value: string; }

interface ParameterDef {
  name: string;
  label: string;
  type: ParameterType;
  required: boolean;
  defaultValue: string;
  helpText: string;
  validationRegex: string;
  options: SelectOption[];
}

interface AutoApprovalRuleForm {
  description: string;
  requesterDepartment: string[];
  requesterUserType: string[];
  resourceOwnerTagEquals: string;
  resourceOwnerTagKey: string;
  parameterEquals: Array<{ key: string; value: string }>;
  maxDurationMinutes: number | null;
  workingHoursOnly: boolean;
  excludeRequesterIds: string[];
}

interface AutoApprovalForm {
  enabled: boolean;
  rules: AutoApprovalRuleForm[];
}

interface AwsActionForm {
  actions: string;          // comma-separated in the editor, split to array on save
  resourceArn: string;      // fixed ARN, or empty if using parameter
  resourceArnParameter: string; // parameter name holding the ARN
  maxDurationMinutes: number;
  issueConsoleLink: boolean;
}

interface DbCredentialsForm {
  jitResourceId: string;
  allowedRoles: string[];
  maxDurationMinutes: number;
}

interface OperationForm {
  operationId: string;
  name: string;
  description: string;
  category: OperationCategory;
  kind: OperationKind;
  tier: OperationTier;
  isEnabled: boolean;
  executor: string;
  requiredPermissions: string;
  estimatedDuration: string;
  parameters: ParameterDef[];
  awsAction: AwsActionForm;
  dbCredentials: DbCredentialsForm;
  autoApproval: AutoApprovalForm;
}

const EMPTY_RULE: AutoApprovalRuleForm = {
  description: '',
  requesterDepartment: [],
  requesterUserType: [],
  resourceOwnerTagEquals: '',
  resourceOwnerTagKey: '',
  parameterEquals: [],
  maxDurationMinutes: 60,
  workingHoursOnly: false,
  excludeRequesterIds: [],
};

const EMPTY_PARAM: ParameterDef = {
  name: '', label: '', type: 'string', required: true,
  defaultValue: '', helpText: '', validationRegex: '', options: [],
};

const EMPTY_AWS_ACTION: AwsActionForm = {
  actions: '',
  resourceArn: '',
  resourceArnParameter: '',
  maxDurationMinutes: 60,
  issueConsoleLink: false,
};

const EMPTY_DB_CREDS: DbCredentialsForm = {
  jitResourceId: '',
  allowedRoles: [],
  maxDurationMinutes: 60,
};

const emptyForm = (): OperationForm => ({
  operationId: '', name: '', description: '',
  category: 'configuration', kind: 'runbook', tier: 'self-serve',
  isEnabled: true, executor: '', requiredPermissions: 'any-engineer',
  estimatedDuration: '', parameters: [],
  awsAction: { ...EMPTY_AWS_ACTION },
  dbCredentials: { ...EMPTY_DB_CREDS },
  autoApproval: { enabled: false, rules: [] },
});

function commaList(values: string[]): string { return values.join(', '); }
function parseCommaList(s: string): string[] {
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function FormField({ label, required, children, hint }: { label: string; required?: boolean; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}{required && <span className="ml-1 text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, disabled }: { value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean }) {
  return (
    <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled}
      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white" />
  );
}

function Select({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white">
      {children}
    </select>
  );
}

function ParameterEditor({ param, index, onChange, onDelete }: {
  param: ParameterDef; index: number;
  onChange: (index: number, updated: ParameterDef) => void;
  onDelete: (index: number) => void;
}) {
  const set = (field: keyof ParameterDef, value: unknown) =>
    onChange(index, { ...param, [field]: value });

  const addOption = () => set('options', [...param.options, { label: '', value: '' }]);
  const updateOption = (i: number, field: 'label' | 'value', v: string) => {
    const opts = [...param.options];
    opts[i] = { ...opts[i]!, [field]: v };
    set('options', opts);
  };
  const removeOption = (i: number) => set('options', param.options.filter((_, idx) => idx !== i));

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-gray-300" />
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Parameter {index + 1}</span>
        </div>
        <button type="button" onClick={() => onDelete(index)} className="text-red-400 hover:text-red-600">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Internal name" required>
          <TextInput value={param.name} onChange={(v) => set('name', slugify(v))} placeholder="camelCase or kebab-case" />
        </FormField>
        <FormField label="Display label" required>
          <TextInput value={param.label} onChange={(v) => set('label', v)} placeholder="Shown to the user" />
        </FormField>
        <FormField label="Type" required>
          <Select value={param.type} onChange={(v) => set('type', v as ParameterType)}>
            <option value="string">Text input</option>
            <option value="select">Dropdown</option>
            <option value="boolean">Toggle</option>
            <option value="environmentSelector">Environment selector</option>
            <option value="serviceSelector">Service selector</option>
            <option value="teamSelector">Team selector</option>
          </Select>
        </FormField>
        <FormField label="Required">
          <Select value={param.required ? 'true' : 'false'} onChange={(v) => set('required', v === 'true')}>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </Select>
        </FormField>
        <FormField label="Help text" hint="Shown below the input">
          <TextInput value={param.helpText} onChange={(v) => set('helpText', v)} placeholder="Optional guidance" />
        </FormField>
        <FormField label="Default value">
          <TextInput value={param.defaultValue} onChange={(v) => set('defaultValue', v)} placeholder="Pre-filled value" />
        </FormField>
        {param.type === 'string' && (
          <FormField label="Validation regex" hint="e.g. ^[a-z0-9-]+$">
            <TextInput value={param.validationRegex} onChange={(v) => set('validationRegex', v)} placeholder="Optional" />
          </FormField>
        )}
      </div>

      {param.type === 'select' && (
        <div className="mt-3">
          <p className="mb-2 text-xs font-medium text-gray-500">Dropdown options</p>
          {param.options.map((opt, i) => (
            <div key={i} className="mb-2 flex items-center gap-2">
              <TextInput value={opt.label} onChange={(v) => updateOption(i, 'label', v)} placeholder="Label" />
              <TextInput value={opt.value} onChange={(v) => updateOption(i, 'value', v)} placeholder="Value" />
              <button type="button" onClick={() => removeOption(i)} className="text-red-400 hover:text-red-600 shrink-0">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button type="button" onClick={addOption}
            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700">
            <Plus className="h-3 w-3" /> Add option
          </button>
        </div>
      )}
    </div>
  );
}

function RuleEditor({ rule, index, onChange, onDelete }: {
  rule: AutoApprovalRuleForm;
  index: number;
  onChange: (i: number, r: AutoApprovalRuleForm) => void;
  onDelete: (i: number) => void;
}) {
  const set = <K extends keyof AutoApprovalRuleForm>(key: K, value: AutoApprovalRuleForm[K]) =>
    onChange(index, { ...rule, [key]: value });

  return (
    <div className="rounded-xl border border-cyan-500/20 bg-cyan-50/30 dark:bg-cyan-500/5 p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1">
          <FormField label={`Rule ${index + 1} description`} required hint="Shown in audit posts and request UI when this rule fires.">
            <TextInput value={rule.description} onChange={(v) => set('description', v)} placeholder="Domain leads can self-approve their own data" />
          </FormField>
        </div>
        <button type="button" onClick={() => onDelete(index)} className="mt-7 text-red-400 hover:text-red-600" title="Delete rule">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-400">Match (all required)</p>
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label="Requester department(s)" hint="Comma-separated. Empty = any.">
            <TextInput value={commaList(rule.requesterDepartment)} onChange={(v) => set('requesterDepartment', parseCommaList(v))} placeholder="Customer, Payment" />
          </FormField>
          <FormField label="Requester userType(s)" hint="e.g. DomainLead, SeniorEngineer. Empty = any.">
            <TextInput value={commaList(rule.requesterUserType)} onChange={(v) => set('requesterUserType', parseCommaList(v))} placeholder="DomainLead" />
          </FormField>
          <FormField label="Resource Owner tag equals" hint='Literal value, or sentinel "$requesterDepartment" to match the requester department.'>
            <TextInput value={rule.resourceOwnerTagEquals} onChange={(v) => set('resourceOwnerTagEquals', v)} placeholder="$requesterDepartment" />
          </FormField>
          <FormField label="Tag key" hint="Defaults to 'Owner' when empty.">
            <TextInput value={rule.resourceOwnerTagKey} onChange={(v) => set('resourceOwnerTagKey', v)} placeholder="Owner" />
          </FormField>
        </div>

        {/* parameterEquals — array of key/value pairs */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Parameter constraints</label>
            <button
              type="button"
              onClick={() => set('parameterEquals', [...rule.parameterEquals, { key: '', value: '' }])}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              <Plus className="h-3 w-3" /> Add constraint
            </button>
          </div>
          {rule.parameterEquals.length === 0 ? (
            <p className="text-xs text-gray-400">No parameter constraints. Any request parameter values will match.</p>
          ) : (
            <div className="space-y-2">
              {rule.parameterEquals.map((p, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={p.key}
                    onChange={(e) => set('parameterEquals', rule.parameterEquals.map((x, idx) => idx === i ? { ...x, key: e.target.value } : x))}
                    placeholder="parameter name"
                    className="w-1/3 rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                  />
                  <input
                    value={p.value}
                    onChange={(e) => set('parameterEquals', rule.parameterEquals.map((x, idx) => idx === i ? { ...x, value: e.target.value } : x))}
                    placeholder="value (or comma-separated for OR)"
                    className="flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                  />
                  <button type="button" onClick={() => set('parameterEquals', rule.parameterEquals.filter((_, idx) => idx !== i))} className="text-red-400 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="text-xs font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-400 pt-2">Constraints</p>
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label="Max duration (min)" hint="Reject auto-approval above this duration. Default 60.">
            <input type="number" min={1} max={720} value={rule.maxDurationMinutes ?? ''}
              onChange={(e) => set('maxDurationMinutes', e.target.value ? Number(e.target.value) : null)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white" />
          </FormField>
          <FormField label="Working hours only" hint="UTC 09:00–18:00, Mon–Fri.">
            <Select value={rule.workingHoursOnly ? 'true' : 'false'} onChange={(v) => set('workingHoursOnly', v === 'true')}>
              <option value="false">No — any time</option>
              <option value="true">Yes — business hours only</option>
            </Select>
          </FormField>
          <div className="md:col-span-2">
            <FormField label="Exclude requester IDs (block-list)" hint="Comma-separated emails. Even if other matches pass, these requesters can never auto-approve.">
              <TextInput value={commaList(rule.excludeRequesterIds)} onChange={(v) => set('excludeRequesterIds', parseCommaList(v))} placeholder="contractor@external.com" />
            </FormField>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExecutionSection({ form, setField, jitResources, jitLoading }: {
  form: OperationForm;
  setField: <K extends keyof OperationForm>(key: K, value: OperationForm[K]) => void;
  jitResources: JitResourceOption[];
  jitLoading: boolean;
}) {
  const setAws = (field: keyof AwsActionForm, value: unknown) =>
    setField('awsAction', { ...form.awsAction, [field]: value });
  const setDb = (field: keyof DbCredentialsForm, value: unknown) =>
    setField('dbCredentials', { ...form.dbCredentials, [field]: value });

  const selectedResource = jitResources.find((r) => r.jitResourceId === form.dbCredentials.jitResourceId);
  const availableRoles = selectedResource
    ? (selectedResource.allowedPostgresRoles ?? selectedResource.allowedDbUsers ?? [])
    : [];

  const toggleRole = (role: string) => {
    const roles = form.dbCredentials.allowedRoles;
    setDb('allowedRoles', roles.includes(role) ? roles.filter((r) => r !== role) : [...roles, role]);
  };

  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white/60 p-6 shadow-xl shadow-slate-200/20 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Execution &amp; Fulfillment</h2>
        <p className="mt-0.5 text-xs text-gray-400">How the platform fulfils this request when approved. This drives credential issuance.</p>
      </div>

      <FormField label="Execution type" required>
        <Select value={form.kind} onChange={(v) => setField('kind', v as OperationKind)}>
          <option value="runbook">Runbook only — no credentials issued</option>
          <option value="aws-action">AWS Resource Access — STS AssumeRole + session policy</option>
          <option value="db-credentials">Database Credentials — temporary Postgres / Redshift user</option>
        </Select>
      </FormField>

      {form.kind === 'aws-action' && (
        <div className="mt-4 space-y-4 rounded-xl border border-amber-200/60 bg-amber-50/30 p-4 dark:border-amber-700/30 dark:bg-amber-900/10">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">AWS access config</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">The platform creates a dedicated IAM role per approval, scoped only to the requester and these actions. No pre-provisioned roles needed.</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <FormField label="IAM actions" required hint="Comma-separated, e.g. dynamodb:PutItem, dynamodb:GetItem">
                <TextInput
                  value={form.awsAction.actions}
                  onChange={(v) => setAws('actions', v)}
                  placeholder="dynamodb:PutItem, dynamodb:GetItem, dynamodb:Query"
                />
              </FormField>
            </div>
            <div className="md:col-span-2">
              <FormField label="Resource ARN" hint="Fixed ARN this operation always targets. Leave empty if the requester provides the ARN via a parameter.">
                <TextInput
                  value={form.awsAction.resourceArn}
                  onChange={(v) => setAws('resourceArn', v)}
                  placeholder="arn:aws:dynamodb:eu-west-1:123456789012:table/orders"
                />
              </FormField>
            </div>
            <FormField label="Resource ARN parameter" hint="Parameter name holding the ARN when the requester picks the resource. Used only when Resource ARN above is empty.">
              <TextInput value={form.awsAction.resourceArnParameter} onChange={(v) => setAws('resourceArnParameter', v)} placeholder="tableArn" />
            </FormField>
            <FormField label="Max duration (minutes)" hint="Hard cap: 720.">
              <input type="number" min={1} max={720} value={form.awsAction.maxDurationMinutes}
                onChange={(e) => setAws('maxDurationMinutes', Number(e.target.value))}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white" />
            </FormField>
            <FormField label="Issue AWS Console link">
              <Select value={form.awsAction.issueConsoleLink ? 'true' : 'false'} onChange={(v) => setAws('issueConsoleLink', v === 'true')}>
                <option value="false">No</option>
                <option value="true">Yes — include console switch-role link</option>
              </Select>
            </FormField>
          </div>
        </div>
      )}

      {form.kind === 'db-credentials' && (
        <div className="mt-4 space-y-4 rounded-xl border border-green-200/60 bg-green-50/30 p-4 dark:border-green-700/30 dark:bg-green-900/10">
          <p className="text-xs font-semibold uppercase tracking-wider text-green-700 dark:text-green-400">Database credentials config</p>
          <FormField label="JIT Resource" required hint="The registered database this operation grants access to.">
            {jitLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-400"><Spinner size="sm" /> Loading resources…</div>
            ) : (
              <Select value={form.dbCredentials.jitResourceId} onChange={(v) => { setDb('jitResourceId', v); setDb('allowedRoles', []); }}>
                <option value="">Select a JIT resource…</option>
                {jitResources.map((r) => (
                  <option key={r.jitResourceId} value={r.jitResourceId}>{r.name} ({r.type})</option>
                ))}
              </Select>
            )}
          </FormField>

          {form.dbCredentials.jitResourceId && (
            <FormField label="Allowed roles" required hint="Roles the requester may be granted. Must be configured on the JIT resource.">
              {availableRoles.length === 0 ? (
                <p className="text-xs text-gray-400">No roles configured on this resource. Edit the JIT resource in Settings first.</p>
              ) : (
                <div className="flex flex-wrap gap-2 mt-1">
                  {availableRoles.map((role) => (
                    <label key={role} className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.dbCredentials.allowedRoles.includes(role)}
                        onChange={() => toggleRole(role)}
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">{role}</span>
                    </label>
                  ))}
                </div>
              )}
            </FormField>
          )}

          <FormField label="Max duration (minutes)" hint="Hard cap: 720.">
            <input type="number" min={1} max={720} value={form.dbCredentials.maxDurationMinutes}
              onChange={(e) => setDb('maxDurationMinutes', Number(e.target.value))}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white" />
          </FormField>
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function PortalOperationFormPage() {
  const { operationId } = useParams<{ operationId?: string }>();
  const navigate = useNavigate();
  const isNew = !operationId || operationId === 'new';

  const [form, setForm]         = useState<OperationForm>(emptyForm());
  const [loading, setLoading]   = useState(!isNew);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [autoId, setAutoId]     = useState(true); // auto-generate ID from name on create
  const [jitResources, setJitResources] = useState<JitResourceOption[]>([]);
  const [jitLoading, setJitLoading]     = useState(false);

  useEffect(() => {
    setJitLoading(true);
    fetchApi<JitResourceOption[]>('/portal/jit-resources')
      .then(setJitResources)
      .catch(() => {/* non-fatal */})
      .finally(() => setJitLoading(false));
  }, []);

  const loadOperation = useCallback(async () => {
    if (isNew || !operationId) return;
    setLoading(true);
    try {
      // Server returns AutoApprovalConfig with rules in the wire format; map
      // each rule's array fields + parameterEquals object into the editor's
      // flat form-friendly shape.
      type WireRule = {
        description?: string;
        match?: {
          requesterDepartment?: string[];
          requesterUserType?: string[];
          parameterEquals?: Record<string, string | string[]>;
          resourceOwnerTagEquals?: string;
          resourceOwnerTagKey?: string;
        };
        constraints?: {
          maxDurationMinutes?: number;
          workingHoursOnly?: boolean;
          excludeRequesterIds?: string[];
        };
      };
      type WireOp = OperationForm & {
        autoApproval?: { enabled: boolean; rules: WireRule[] };
        awsAction?: Partial<AwsActionForm>;
        dbCredentials?: Partial<DbCredentialsForm>;
      };

      const all = await fetchApi<WireOp[]>('/portal/operations');
      const op = all.find((o) => o.operationId === operationId);
      if (op) {
        const wireRules: WireRule[] = op.autoApproval?.rules ?? [];
        setForm({
          ...emptyForm(),
          ...op,
          kind: (op.kind as OperationKind) ?? 'runbook',
          awsAction: op.awsAction ? {
            ...EMPTY_AWS_ACTION,
            ...op.awsAction,
            actions: Array.isArray(op.awsAction.actions) ? (op.awsAction.actions as string[]).join(', ') : (op.awsAction.actions as string | undefined ?? ''),
          } : { ...EMPTY_AWS_ACTION },
          dbCredentials: op.dbCredentials
            ? { ...EMPTY_DB_CREDS, ...op.dbCredentials, allowedRoles: op.dbCredentials.allowedRoles ?? [] }
            : { ...EMPTY_DB_CREDS },
          parameters: (op.parameters ?? []).map((p: ParameterDef) => ({
            ...EMPTY_PARAM,
            ...p,
            options: p.options ?? [],
          })),
          autoApproval: {
            enabled: op.autoApproval?.enabled ?? false,
            rules: wireRules.map((r) => ({
              description: r.description ?? '',
              requesterDepartment: r.match?.requesterDepartment ?? [],
              requesterUserType: r.match?.requesterUserType ?? [],
              resourceOwnerTagEquals: r.match?.resourceOwnerTagEquals ?? '',
              resourceOwnerTagKey: r.match?.resourceOwnerTagKey ?? '',
              parameterEquals: Object.entries(r.match?.parameterEquals ?? {}).map(
                ([key, value]) => ({ key, value: Array.isArray(value) ? value.join(', ') : value }),
              ),
              maxDurationMinutes: r.constraints?.maxDurationMinutes ?? null,
              workingHoursOnly: r.constraints?.workingHoursOnly ?? false,
              excludeRequesterIds: r.constraints?.excludeRequesterIds ?? [],
            })),
          },
        });
      } else {
        setError('Operation not found.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [isNew, operationId]);

  useEffect(() => { void loadOperation(); }, [loadOperation]);

  const setField = <K extends keyof OperationForm>(key: K, value: OperationForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleNameChange = (v: string) => {
    setField('name', v);
    if (autoId) setField('operationId', slugify(v));
  };

  const addParameter = () => setForm((prev) => ({ ...prev, parameters: [...prev.parameters, { ...EMPTY_PARAM }] }));
  const updateParam  = (i: number, p: ParameterDef) => setForm((prev) => {
    const params = [...prev.parameters]; params[i] = p; return { ...prev, parameters: params };
  });
  const deleteParam  = (i: number) => setForm((prev) => ({ ...prev, parameters: prev.parameters.filter((_, idx) => idx !== i) }));

  const addRule = () => setForm((prev) => ({
    ...prev,
    autoApproval: {
      enabled: prev.autoApproval.enabled || true,
      rules: [...prev.autoApproval.rules, { ...EMPTY_RULE }],
    },
  }));
  const updateRule = (i: number, r: AutoApprovalRuleForm) => setForm((prev) => {
    const rules = [...prev.autoApproval.rules]; rules[i] = r;
    return { ...prev, autoApproval: { ...prev.autoApproval, rules } };
  });
  const deleteRule = (i: number) => setForm((prev) => ({
    ...prev,
    autoApproval: { ...prev.autoApproval, rules: prev.autoApproval.rules.filter((_, idx) => idx !== i) },
  }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.operationId || !form.name) return;
    setSaving(true);
    setError(null);
    try {
      // Translate the editor's flat rule shape back to the wire AutoApprovalConfig.
      // Empty optional fields are omitted so the server doesn't store noise.
      const autoApproval = form.autoApproval.rules.length === 0 && !form.autoApproval.enabled
        ? undefined
        : {
            enabled: form.autoApproval.enabled,
            rules: form.autoApproval.rules.map((r) => {
              const match: Record<string, unknown> = {};
              if (r.requesterDepartment.length > 0) match['requesterDepartment'] = r.requesterDepartment;
              if (r.requesterUserType.length > 0) match['requesterUserType'] = r.requesterUserType;
              if (r.resourceOwnerTagEquals) match['resourceOwnerTagEquals'] = r.resourceOwnerTagEquals;
              if (r.resourceOwnerTagKey) match['resourceOwnerTagKey'] = r.resourceOwnerTagKey;
              if (r.parameterEquals.length > 0) {
                match['parameterEquals'] = Object.fromEntries(
                  r.parameterEquals.filter((p) => p.key.trim()).map((p) => {
                    const values = parseCommaList(p.value);
                    return [p.key.trim(), values.length > 1 ? values : (values[0] ?? '')];
                  }),
                );
              }
              const constraints: Record<string, unknown> = {};
              if (r.maxDurationMinutes != null) constraints['maxDurationMinutes'] = r.maxDurationMinutes;
              if (r.workingHoursOnly) constraints['workingHoursOnly'] = true;
              if (r.excludeRequesterIds.length > 0) constraints['excludeRequesterIds'] = r.excludeRequesterIds;
              const rule: Record<string, unknown> = { description: r.description, match };
              if (Object.keys(constraints).length > 0) rule['constraints'] = constraints;
              return rule;
            }),
          };

      const executionConfig: Record<string, unknown> = { kind: form.kind };
      if (form.kind === 'aws-action') {
        executionConfig['awsAction'] = {
          actions: form.awsAction.actions.split(',').map((a) => a.trim()).filter(Boolean),
          resourceArn: form.awsAction.resourceArn || undefined,
          resourceArnParameter: form.awsAction.resourceArnParameter || undefined,
          maxDurationMinutes: form.awsAction.maxDurationMinutes,
          issueConsoleLink: form.awsAction.issueConsoleLink || undefined,
        };
      } else if (form.kind === 'db-credentials') {
        executionConfig['dbCredentials'] = {
          jitResourceId: form.dbCredentials.jitResourceId,
          allowedRoles: form.dbCredentials.allowedRoles,
          maxDurationMinutes: form.dbCredentials.maxDurationMinutes,
        };
      }

      const payload = { ...form, ...executionConfig, autoApproval };
      if (isNew) {
        await fetchApi('/portal/operations', { method: 'POST', body: JSON.stringify(payload) });
      } else {
        await fetchApi(`/portal/operations/${form.operationId}`, { method: 'PUT', body: JSON.stringify(payload) });
      }
      navigate('/portal/operations/manage');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-16"><Spinner size="lg" /></div>;

  return (
    <div>
      <Link to="/portal/operations/manage" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
        <ChevronLeft className="h-4 w-4" /> Manage Operations
      </Link>

      <div className="mt-4">
        <PageHeader title={isNew ? 'New Operation' : `Edit: ${form.name}`} />
      </div>

      <form onSubmit={(e) => { void handleSubmit(e); }} className="mt-4 space-y-6">
        {/* Basic info */}
        <div className="rounded-2xl border border-slate-200/60 bg-white/60 p-6 shadow-xl shadow-slate-200/20 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40">
          <h2 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-200">Basic Info</h2>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Operation name" required>
              <TextInput value={form.name} onChange={handleNameChange} placeholder="Request Repo Access" />
            </FormField>
            <FormField label="Operation ID" required hint={isNew ? 'Auto-generated from name. Edit to customise.' : 'Cannot change after creation.'}>
              <TextInput value={form.operationId} onChange={(v) => { setAutoId(false); setField('operationId', slugify(v)); }} disabled={!isNew} />
            </FormField>
            <div className="col-span-2">
              <FormField label="Description" required>
                <textarea value={form.description} onChange={(e) => setField('description', e.target.value)} rows={2}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white" />
              </FormField>
            </div>
            <FormField label="Category" required>
              <Select value={form.category} onChange={(v) => setField('category', v as OperationCategory)}>
                <option value="access">Access</option>
                <option value="infrastructure">Infrastructure</option>
                <option value="development">Development</option>
                <option value="configuration">Configuration</option>
              </Select>
            </FormField>
            <FormField label="Approval tier" required>
              <Select value={form.tier} onChange={(v) => setField('tier', v as OperationTier)}>
                <option value="self-serve">Self-serve (no approval needed)</option>
                <option value="peer-approved">Peer approved</option>
                <option value="devops-approved">DevOps review</option>
              </Select>
            </FormField>
            <FormField label="Required permissions">
              <Select value={form.requiredPermissions} onChange={(v) => setField('requiredPermissions', v)}>
                <option value="any-engineer">Any engineer</option>
                <option value="team-member-of-service-owner">Team member of service owner</option>
                <option value="domain-lead">Domain lead</option>
                <option value="devops">DevOps</option>
              </Select>
            </FormField>
            <FormField label="Estimated duration" hint="Shown to requester, e.g. ~5 min">
              <TextInput value={form.estimatedDuration} onChange={(v) => setField('estimatedDuration', v)} placeholder="~5 min" />
            </FormField>
            <FormField label="Enabled">
              <Select value={form.isEnabled ? 'true' : 'false'} onChange={(v) => setField('isEnabled', v === 'true')}>
                <option value="true">Yes — visible to engineers</option>
                <option value="false">No — hidden from portal</option>
              </Select>
            </FormField>
          </div>
        </div>

        {/* Parameters */}
        <div className="rounded-2xl border border-slate-200/60 bg-white/60 p-6 shadow-xl shadow-slate-200/20 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Parameters</h2>
            <button type="button" onClick={addParameter}
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:border-blue-800 dark:hover:bg-blue-950/20">
              <Plus className="h-3.5 w-3.5" /> Add parameter
            </button>
          </div>
          {form.parameters.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-6">No parameters. Click "Add parameter" to define inputs for this operation.</p>
          ) : (
            <div className="space-y-3">
              {form.parameters.map((p, i) => (
                <ParameterEditor key={i} param={p} index={i} onChange={updateParam} onDelete={deleteParam} />
              ))}
            </div>
          )}
        </div>

        {/* Execution & Fulfillment */}
        <ExecutionSection form={form} setField={setField} jitResources={jitResources} jitLoading={jitLoading} />

        {/* Auto-approval rules */}
        <div className="rounded-2xl border border-slate-200/60 bg-white/60 p-6 shadow-xl shadow-slate-200/20 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Auto-approval rules</h2>
              <p className="mt-0.5 text-xs text-gray-400">First matching rule wins. Disable the master toggle to force every request through manual approval.</p>
            </div>
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={form.autoApproval.enabled}
                  onChange={(e) => setField('autoApproval', { ...form.autoApproval, enabled: e.target.checked })}
                />
                Enabled
              </label>
              <button type="button" onClick={addRule}
                className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-200 px-3 py-1.5 text-xs font-medium text-cyan-700 hover:bg-cyan-50 dark:border-cyan-800 dark:text-cyan-300 dark:hover:bg-cyan-950/20">
                <Plus className="h-3.5 w-3.5" /> Add rule
              </button>
            </div>
          </div>
          {form.autoApproval.rules.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-6">
              No auto-approval rules. Every request will go through manual DevOps review.
            </p>
          ) : (
            <div className="space-y-3">
              {form.autoApproval.rules.map((r, i) => (
                <RuleEditor key={i} rule={r} index={i} onChange={updateRule} onDelete={deleteRule} />
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20">{error}</div>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving || !form.operationId || !form.name}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? <Spinner size="sm" /> : null}
            {isNew ? 'Create Operation' : 'Save Changes'}
          </button>
          <button type="button" onClick={() => navigate('/portal/operations/manage')}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
