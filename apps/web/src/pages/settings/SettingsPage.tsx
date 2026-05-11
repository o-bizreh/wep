import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RefreshCw, ShieldCheck, KeyRound, ChevronDown, ChevronUp } from 'lucide-react';
import { Spinner } from '@wep/ui';
import { settingsApi, portalApi, oauthApi, type OAuthStatus, type InfraStatus, type WepUserProfile, type AwsIdentity } from '../../lib/api';
import { settings } from '../../lib/settings';
import { useTheme } from '../../lib/theme';
import { notifyCredentialsChanged } from '../../components/AwsIdentityBadge';
import { useAuth } from '../../lib/auth';

// ─── Shared UI primitives ────────────────────────────────────────────────────

function SectionCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white/60 shadow-xl shadow-slate-200/20 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40">
      <div className="border-b border-slate-200/50 px-6 py-5 dark:border-white/5">
        <h2 className="text-base font-bold text-zinc-900 dark:text-white">{title}</h2>
        {description && <p className="mt-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">{description}</p>}
      </div>
      <div className="px-6 py-5 space-y-4">{children}</div>
    </div>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
      ok ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400 shadow-sm shadow-emerald-500/10'
         : 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400 shadow-sm shadow-red-500/10'
    }`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
      {label}
    </span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{children}</label>;
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`mt-1 block w-full rounded-xl border border-zinc-200/50 bg-white/60 backdrop-blur-xl px-4 py-2.5 text-sm font-bold text-zinc-900 shadow-sm transition-all
        placeholder:text-zinc-400 placeholder:font-medium
        focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20
        dark:border-white/10 dark:bg-zinc-900/40 dark:text-white dark:placeholder:text-zinc-500
        dark:focus:border-cyan-400 dark:focus:ring-cyan-400/20
        disabled:opacity-50 ${props.className ?? ''}`}
    />
  );
}

function Btn({ children, onClick, variant = 'primary', disabled, loading }: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
}) {
  const base = 'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50';
  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600',
    danger:  'bg-red-600 text-white hover:bg-red-700',
    ghost:   'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700',
  };
  return (
    <button onClick={onClick} disabled={disabled || loading} className={`${base} ${variants[variant]}`}>
      {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

// ─── Theme section ───────────────────────────────────────────────────────────

function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  const options = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
  ] as const;

  return (
    <SectionCard title="Appearance" description="Choose how WEP looks on your device.">
      <div className="flex gap-3">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setTheme(opt.value)}
            className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
              theme === opt.value
                ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-300'
                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </SectionCard>
  );
}

// ─── AWS Region section ───────────────────────────────────────────────────────

const COMMON_REGIONS = [
  { label: 'EU (Ireland)       eu-west-1',    value: 'eu-west-1' },
  { label: 'EU (Frankfurt)     eu-central-1', value: 'eu-central-1' },
  { label: 'EU (London)        eu-west-2',    value: 'eu-west-2' },
  { label: 'ME (Bahrain)       me-south-1',   value: 'me-south-1' },
  { label: 'US East (N. Va.)   us-east-1',    value: 'us-east-1' },
  { label: 'US West (Oregon)   us-west-2',    value: 'us-west-2' },
  { label: 'AP (Singapore)     ap-southeast-1', value: 'ap-southeast-1' },
];

function AwsRegionSection({ currentRegion, regionSource, onStatusRefresh }: {
  currentRegion: string | null;
  regionSource: string | null;
  onStatusRefresh: () => void;
}) {
  const [selected, setSelected] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (currentRegion) setSelected(currentRegion);
  }, [currentRegion]);

  async function apply() {
    if (!selected) return;
    setSaving(true);
    try { await settingsApi.setRegion(selected); } catch { /* ok */ }
    setSaved(true);
    setSaving(false);
    onStatusRefresh();
  }

  async function reset() {
    try { await settingsApi.clearRegion(); } catch { /* ok */ }
    setSaved(false);
    onStatusRefresh();
  }

  const isCustom = regionSource === 'override' || saved;

  return (
    <SectionCard
      title="AWS Region"
      description="The region used for all AWS API calls — Lambda, ECS, CloudWatch, SQS, SNS, DynamoDB resource listings and JIT access grants."
    >
      <div className="text-sm text-gray-600 dark:text-gray-400">
        Active region:{' '}
        <span className="font-mono font-bold text-gray-900 dark:text-white">{currentRegion ?? '—'}</span>
        {regionSource === 'environment' && (
          <span className="ml-2 text-xs text-gray-400">(from AWS_REGION env var — override below)</span>
        )}
        {regionSource === 'default' && !isCustom && (
          <span className="ml-2 text-xs text-gray-400">(default: eu-west-1)</span>
        )}
        {isCustom && (
          <span className="ml-2 text-xs text-green-600 dark:text-green-400">(runtime override active)</span>
        )}
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <Label>Select region</Label>
          <select
            value={selected}
            onChange={(e) => { setSelected(e.target.value); setSaved(false); }}
            className="mt-1 block w-full rounded-xl border border-zinc-200/50 bg-white/60 backdrop-blur-xl px-4 py-2.5 text-sm font-bold text-zinc-900 shadow-sm
              dark:border-white/10 dark:bg-zinc-900/40 dark:text-white
              focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
          >
            <option value="">Select…</option>
            {COMMON_REGIONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
        <div className="mt-6 flex gap-2">
          <Btn onClick={apply} disabled={!selected || selected === currentRegion} loading={saving}>Apply</Btn>
          {isCustom && <Btn variant="ghost" onClick={reset}>Reset to default</Btn>}
        </div>
      </div>

      {saved && (
        <p className="text-xs text-green-600 dark:text-green-400">
          ✓ Region updated to <span className="font-mono">{selected}</span> — takes effect on the next AWS call.
        </p>
      )}
    </SectionCard>
  );
}

// ─── JIT Resources note ───────────────────────────────────────────────────────

function JitResourcesSection({ isDevOps }: { isDevOps: boolean }) {
  return (
    <SectionCard
      title="JIT Database Resources"
      description="Databases available for temporary access requests via the Self-Service Portal."
    >
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Before engineers can request JIT database access, DevOps must register the target
        databases (RDS Postgres, EC2 bastion hosts) in the resource registry.
      </p>
      {isDevOps ? (
        <Link
          to="/portal/jit-resources"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Manage JIT Resources →
        </Link>
      ) : (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Only DevOps team members can add or remove JIT resources. Contact your DevOps team to register a new database.
        </p>
      )}
    </SectionCard>
  );
}

// ─── GitHub token section ────────────────────────────────────────────────────

function GitHubSection({ onStatusRefresh }: { onStatusRefresh: () => void }) {
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState(settings.hasGithubToken());
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!token.trim()) return;
    setSaving(true);
    settings.setGithubToken(token.trim());
    try {
      await settingsApi.setGithubToken(token.trim());
    } catch {
      // API unavailable — token still saved in localStorage for next requests
    }
    setSaved(true);
    setToken('');
    setSaving(false);
    onStatusRefresh();

    // On first run: if both GitHub token AND AWS creds are now configured, navigate home.
    if (!settings.hasCompletedFirstRunSetup() && settings.hasAwsCredentials()) {
      settings.setFirstRunSetupDone();
      navigate('/');
    }
  }

  async function clear() {
    settings.setGithubToken(null);
    try { await settingsApi.setGithubToken(null); } catch { /* ok */ }
    setSaved(false);
    onStatusRefresh();
  }

  return (
    <SectionCard
      title="GitHub Token"
      description="Personal access token used for repository crawling, monorepo detection, and artifact downloads. Requires read:org and repo scopes."
    >
      <div className="flex items-center gap-3">
        <StatusPill ok={saved} label={saved ? 'Token configured' : 'Not configured'} />
        {saved && (
          <span className="text-xs text-gray-500 dark:text-gray-400">Token is stored locally — paste a new one to replace it.</span>
        )}
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <Label>
            {saved ? 'Replace token' : 'Personal access token'}
          </Label>
          <Input
            type="password"
            placeholder="ghp_••••••••••••••••••••••••••••••••••••••"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </div>
        <div className="mt-6 flex gap-2">
          <Btn onClick={save} disabled={!token.trim()} loading={saving}>Save</Btn>
          {saved && <Btn variant="ghost" onClick={clear}>Clear</Btn>}
        </div>
      </div>

      {!saved && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          GitHub-dependent features (repo crawling, monorepo detection, manual refresh) are unavailable until a token is configured.
        </p>
      )}
    </SectionCard>
  );
}

// ─── Infrastructure status section ───────────────────────────────────────────

function InfraStatusSection({ status, loading, onRefresh }: {
  status: InfraStatus | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <SectionCard
      title="Infrastructure Status"
      description="Required AWS resources. Missing tables can be created by running: pnpm --filter @wep/api db:tables"
    >
      {loading ? (
        <div className="flex justify-center py-4"><Spinner size="lg" /></div>
      ) : !status ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Could not reach API server.</p>
      ) : (
        <>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">DynamoDB Tables</p>
            {Object.entries(status.dynamodb.tables).map(([context, info]) => (
              <div key={context} className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2 dark:bg-gray-800">
                <div>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{info.tableName}</span>
                </div>
                <StatusPill ok={info.exists} label={info.exists ? 'Exists' : 'Missing'} />
              </div>
            ))}
          </div>

          {!status.dynamodb.allTablesExist && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
              <p className="text-sm text-amber-800 dark:text-amber-300">
                Some tables are missing. Run the following to create them:
              </p>
              <pre className="mt-1 text-xs font-mono text-amber-900 dark:text-amber-200">
                pnpm --filter @wep/api db:tables
              </pre>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              AWS credential source: <span className="font-medium text-gray-900 dark:text-white">{status.credentials.source}</span>
            </div>
            <Btn variant="ghost" onClick={onRefresh}>
              <span className="inline-flex items-center gap-2"><RefreshCw className="h-4 w-4 text-cyan-500" /> Refresh</span>
            </Btn>
          </div>
        </>
      )}
    </SectionCard>
  );
}

// ─── Profile + AWS credentials (merged) ─────────────────────────────────────

interface ParsedCreds {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/**
 * Parses the block AWS CLI / SSO outputs (`aws configure export-credentials` or the
 * console copy box). Handles `export KEY=value` and bare `KEY=value` forms.
 */
function parseExportBlock(raw: string): ParsedCreds | null {
  const map: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const match = line.trim().match(/^(?:export\s+)?([A-Z_]+)=["']?([^"'\s]+)["']?/);
    if (match) map[match[1]!] = match[2]!;
  }
  const accessKeyId = map['AWS_ACCESS_KEY_ID'];
  const secretAccessKey = map['AWS_SECRET_ACCESS_KEY'];
  if (!accessKeyId || !secretAccessKey) return null;
  return { accessKeyId, secretAccessKey, sessionToken: map['AWS_SESSION_TOKEN'] };
}

/**
 * Pulls a usable AWS username from an STS-resolved identity. SSO ARNs encode the
 * user's email or directory username as the RoleSessionName segment, e.g.
 *   arn:aws:sts::123:assumed-role/AWSReservedSSO_Engineer_xxx/omar.bizreh@washmen.com
 * The `displayName` field already comes back as "RoleName / sessionName"; we just
 * extract the session-name half.
 */
function deriveAwsUsernameFromIdentity(identity: AwsIdentity | null): string {
  if (!identity) return '';
  if (identity.principalType === 'iam-user') return identity.displayName;
  if (identity.principalType === 'assumed-role' || identity.principalType === 'federated') {
    const parts = identity.displayName.split(' / ');
    const session = parts[1] ?? identity.displayName;
    // Strip trailing email domain if present, e.g. "omar.bizreh@washmen.com" → "omar.bizreh"
    return session.split('@')[0] ?? session;
  }
  return identity.displayName;
}

/**
 * Extracts the IAM Identity Center PermissionSet name from an SSO assumed-role
 * ARN and uses it as the userType. SSO role names follow the format
 *   AWSReservedSSO_<PermissionSet>_<hash>
 * so e.g. "AWSReservedSSO_DomainLead_a1b2c3" → "DomainLead".
 *
 * Returns an empty string when the identity isn't an SSO session — the user
 * has to set userType manually in that case.
 */
function deriveUserTypeFromIdentity(identity: AwsIdentity | null): string {
  if (!identity || identity.principalType !== 'assumed-role') return '';
  const roleSegment = identity.displayName.split(' / ')[0] ?? '';
  const ssoMatch = roleSegment.match(/^AWSReservedSSO_(.+)_[A-Za-z0-9]+$/);
  if (ssoMatch?.[1]) return ssoMatch[1];
  // Non-SSO assumed role — best-effort: use the role name itself
  return roleSegment;
}

// ─── OAuth connections ───────────────────────────────────────────────────────

function OAuthSection({ onStatusRefresh }: { onStatusRefresh: () => void }) {
  const [status, setStatus] = useState<OAuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<'aws' | 'github' | null>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try { setStatus(await oauthApi.getStatus()); } catch { /* oauth not configured */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    // Check for OAuth callback result in URL
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'success') {
      void load();
      onStatusRefresh();
      navigate('/settings', { replace: true });
    }
  }, [load, navigate, onStatusRefresh]);

  async function disconnect(provider: 'aws' | 'github') {
    setDisconnecting(provider);
    try {
      if (provider === 'aws') await oauthApi.disconnectAws();
      else await oauthApi.disconnectGithub();
      await load();
      onStatusRefresh();
    } finally { setDisconnecting(null); }
  }

  return (
    <SectionCard
      title="Account Connections"
      description="Sign in with AWS SSO and GitHub to authenticate without pasting credentials. Tokens are stored server-side in your session — nothing is saved in the browser."
    >
      {loading ? (
        <div className="flex justify-center py-4"><Spinner size="sm" /></div>
      ) : (
        <div className="space-y-3">
          {/* AWS SSO */}
          <div className="flex items-center justify-between rounded-xl border border-zinc-200/60 bg-zinc-50/50 px-4 py-3 dark:border-white/10 dark:bg-zinc-800/30">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-50 dark:bg-orange-900/30">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#F97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-900 dark:text-white">AWS IAM Identity Center</p>
                {status?.aws.connected ? (
                  <p className="text-xs text-zinc-500">
                    Signed in as <span className="font-mono">{status.aws.username}</span>
                    {status.aws.expiresAt && <> · expires {new Date(status.aws.expiresAt).toLocaleTimeString()}</>}
                  </p>
                ) : (
                  <p className="text-xs text-zinc-500">Not connected</p>
                )}
              </div>
            </div>
            {status?.aws.connected ? (
              <Btn variant="ghost" onClick={() => void disconnect('aws')} loading={disconnecting === 'aws'}>
                Disconnect
              </Btn>
            ) : (
              <a
                href={oauthApi.loginUrlAws()}
                className="inline-flex items-center gap-2 rounded-md bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600"
              >
                Connect AWS
              </a>
            )}
          </div>

          {/* GitHub */}
          <div className="flex items-center justify-between rounded-xl border border-zinc-200/60 bg-zinc-50/50 px-4 py-3 dark:border-white/10 dark:bg-zinc-800/30">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-700/50">
                <svg className="h-5 w-5 text-zinc-800 dark:text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.167 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.741 0 .267.18.579.688.481C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-900 dark:text-white">GitHub</p>
                {status?.github.connected ? (
                  <p className="text-xs text-zinc-500">Signed in as <span className="font-mono">@{status.github.login}</span></p>
                ) : (
                  <p className="text-xs text-zinc-500">Not connected</p>
                )}
              </div>
            </div>
            {status?.github.connected ? (
              <Btn variant="ghost" onClick={() => void disconnect('github')} loading={disconnecting === 'github'}>
                Disconnect
              </Btn>
            ) : (
              <a
                href={oauthApi.loginUrlGithub()}
                className="inline-flex items-center gap-2 rounded-md bg-zinc-800 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-900 dark:bg-zinc-600 dark:hover:bg-zinc-500"
              >
                Connect GitHub
              </a>
            )}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function ProfileSection({ credSource, onStatusRefresh }: {
  credSource: InfraStatus['credentials']['source'] | null;
  onStatusRefresh: () => void;
}) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applyingCreds, setApplyingCreds] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<WepUserProfile | null>(null);
  const [identity, setIdentity] = useState<AwsIdentity | null>(null);
  const [department, setDepartment] = useState('');
  const [userType, setUserType] = useState('');
  const [awsUsername, setAwsUsername] = useState('');
  const [credsExpanded, setCredsExpanded] = useState(false);
  const [raw, setRaw] = useState('');
  const [parseError, setParseError] = useState(false);
  const [autoResolveNote, setAutoResolveNote] = useState<string | null>(null);

  const hasCreds = settings.hasAwsCredentials();
  const parsed = raw.trim() ? parseExportBlock(raw) : null;
  const showParseError = raw.trim().length > 10 && !parsed;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, id] = await Promise.all([
        portalApi.getMyProfile().catch(() => null),
        settingsApi.getIdentity().catch(() => null),
      ]);
      if (p) {
        setProfile(p);
        setDepartment(p.department ?? '');
        setUserType(p.userType ?? '');
        setAwsUsername(p.awsUsername ?? '');
      }
      setIdentity(id);
      // Auto-fill awsUsername from SSO identity when the profile is empty.
      if (id) {
        if (!p?.awsUsername || p.awsUsername.trim() === '') {
          setAwsUsername(deriveAwsUsernameFromIdentity(id));
        }

        // If department or userType is missing, attempt an IAM Identity Center
        // lookup. This is best-effort — the caller's SSO permissions may not
        // allow `identitystore:DescribeUser`.
        const profileIncomplete = !p?.department || !p?.userType;
        if (profileIncomplete) {
          const auto = await portalApi.autoResolveProfile().catch(() => null);
          if (auto && auto.resolved) {
            setProfile(auto.profile);
            if (auto.profile.department) setDepartment(auto.profile.department);
            if (auto.profile.userType)   setUserType(auto.profile.userType);
            if (auto.profile.awsUsername) setAwsUsername(auto.profile.awsUsername);
            setAutoResolveNote(null);
          } else if (auto && !auto.resolved) {
            setAutoResolveNote(auto.reason);
            // Last-resort: parse the PermissionSet name from the ARN.
            if (!p?.userType || p.userType.trim() === '') {
              const derived = deriveUserTypeFromIdentity(id);
              if (derived) setUserType(derived);
            }
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function applyCredentials() {
    if (!parsed) { setParseError(true); return; }
    setParseError(false);
    setApplyingCreds(true);
    settings.setAwsCredentials(parsed);
    try { await settingsApi.setCredentials(parsed); } catch { /* ok */ }
    notifyCredentialsChanged();

    // Auto-fetch identity from STS, auto-fill the profile, and persist.
    try {
      const id = await settingsApi.getIdentity();
      setIdentity(id);
      if (id) {
        const derivedUsername = deriveAwsUsernameFromIdentity(id);
        setAwsUsername(derivedUsername);

        // Try IAM Identity Center first — gives real Title, UserType, group
        // memberships rather than parsing the SSO PermissionSet from the ARN.
        const auto = await portalApi.autoResolveProfile().catch(() => null);
        if (auto && auto.resolved) {
          setProfile(auto.profile);
          if (auto.profile.department) setDepartment(auto.profile.department);
          if (auto.profile.userType)   setUserType(auto.profile.userType);
          if (auto.profile.awsUsername) setAwsUsername(auto.profile.awsUsername);
          setAutoResolveNote(null);
        } else {
          // Fallback: persist what STS alone gives us (awsUsername + displayName)
          const updated = await portalApi.updateMyProfile({
            awsUsername: derivedUsername || undefined,
            displayName: id.displayName || undefined,
          });
          setProfile(updated);
          setAutoResolveNote(
            auto && !auto.resolved
              ? auto.reason
              : 'IAM Identity Center lookup unavailable — fill department/role manually.',
          );
        }
      }
    } catch { /* ok */ }

    setRaw('');
    setCredsExpanded(false);
    setApplyingCreds(false);
    onStatusRefresh();

    // On first run: if both creds AND GitHub token are now configured, navigate home.
    if (!settings.hasCompletedFirstRunSetup() && settings.hasGithubToken()) {
      settings.setFirstRunSetupDone();
      navigate('/');
    }
  }

  async function clearCredentials() {
    settings.setAwsCredentials(null);
    try { await settingsApi.clearCredentials(); } catch { /* ok */ }
    setIdentity(null);
    notifyCredentialsChanged();
    onStatusRefresh();
  }

  async function saveProfile() {
    setSaving(true);
    setError(null);
    try {
      const updated = await portalApi.updateMyProfile({
        department: department.trim() || undefined,
        userType: userType.trim() || undefined,
        awsUsername: awsUsername.trim() || undefined,
      });
      setProfile(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const isProfileFilled = !!(profile?.department && profile?.userType);
  const credsLabel =
    credSource === 'iam-role' ? 'IAM role (production default)' :
    credSource === 'environment' ? 'Environment variables' :
    credSource === 'override' ? 'AWS SSO session keys' : '—';

  return (
    <SectionCard
      title="Your Profile"
      description="Your platform identity. Paste your AWS SSO session keys to auto-fill name and AWS username — then set the department + role used by Act-tab auto-approval rules."
    >
      {/* Identity panel */}
      <div className="rounded-xl border border-cyan-500/20 bg-cyan-50/40 dark:bg-cyan-500/5 p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className={`h-5 w-5 flex-none mt-0.5 ${identity ? 'text-cyan-500' : 'text-zinc-400'}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm font-bold text-zinc-900 dark:text-white">
                {identity ? identity.displayName : 'Sign in with AWS SSO to identify yourself'}
              </p>
              <StatusPill
                ok={!!identity}
                label={identity ? `Active · ${credsLabel}` : 'No active AWS session'}
              />
            </div>
            {identity ? (
              <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-500">Account</dt>
                  <dd className="font-mono text-zinc-700 dark:text-zinc-300 truncate">
                    {identity.account}{identity.accountAlias ? ` (${identity.accountAlias})` : ''}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-500">Type</dt>
                  <dd className="font-mono text-zinc-700 dark:text-zinc-300">{identity.principalType}</dd>
                </div>
                <div className="col-span-full flex justify-between gap-2">
                  <dt className="text-zinc-500">ARN</dt>
                  <dd className="font-mono text-[10px] text-zinc-500 dark:text-zinc-500 truncate">{identity.arn}</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                In production, the ECS task IAM role is used automatically. For local development, paste your SSO session keys below — the platform will identify you and auto-fill your AWS username.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* AWS credentials paste box (collapsible when already configured) */}
      <div className="rounded-xl border border-zinc-200/60 dark:border-white/10">
        <button
          type="button"
          onClick={() => setCredsExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-left"
        >
          <span className="inline-flex items-center gap-2 text-sm font-bold text-zinc-900 dark:text-white">
            <KeyRound className="h-4 w-4 text-cyan-500" />
            AWS SSO Session Keys
            {hasCreds && <span className="rounded-full bg-emerald-100 dark:bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">Configured</span>}
          </span>
          {credsExpanded ? <ChevronUp className="h-4 w-4 text-zinc-400" /> : <ChevronDown className="h-4 w-4 text-zinc-400" />}
        </button>

        {credsExpanded && (
          <div className="border-t border-zinc-200/60 dark:border-white/10 px-4 py-4 space-y-3">
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Run <code className="font-mono text-[11px] bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">aws configure export-credentials</code> or copy the export block from the AWS access portal, then paste it below.
            </p>
            <textarea
              rows={5}
              spellCheck={false}
              placeholder={`export AWS_ACCESS_KEY_ID=ASIA...\nexport AWS_SECRET_ACCESS_KEY=...\nexport AWS_SESSION_TOKEN=...`}
              value={raw}
              onChange={(e) => { setRaw(e.target.value); setParseError(false); }}
              className={`block w-full rounded-md border px-3 py-2 font-mono text-xs text-gray-900 shadow-sm
                focus:outline-none focus:ring-1
                dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500
                resize-none
                ${showParseError || parseError
                  ? 'border-red-400 focus:border-red-400 focus:ring-red-400'
                  : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:focus:border-blue-400'
                }`}
            />
            {(showParseError || parseError) && (
              <p className="text-xs text-red-600 dark:text-red-400">
                Could not find AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY. Paste the full export block.
              </p>
            )}
            {parsed && !applyingCreds && (
              <p className="text-xs text-green-600 dark:text-green-400">
                ✓ Parsed — Key ID: {parsed.accessKeyId.slice(0, 8)}…
                {parsed.sessionToken ? '  •  session token included' : ''}
              </p>
            )}
            <div className="flex gap-2">
              <Btn onClick={applyCredentials} disabled={!parsed} loading={applyingCreds}>
                Apply &amp; identify me
              </Btn>
              {hasCreds && <Btn variant="ghost" onClick={clearCredentials}>Clear — revert to IAM role</Btn>}
            </div>
            <p className="text-[10px] text-zinc-500 dark:text-zinc-500">
              Stored in browser localStorage and sent with each API request. Never logged or persisted server-side.
            </p>
          </div>
        )}
      </div>

      {/* Profile fields */}
      <div className="border-t border-slate-200/50 dark:border-white/5 pt-5">
        <div className="mb-3 flex items-center gap-3">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-white">Identification &amp; classification</h3>
          <StatusPill ok={isProfileFilled} label={isProfileFilled ? 'Complete' : 'Department + role required'} />
          {profile?.source === 'identitystore' && (
            <span className="rounded-full bg-cyan-100 dark:bg-cyan-500/20 px-2 py-0.5 text-[10px] font-bold text-cyan-700 dark:text-cyan-300">
              Synced from IAM Identity Center
            </span>
          )}
        </div>

        {autoResolveNote && (
          <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            <strong className="font-semibold">IAM Identity Center lookup didn't run.</strong> {autoResolveNote}
          </div>
        )}

        {error && <p className="text-xs text-rose-600 dark:text-rose-400 mb-2">{error}</p>}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label>AWS Username</Label>
            <Input
              type="text"
              placeholder="auto-filled from AWS SSO"
              value={awsUsername}
              onChange={(e) => setAwsUsername(e.target.value)}
              disabled={loading}
            />
            <p className="mt-1 text-[10px] text-gray-500 dark:text-gray-500">
              {identity
                ? <>Auto-filled from your SSO identity. Used as STS RoleSessionName for CloudTrail audit.</>
                : <>Set automatically once you paste SSO session keys above.</>}
            </p>
          </div>
          <div>
            <Label>Department</Label>
            <Input
              type="text"
              placeholder="e.g. Customer, Payment, Data, DevOps"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              disabled={loading}
            />
            <p className="mt-1 text-[10px] text-gray-500 dark:text-gray-500">
              Set this manually — match the casing of resources' <span className="font-mono">Owner</span> tag. IAM policies will deny access if the value is wrong, so honest entry is in your interest.
            </p>
          </div>
          <div>
            <Label>Role / User Type</Label>
            <Input
              type="text"
              placeholder="e.g. DomainLead, Engineer, SeniorEngineer"
              value={userType}
              onChange={(e) => setUserType(e.target.value)}
              disabled={loading}
            />
            <p className="mt-1 text-[10px] text-gray-500 dark:text-gray-500">
              Auto-filled from your IAM Identity Center <span className="font-mono">Title</span> attribute when available; falls back to the SSO PermissionSet.
            </p>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Btn onClick={saveProfile} loading={saving} disabled={loading}>Save profile</Btn>
        </div>

        <p className="mt-3 text-[10px] text-gray-500 dark:text-gray-500">
          Department and role are still self-declared until IAM Identity Center sync ships. If they're wrong (e.g. claiming DomainLead when you aren't), auto-approval rules trust them and the audit log records the mismatch with your name.
        </p>
      </div>
    </SectionCard>
  );
}

