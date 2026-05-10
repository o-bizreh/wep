import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { PageHeader, Spinner } from '@wep/ui';
import { ChevronLeft, CheckCircle, AlertCircle, Search, Check } from 'lucide-react';
import { fetchApi, portalApi } from '../../lib/api';

// ── Types (mirrors domain entity) ─────────────────────────────────────────────

interface ParameterDefinition {
  name: string;
  label: string;
  type: 'string' | 'select' | 'boolean' | 'serviceSelector' | 'environmentSelector' | 'teamSelector' | 'jitResourceSelector' | 'awsResourceSelector' | 'githubRepoSelector';
  required: boolean;
  defaultValue?: string;
  helpText?: string;
  options?: Array<{ label: string; value: string }>;
  validationRegex?: string;
}

interface JitResource {
  resourceId: string;
  name: string;
  type: string;
  environment: string;
  isEnabled: boolean;
}

interface Operation {
  operationId: string;
  name: string;
  description: string;
  category: string;
  tier: string;
  isEnabled: boolean;
  parameters: ParameterDefinition[];
  estimatedDuration: string;
  requiredPermissions: string;
  /** Dispatch kind. Determines whether the operation issues credentials. */
  kind?: 'aws-action' | 'db-credentials' | 'runbook';
}

const tierConfig: Record<string, { label: string; classes: string }> = {
  'self-serve':      { label: 'Self-serve',    classes: 'bg-emerald-50 text-emerald-700 ring-emerald-600/10' },
  'peer-approved':   { label: 'Peer approved', classes: 'bg-amber-50 text-amber-700 ring-amber-600/10' },
  'devops-approved': { label: 'DevOps review', classes: 'bg-orange-50 text-orange-700 ring-orange-600/10' },
};

const ENVIRONMENTS = [
  { label: 'Development', value: 'Development' },
  { label: 'Production',  value: 'Production' },
];

// ── Field components ───────────────────────────────────────────────────────────

function FieldWrapper({ label, helpText, required, children }: {
  label: string; helpText?: string; required: boolean; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}{required && <span className="ml-1 text-red-500">*</span>}
      </label>
      {children}
      {helpText && <p className="mt-1 text-xs text-gray-400">{helpText}</p>}
    </div>
  );
}

function StringField({ param, value, onChange }: {
  param: ParameterDefinition; value: string; onChange: (v: string) => void;
}) {
  return (
    <FieldWrapper label={param.label} helpText={param.helpText} required={param.required}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
        placeholder={param.helpText ?? ''}
      />
    </FieldWrapper>
  );
}

function SelectField({ param, value, options, onChange }: {
  param: ParameterDefinition; value: string; options: Array<{ label: string; value: string }>; onChange: (v: string) => void;
}) {
  return (
    <FieldWrapper label={param.label} helpText={param.helpText} required={param.required}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
      >
        <option value="">Select…</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </FieldWrapper>
  );
}