export function SettingsPage() {
  const auth = useAuth();
  const [status, setStatus] = useState<InfraStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const data = await settingsApi.getStatus();
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  return (
    <div className="max-w-3xl space-y-8 animate-fade-in mx-auto mt-4">
      <div className="px-2">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Settings</h1>
        <p className="mt-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
          Configure tokens, credentials, and platform preferences.
        </p>
      </div>

      {/* Teams shortcut — only DevOps can manage teams */}
      {auth.isDevOps && (
        <Link
          to="/settings/teams"
          className="flex items-center justify-between rounded-2xl border border-indigo-200/60 bg-indigo-50/40 dark:border-indigo-900/30 dark:bg-indigo-950/20 px-6 py-4 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors"
        >
          <div>
            <p className="text-sm font-bold text-indigo-700 dark:text-indigo-300">Teams</p>
            <p className="text-xs text-indigo-500 dark:text-indigo-400">Manage security teams and members</p>
          </div>
          <span className="text-indigo-400 text-sm">→</span>
        </Link>
      )}

      <OAuthSection onStatusRefresh={loadStatus} />
      <ProfileSection
        credSource={status?.credentials.source ?? null}
        onStatusRefresh={loadStatus}
      />
      <AppearanceSection />
      <AwsRegionSection
        currentRegion={status?.region.current ?? null}
        regionSource={status?.region.source ?? null}
        onStatusRefresh={loadStatus}
      />
      <GitHubSection onStatusRefresh={loadStatus} />
      <JitResourcesSection isDevOps={auth.isDevOps} />
      {auth.isDevOps && (
        <InfraStatusSection status={status} loading={statusLoading} onRefresh={loadStatus} />
      )}
    </div>
  );
}