function BooleanField({ param, value, onChange }: {
  param: ParameterDefinition; value: string; onChange: (v: string) => void;
}) {
  return (
    <FieldWrapper label={param.label} helpText={param.helpText} required={param.required}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={value === 'true'}
          onClick={() => onChange(value === 'true' ? 'false' : 'true')}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${value === 'true' ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'}`}
        >
          <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${value === 'true' ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
        <span className="text-sm text-gray-600 dark:text-gray-400">{value === 'true' ? 'Enabled' : 'Disabled'}</span>
      </div>
    </FieldWrapper>
  );
}

// ── AWS resource selector ──────────────────────────────────────────────────────

interface AwsOption { label: string; value: string; sub?: string }

const AWS_RESOURCE_PATHS: Record<string, string> = {
  lambda:   '/aws-resources/lambdas',
  sns:      '/aws-resources/sns/topics',
  sqs:      '/aws-resources/sqs/queues',
  dynamodb: '/aws-resources/dynamodb/tables',
  rds:      '/aws-resources/rds/instances',
  ecs:      '/aws-resources/ecs/services/all',
};

function normaliseOptions(service: string, data: unknown[]): AwsOption[] {
  return (data as Array<Record<string, string>>).map((item) => {
    if (service === 'lambda')   return { label: item['name'] ?? '', value: item['arn'] ?? '',        sub: item['runtime'] };
    if (service === 'sns')      return { label: item['name'] ?? '', value: item['arn'] ?? '' };
    if (service === 'sqs')      return { label: item['name'] ?? '', value: item['url'] ?? item['arn'] ?? '', sub: item['arn'] };
    if (service === 'dynamodb') return { label: item['name'] ?? '', value: item['arn'] ?? '' };
    if (service === 'rds')      return { label: item['identifier'] ?? item['name'] ?? '', value: item['arn'] ?? '', sub: `${item['engine']} · ${item['endpoint']}:${item['port']}` };
    if (service === 'ecs')      return { label: item['serviceName'] ?? item['name'] ?? '', value: item['serviceArn'] ?? item['arn'] ?? '', sub: item['clusterArn'] };
    return { label: String(item['name'] ?? ''), value: String(item['arn'] ?? item['value'] ?? '') };
  });
}

/** Fetch with sessionStorage cache — hit AWS once per browser session per endpoint+environment. */
async function fetchCached<T>(path: string, environment?: string): Promise<T> {
  const fullPath = environment ? `${path}?environment=${encodeURIComponent(environment)}` : path;
  return fetchApi<T>(fullPath);
}

function SearchableAwsSelect({
  options, value, onChange, loading, disabled, placeholder,
}: {
  options: AwsOption[]; value: string; onChange: (v: string) => void;
  loading: boolean; disabled: boolean; placeholder: string;
}) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const containerRef      = useRef<HTMLDivElement>(null);
  const inputRef          = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return q
      ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
      : options;
  }, [options, query]);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleOpen = () => {
    if (disabled || loading) return;
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled || loading}
        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition
          ${disabled || loading
            ? 'cursor-not-allowed border-gray-100 bg-gray-50 text-gray-400 dark:border-gray-800 dark:bg-gray-900/40'
            : 'border-gray-200 bg-white text-gray-900 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-white'}`}
      >
        <span className="truncate">
          {loading ? 'Loading…' : selected ? selected.label : placeholder}
        </span>
        {loading ? <Spinner size="sm" /> : <Search className="h-3.5 w-3.5 shrink-0 text-gray-400" />}
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
          <div className="border-b border-gray-100 p-2 dark:border-gray-700">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or ARN…"
              className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
          </div>
          <ul className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-gray-400">No results</li>
            ) : (
              filtered.map((o) => (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => { onChange(o.value); setOpen(false); setQuery(''); }}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <Check className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${value === o.value ? 'text-blue-600' : 'text-transparent'}`} />
                    <div>
                      <p className="text-sm text-gray-900 dark:text-white">{o.label}</p>
                      {o.sub && <p className="text-xs text-gray-400 font-mono">{o.sub}</p>}
                      <p className="text-xs text-gray-400 font-mono truncate max-w-xs">{o.value}</p>
                    </div>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function AwsResourceField({ param, value, onChange, awsService, fixedService, environment }: {
  param: ParameterDefinition; value: string; onChange: (v: string) => void;
  awsService: string; fixedService?: string; environment?: string;
}) {
  const service = fixedService ?? awsService;
  const [options, setOptions] = useState<AwsOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!service) { setOptions([]); return; }
    const path = AWS_RESOURCE_PATHS[service];
    if (!path) { setOptions([]); return; }

    setLoading(true);
    onChange(''); // reset when service or environment changes
    fetchCached<unknown[]>(path, environment || undefined)
      .then((data) => setOptions(normaliseOptions(service, data)))
      .catch(() => setOptions([]))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, environment]);

  return (
    <FieldWrapper label={param.label} helpText={param.helpText} required={param.required}>
      <SearchableAwsSelect
        options={options}
        value={value}
        onChange={onChange}
        loading={loading}
        disabled={!service}
        placeholder={service ? `Select ${service} resource…` : 'Select a service first'}
      />
    </FieldWrapper>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function PortalRequestPage() {
  const { operationId } = useParams<{ operationId: string }>();
  const navigate = useNavigate();

  const [operation, setOperation] = useState<Operation | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [values, setValues]       = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted]   = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [jitResources, setJitResources] = useState<JitResource[]>([]);
  const [awsUsername, setAwsUsername] = useState('');
  const [durationMinutes, setDurationMinutes] = useState<number>(60);
  const [durationRaw, setDurationRaw] = useState('60');
  const [justification, setJustification] = useState('');

  const fetchOperation = useCallback(async () => {
    if (!operationId) return;
    setLoading(true);
    setError(null);
    try {
      // The home page list already has all operations; fetch it and find the right one
      // so we benefit from the same default-catalog merge logic on the server.
      const all = await fetchApi<Operation[]>('/portal/operations');
      const op  = all.find((o) => o.operationId === operationId) ?? null;
      if (!op) { setError('Operation not found.'); return; }
      setOperation(op);
      // Seed defaults — environmentSelector defaults to Production
      const defaults: Record<string, string> = {};
      for (const p of op.parameters) {
        if (p.type === 'environmentSelector') {
          defaults[p.name] = p.defaultValue || 'Production';
        } else {
          defaults[p.name] = p.defaultValue ?? '';
        }
      }
      setValues(defaults);
      // Fetch JIT resources if operation uses jitResourceSelector
      if (op.parameters.some((p) => p.type === 'jitResourceSelector')) {
        fetchApi<JitResource[]>('/portal/jit-resources')
          .then((resources) => setJitResources(resources.filter((r) => r.isEnabled)))
          .catch(() => undefined);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load operation');
    } finally {
      setLoading(false);
    }
  }, [operationId]);

  useEffect(() => { void fetchOperation(); }, [fetchOperation]);

  // Pre-fill AWS username from the user's profile so they don't have to re-enter it
  // for every credential request. They can still override below if they want a
  // different RoleSessionName for CloudTrail.
  useEffect(() => {
    portalApi.getMyProfile()
      .then((p) => { if (p.awsUsername) setAwsUsername(p.awsUsername); })
      .catch(() => undefined);
  }, []);

  const setValue = (name: string, val: string) =>
    setValues((prev) => ({ ...prev, [name]: val }));

  const validate = (): boolean => {
    if (!operation) return false;
    for (const p of operation.parameters) {
      if (p.required && !values[p.name]) return false;
      if (p.validationRegex && values[p.name] && !new RegExp(p.validationRegex).test(values[p.name]!)) return false;
    }
    return true;
  };

  // Operations of kind 'aws-action' or 'db-credentials' issue short-lived
  // credentials — the duration + AWS username fields only matter for those.
  const needsCredentials = operation?.kind === 'aws-action' || operation?.kind === 'db-credentials';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!operation || !validate()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Identity is derived server-side from the AWS credentials in Settings.
      // We still pass the email if we have it cached from the role endpoint,
      // but the server resolves it authoritatively from STS.
      const identity = await portalApi.getRole().catch(() => null);
      await fetchApi('/portal/requests', {
        method: 'POST',
        body: JSON.stringify({
          operationType: operation.operationId,
          requesterEmail: identity?.email ?? null,
          parameters: values,
          requesterAwsUsername: awsUsername.trim() || undefined,
          durationMinutes: needsCredentials ? durationMinutes : undefined,
          justification: justification.trim() || undefined,
        }),
      });
      setSubmitted(true);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div>
        <BackLink />
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      </div>
    );
  }

  if (error || !operation) {
    return (
      <div>
        <BackLink />
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950/20">
          <p className="font-medium text-red-700 dark:text-red-400">{error ?? 'Operation not found'}</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div>
        <BackLink />
        <div className="mt-10 flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
            <CheckCircle className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="text-xl font-semibold text-gray-900 dark:text-white">Request submitted</p>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Your request for <strong>{operation.name}</strong> has been submitted
            {operation.tier !== 'self-serve' && ' and is pending approval'}.
          </p>
          <Link
            to="/portal"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Back to Portal
          </Link>
        </div>
      </div>
    );
  }

  const tier = tierConfig[operation.tier] ?? { label: operation.tier, classes: 'bg-gray-50 text-gray-600 ring-gray-500/10' };

  return (
    <div>
      <BackLink />

      <div className="mt-4 mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{operation.name}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{operation.description}</p>
        </div>
        <span className={`ml-4 mt-1 shrink-0 inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${tier.classes}`}>
          {tier.label}
        </span>
      </div>

      {/* Meta info */}
      <div className="mb-6 flex flex-wrap gap-4 text-xs text-gray-400">
        <span>Estimated duration: <strong className="text-gray-600 dark:text-gray-300">{operation.estimatedDuration}</strong></span>
        <span>·</span>
        <span>Required permissions: <strong className="text-gray-600 dark:text-gray-300 capitalize">{operation.requiredPermissions.replace(/-/g, ' ')}</strong></span>
      </div>

      <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-5 rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        {/* Sort so environmentSelector always renders before awsResourceSelector fields
            that depend on it for the resource dropdown fetch. */}
        {[...operation.parameters].sort((a, b) => {
          const rank = (t: string) => t === 'environmentSelector' ? 0 : t === 'awsResourceSelector' ? 2 : 1;
          return rank(a.type) - rank(b.type);
        }).map((param) => {
          const value = values[param.name] ?? '';

          // For resource-access, hide RDS-only fields when the ARN isn't an RDS ARN
          if (operation.operationId === 'resource-access' && (param.name === 'dbName' || param.name === 'accessLevel')) {
            const arn = values['resourceArn'] ?? '';
            if (!arn.startsWith('arn:aws') || !arn.split(':')[2]?.startsWith('rds')) return null;
          }

          if (param.type === 'boolean') {
            return <BooleanField key={param.name} param={param} value={value} onChange={(v) => setValue(param.name, v)} />;
          }
          if (param.type === 'select') {
            return <SelectField key={param.name} param={param} value={value} options={param.options ?? []} onChange={(v) => setValue(param.name, v)} />;
          }
          if (param.type === 'environmentSelector') {
            return <SelectField key={param.name} param={param} value={value} options={ENVIRONMENTS} onChange={(v) => setValue(param.name, v)} />;
          }
          if (param.type === 'jitResourceSelector') {
            const grouped = jitResources.reduce<Record<string, JitResource[]>>((acc, r) => {
              const key = r.environment;
              (acc[key] ??= []).push(r);
              return acc;
            }, {});
            return (
              <FieldWrapper key={param.name} label={param.label} helpText={param.helpText} required={param.required}>
                <select
                  value={value}
                  onChange={(e) => setValue(param.name, e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                >
                  <option value="">Select a database…</option>
                  {Object.entries(grouped).map(([env, resources]) => (
                    <optgroup key={env} label={env.toUpperCase()}>
                      {resources.map((r) => (
                        <option key={r.resourceId} value={r.name}>
                          {r.name} ({r.type})
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </FieldWrapper>
            );
          }
          if (param.type === 'awsResourceSelector') {
            // Derive the AWS service from the parameter name to attempt a dropdown,
            // but fall back to a plain ARN text input when no service can be inferred
            // (e.g. queueUrl, topicArn, tableArn, functionArn — all self-describing).
            const SERVICE_BY_PARAM: Record<string, string> = {
              rdsInstanceArn: 'rds', tableArn: 'dynamodb', topicArn: 'sns',
              queueUrl: 'sqs', functionArn: 'lambda', functionName: 'lambda',
            };
            const inferredService = SERVICE_BY_PARAM[param.name] ?? values['awsService'] ?? '';
            if (inferredService) {
              return (
                <AwsResourceField
                  key={param.name}
                  param={param}
                  value={value}
                  onChange={(v) => setValue(param.name, v)}
                  awsService={inferredService}
                  fixedService={inferredService}
                  environment={values['environment'] || undefined}
                />
              );
            }
            // No service inferred — plain ARN/URL text input
            return <StringField key={param.name} param={{ ...param, helpText: param.helpText || 'Enter the full ARN or resource URL' }} value={value} onChange={(v) => setValue(param.name, v)} />;
          }
          if (param.type === 'serviceSelector' || param.type === 'teamSelector') {
            return <StringField key={param.name} param={{ ...param, helpText: param.type === 'serviceSelector' ? 'Enter service ID or name' : 'Enter team ID or name' }} value={value} onChange={(v) => setValue(param.name, v)} />;
          }
          if (param.type === 'githubRepoSelector') {
            // GitHub repo selector — full implementation planned; plain text input for now
            return <StringField key={param.name} param={{ ...param, helpText: 'Enter the repository name (e.g. washmen-backend). Full selector coming soon.' }} value={value} onChange={(v) => setValue(param.name, v)} />;
          }
          return <StringField key={param.name} param={param} value={value} onChange={(v) => setValue(param.name, v)} />;
        })}

        {/* Credential-issuing operations need a duration cap and pin who's accountable
            on the resulting STS RoleSessionName. Runbook operations don't issue creds,
            so these fields are hidden for them. */}
        {needsCredentials && (
          <div className="grid gap-4 sm:grid-cols-2 rounded-lg border border-cyan-500/20 bg-cyan-50/30 dark:bg-cyan-500/5 p-4">
            <FieldWrapper label="Duration (minutes)" required={true} helpText="How long the issued credentials remain valid. Capped by the operation's auto-approval rule (default 60 min, hard max 720 min).">
              <input
                type="number"
                min={5}
                max={720}
                step={5}
                value={durationRaw}
                onChange={(e) => setDurationRaw(e.target.value)}
                onBlur={(e) => {
                  const n = parseInt(e.target.value, 10);
                  const clamped = Number.isFinite(n) ? Math.max(5, Math.min(720, n)) : 60;
                  setDurationMinutes(clamped);
                  setDurationRaw(String(clamped));
                }}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              />
            </FieldWrapper>
            <FieldWrapper label="AWS Username" required={false} helpText="Used as the STS RoleSessionName so CloudTrail records you as the actor. Pre-filled from your profile.">
              <input
                type="text"
                value={awsUsername}
                onChange={(e) => setAwsUsername(e.target.value)}
                placeholder="e.g. omar.bizreh"
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              />
            </FieldWrapper>
          </div>
        )}

        <FieldWrapper label="Justification" required={false} helpText="Optional — included in the Slack approval message and the audit log.">
          <textarea
            rows={2}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Why do you need this access?"
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          />
        </FieldWrapper>

        {submitError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/20">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
            <p className="text-sm text-red-700 dark:text-red-400">{submitError}</p>
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting || !validate()}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? <Spinner size="sm" /> : null}
            Submit request
          </button>
          <button
            type="button"
            onClick={() => navigate('/portal')}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/portal"
      className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
    >
      <ChevronLeft className="h-4 w-4" /> Back to Portal
    </Link>
  );
}
