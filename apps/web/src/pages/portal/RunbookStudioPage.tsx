import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Slack,
  Globe,
  Zap,
  Server,
  RefreshCw,
  FileText,
  Bell,
  Inbox,
  GitMerge,
  Github,
  Clock,
  GripVertical,
  Trash2,
  Play,
  Save,
  X,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  AlertCircle,
  Loader,
  ArrowDown,
  Search,
  Sparkles,
} from 'lucide-react';
import { fetchApi, portalApi, aiApi, ecsApi, infraApi } from '../../lib/api';
import { useDialog } from '../../components/Dialog';

interface CurrentUser { id: string; name: string; }

function useCurrentUser(): CurrentUser {
  const { alert } = useDialog();
  const [user, setUser] = useState<CurrentUser>({ id: 'anonymous', name: 'Anonymous' });
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BlockType =
  | 'slack'
  | 'lambda-invoke'
  | 'ecs-describe'
  | 'ecs-force-deploy'
  | 'cloudwatch-logs'
  | 'cloudwatch-alarm'
  | 'sqs-peek'
  | 'step-fn-start'
  | 'github-workflow'
  | 'http-call'
  | 'delay';

interface RunbookBlock {
  id: string;
  type: BlockType;
  title: string;
  config: Record<string, string>;
}

interface Runbook {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  blocks: RunbookBlock[];
  ownerId: string;
  ownerName: string;
  createdAt: string;
  updatedAt: string;
}

type StepStatus = 'ok' | 'error' | 'skipped';
type ExecutionStatus = 'running' | 'completed' | 'failed';

interface StepResult {
  blockId: string;
  blockType: BlockType;
  blockTitle: string;
  status: StepStatus;
  output?: string;
  error?: string;
  durationMs: number;
}

interface ExecutionRecord {
  execId: string;
  runbookId: string;
  executedBy: string;
  startedAt: string;
  completedAt?: string;
  status: ExecutionStatus;
  dryRun: boolean;
  stepResults: StepResult[];
}

interface ExecuteStartResponse {
  execId: string;
  runbookId: string;
  status: string;
  startedAt: string;
}

// ---------------------------------------------------------------------------
// Palette definition
// ---------------------------------------------------------------------------

interface PaletteEntry {
  type: BlockType;
  title: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: React.ComponentType<any>;
  color: string;
  group: string;
}

const PALETTE_BLOCKS: PaletteEntry[] = [
  { type: 'slack',            title: 'Send Slack Message',       icon: Slack,     color: 'text-purple-500',  group: 'Notifications' },
  { type: 'http-call',        title: 'HTTP Request',             icon: Globe,     color: 'text-emerald-500', group: 'Integration' },
  { type: 'lambda-invoke',    title: 'Invoke Lambda',            icon: Zap,       color: 'text-orange-500',  group: 'AWS Compute' },
  { type: 'ecs-describe',     title: 'ECS Service Status',       icon: Server,    color: 'text-blue-500',    group: 'AWS Compute' },
  { type: 'ecs-force-deploy', title: 'ECS Force Deploy',         icon: RefreshCw, color: 'text-cyan-500',    group: 'AWS Compute' },
  { type: 'cloudwatch-logs',  title: 'CloudWatch Logs',          icon: FileText,  color: 'text-amber-500',   group: 'AWS Observability' },
  { type: 'cloudwatch-alarm', title: 'CloudWatch Alarm State',   icon: Bell,      color: 'text-red-500',     group: 'AWS Observability' },
  { type: 'sqs-peek',         title: 'SQS Queue Depth',          icon: Inbox,     color: 'text-teal-500',    group: 'AWS Messaging' },
  { type: 'step-fn-start',    title: 'Start Step Function',      icon: GitMerge,  color: 'text-violet-500',  group: 'AWS Orchestration' },
  { type: 'github-workflow',  title: 'Dispatch GitHub Workflow', icon: Github,    color: 'text-gray-700',    group: 'GitHub' },
  { type: 'delay',            title: 'Wait / Delay',             icon: Clock,     color: 'text-slate-500',   group: 'Control' },
];

const PALETTE_GROUPS = Array.from(new Set(PALETTE_BLOCKS.map((b) => b.group)));

// ---------------------------------------------------------------------------
// Default config per block type
// ---------------------------------------------------------------------------

function defaultConfig(type: BlockType): Record<string, string> {
  switch (type) {
    case 'slack':            return { webhookUrl: '', channel: '#incidents', message: '' };
    case 'http-call':        return { url: '', method: 'GET', body: '', headers: '' };
    case 'lambda-invoke':    return { functionName: '', payload: '{}' };
    case 'ecs-describe':     return { cluster: '', service: '' };
    case 'ecs-force-deploy': return { cluster: '', service: '' };
    case 'cloudwatch-logs':  return { logGroup: '', logStream: '', limit: '50' };
    case 'cloudwatch-alarm': return { alarmName: '' };
    case 'sqs-peek':         return { queueUrl: '' };
    case 'step-fn-start':    return { stateMachineArn: '', input: '{}' };
    case 'github-workflow':  return { owner: 'washmen', repo: '', workflow_id: '', ref: 'main', inputs: '{}' };
    case 'delay':            return { seconds: '10' };
  }
}

// ---------------------------------------------------------------------------
// Shared field primitives
// ---------------------------------------------------------------------------

const inputCls = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white';
const labelCls = 'mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input type="text" value={value} onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder} className={inputCls} />
  );
}

function TextareaInput({ value, onChange, placeholder, rows = 4 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <textarea value={value} onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder} rows={rows}
      className={`${inputCls} resize-y font-mono text-xs`} />
  );
}

// ---------------------------------------------------------------------------
// Resource cache + fetch hook
// ---------------------------------------------------------------------------

// Module-level memory cache (survives re-renders within the same page session).
// sessionStorage is also checked so the cache survives page navigation within
// the same browser session — avoiding redundant AWS API calls.
const resourceCache = new Map<string, Array<{ label: string; value: string }>>();

function readSessionCache(key: string): Array<{ label: string; value: string }> | null {
  try {
    const raw = sessionStorage.getItem(`wep:aws-cache:${key}`);
    return raw ? (JSON.parse(raw) as Array<{ label: string; value: string }>) : null;
  } catch { return null; }
}

function writeSessionCache(key: string, data: Array<{ label: string; value: string }>): void {
  try { sessionStorage.setItem(`wep:aws-cache:${key}`, JSON.stringify(data)); } catch { /* quota */ }
}

function useAwsResource(path: string, enabled = true): {
  options: Array<{ label: string; value: string }>;
  loading: boolean;
} {
  const [options, setOptions] = useState<Array<{ label: string; value: string }>>(() => {
    // Warm from memory cache first, then sessionStorage
    return resourceCache.get(path) ?? readSessionCache(path) ?? [];
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !path) return;
    if (resourceCache.has(path)) { setOptions(resourceCache.get(path)!); return; }
    const fromSession = readSessionCache(path);
    if (fromSession) { resourceCache.set(path, fromSession); setOptions(fromSession); return; }
    setLoading(true);
    fetchApi<unknown[]>(path)
      .then((data) => {
        const normalised = data.map((item) => {
          const r = item as Record<string, string>;
          const value = r['arn'] ?? r['url'] ?? r['id'] ?? r['fullName'] ?? r['name'] ?? '';
          const label = r['name'] ?? r['identifier'] ?? value;
          return { label, value };
        });
        resourceCache.set(path, normalised);
        writeSessionCache(path, normalised);
        setOptions(normalised);
      })
      .catch(() => { /* degrade to free-text */ })
      .finally(() => setLoading(false));
  }, [path, enabled]);

  return { options, loading };
}

// ---------------------------------------------------------------------------
// SearchableSelect — combobox with type-to-filter, works for static and async options
// ---------------------------------------------------------------------------

function SearchableSelect({
  value,
  onChange,
  options,
  loading = false,
  placeholder = 'Search or select…',
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ label: string; value: string }>;
  loading?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [query, setQuery]       = useState('');
  const [open, setOpen]         = useState(false);
  const containerRef            = useRef<HTMLDivElement>(null);
  const inputRef                = useRef<HTMLInputElement>(null);

  // Label of the currently selected value
  const selectedLabel = useMemo(
    () => options.find((o) => o.value === value)?.label ?? value,
    [options, value],
  );

  // Filtered options based on search query
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)) : options;
  }, [options, query]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function handleOpen() {
    if (disabled) return;
    setOpen(true);
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleSelect(option: { label: string; value: string }) {
    onChange(option.value);
    setOpen(false);
    setQuery('');
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange('');
    setQuery('');
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled}
        className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors
          ${disabled
            ? 'cursor-not-allowed border-gray-100 bg-gray-50 text-gray-400 dark:border-gray-800 dark:bg-gray-900'
            : 'cursor-pointer border-gray-200 bg-white hover:border-blue-400 dark:border-gray-700 dark:bg-gray-800'
          }
          ${open ? 'border-blue-500 ring-1 ring-blue-500' : ''}`}
      >
        {loading ? (
          <Loader className="h-3.5 w-3.5 shrink-0 animate-spin text-gray-400" />
        ) : (
          <Search className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        )}
        <span className={`flex-1 truncate ${value ? 'text-gray-800 dark:text-white' : 'text-gray-400'}`}>
          {loading ? 'Loading…' : (selectedLabel || placeholder)}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {value && !disabled && (
            <span
              role="button"
              onClick={handleClear}
              className="rounded p-0.5 text-gray-300 hover:text-gray-500 dark:hover:text-gray-300"
            >
              <X className="h-3 w-3" />
            </span>
          )}
          <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
          {/* Search input */}
          <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 dark:border-gray-800">
            <Search className="h-3.5 w-3.5 shrink-0 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${options.length} items…`}
              className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 focus:outline-none dark:text-white"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-600">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Options list */}
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-gray-400">
                {options.length === 0 ? 'No options available — type a value manually' : 'No matches'}
              </div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => handleSelect(o)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-blue-50 dark:hover:bg-blue-950/30
                    ${o.value === value ? 'bg-blue-50 font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}
                >
                  {o.value === value && <CheckCircle className="h-3.5 w-3.5 shrink-0 text-blue-500" />}
                  <span className="truncate">{o.label}</span>
                  {o.label !== o.value && (
                    <span className="ml-auto shrink-0 truncate text-xs text-gray-400">{o.value}</span>
                  )}
                </button>
              ))
            )}
          </div>

          {/* Allow manual entry footer */}
          {query && !filtered.some((o) => o.label === query || o.value === query) && (
            <div className="border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => { onChange(query); setOpen(false); setQuery(''); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
              >
                <span className="font-mono">{query}</span>
                <span className="text-xs text-gray-400">— use this value</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Search-as-you-type select — hits a backend prefix endpoint on every keystroke (debounced).
// Used for large lists like CloudWatch log groups where loading everything upfront misses groups
// beyond the first page.
function PrefixSearchSelect({
  basePath,
  prefixParam = 'prefix',
  value,
  onChange,
  placeholder = 'Type to search…',
}: {
  basePath: string;
  prefixParam?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery]     = useState('');
  const [open, setOpen]       = useState(false);
  const [options, setOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [loading, setLoading] = useState(false);
  const containerRef          = useRef<HTMLDivElement>(null);
  const inputRef              = useRef<HTMLInputElement>(null);
  const debounceRef           = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function search(prefix: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      const url = prefix
        ? `${basePath}?${prefixParam}=${encodeURIComponent(prefix)}`
        : basePath;
      fetchApi<unknown[]>(url)
        .then((data) => {
          setOptions(data.map((item) => {
            const r = item as Record<string, string>;
            const v = r['arn'] ?? r['url'] ?? r['id'] ?? r['fullName'] ?? r['name'] ?? '';
            const l = r['name'] ?? r['identifier'] ?? v;
            return { label: l, value: v };
          }));
        })
        .catch(() => setOptions([]))
        .finally(() => setLoading(false));
    }, 300);
  }

  function handleOpen() {
    setOpen(true);
    setQuery('');
    search('');
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleQueryChange(q: string) {
    setQuery(q);
    search(q);
  }

  function handleSelect(opt: { label: string; value: string }) {
    onChange(opt.value);
    setOpen(false);
    setQuery('');
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange('');
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={handleOpen}
        className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors
          cursor-pointer border-gray-200 bg-white hover:border-blue-400 dark:border-gray-700 dark:bg-gray-800
          ${open ? 'border-blue-500 ring-1 ring-blue-500' : ''}`}
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        <span className={`flex-1 truncate ${value ? 'text-gray-800 dark:text-white' : 'text-gray-400'}`}>
          {value || placeholder}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {value && (
            <span role="button" onClick={handleClear} className="rounded p-0.5 text-gray-300 hover:text-gray-500 dark:hover:text-gray-300">
              <X className="h-3 w-3" />
            </span>
          )}
          <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
          <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 dark:border-gray-800">
            <Search className="h-3.5 w-3.5 shrink-0 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Type to filter log groups…"
              className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 focus:outline-none dark:text-white"
            />
            {loading && <Loader className="h-3.5 w-3.5 animate-spin text-gray-400" />}
            {query && !loading && (
              <button onClick={() => handleQueryChange('')} className="text-gray-400 hover:text-gray-600">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="max-h-52 overflow-y-auto">
            {options.length === 0 && !loading ? (
              <div className="px-3 py-6 text-center text-sm text-gray-400">
                {query ? 'No matches — try a different prefix' : 'Type to search log groups'}
              </div>
            ) : (
              options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => handleSelect(o)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-blue-50 dark:hover:bg-blue-950/30
                    ${o.value === value ? 'bg-blue-50 font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}
                >
                  {o.value === value && <CheckCircle className="h-3.5 w-3.5 shrink-0 text-blue-500" />}
                  <span className="truncate font-mono text-xs">{o.label}</span>
                </button>
              ))
            )}
          </div>

          {/* Allow manual entry */}
          {query && !options.some((o) => o.value === query) && (
            <div className="border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => { onChange(query); setOpen(false); setQuery(''); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
              >
                <span className="font-mono text-xs">{query}</span>
                <span className="text-xs text-gray-400">— use this value</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Async wrapper — fetches options then renders SearchableSelect
function AsyncSelect({ path, value, onChange, enabled = true, placeholder }: {
  path: string;
  value: string;
  onChange: (v: string) => void;
  enabled?: boolean;
  placeholder?: string;
}) {
  const { options, loading } = useAwsResource(path, enabled);
  return (
    <SearchableSelect
      value={value}
      onChange={onChange}
      options={options}
      loading={loading && options.length === 0}
      placeholder={placeholder}
      disabled={!enabled}
    />
  );
}

// Static searchable select (for finite option lists like HTTP method)
function SelectInput({ value, onChange, options, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ label: string; value: string }>;
  placeholder?: string;
}) {
  return (
    <SearchableSelect value={value} onChange={onChange} options={options} placeholder={placeholder} />
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return crypto.randomUUID();
}

function paletteLookup(type: BlockType): PaletteEntry {
  return PALETTE_BLOCKS.find((p) => p.type === type) ?? PALETTE_BLOCKS[0]!;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PaletteBlock({
  entry,
  onAdd,
}: {
  entry: PaletteEntry;
  onAdd: (entry: PaletteEntry) => void;
}) {
  const Icon = entry.icon;
  return (
    <button
      onClick={() => onAdd(entry)}
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
    >
      <Icon className={`h-4 w-4 shrink-0 ${entry.color}`} />
      <span className="truncate text-gray-700 dark:text-gray-300">{entry.title}</span>
    </button>
  );
}

function StepArrow() {
  return (
    <div className="flex flex-col items-center">
      <div className="h-8 w-px bg-blue-300 dark:bg-blue-600" />
      <ArrowDown className="h-4 w-4 -mt-2 text-blue-400 dark:text-blue-500" strokeWidth={2.5} />
    </div>
  );
}

function CanvasBlock({
  block,
  index,
  selected,
  isDragTarget,
  onSelect,
  onDelete,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragEnter,
  onDragEnd,
  isFirst,
  isLast,
}: {
  block: RunbookBlock;
  index: number;
  selected: boolean;
  isDragTarget: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const entry = paletteLookup(block.type);
  const Icon = entry.icon;

  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onDragEnter={(e) => { e.preventDefault(); onDragEnter(); }}
      onDragOver={(e) => e.preventDefault()}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      className={`group relative flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-all duration-150 ${
        isDragTarget
          ? 'scale-[1.02] border-blue-400 bg-blue-50/60 shadow-md dark:border-blue-500 dark:bg-blue-950/40'
          : selected
            ? 'border-blue-400 bg-blue-50 shadow-sm ring-2 ring-blue-400/20 dark:border-blue-500 dark:bg-blue-950/30'
            : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600'
      }`}
    >
      {/* Drag handle */}
      <div className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-400 dark:text-gray-600 dark:hover:text-gray-500">
        <GripVertical className="h-4 w-4" />
      </div>

      {/* Step number badge */}
      <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors ${
        selected ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
      }`}>
        {index + 1}
      </div>

      <Icon className={`h-4 w-4 shrink-0 ${entry.color}`} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-800 dark:text-white">{block.title}</p>
        <p className="text-xs text-gray-400">{entry.title}</p>
      </div>

      {/* Actions — visible on hover or when selected */}
      <div className={`flex shrink-0 items-center gap-1 transition-opacity ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        <button
          onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
          disabled={isFirst}
          title="Move up"
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 dark:hover:bg-gray-700 dark:hover:text-gray-200"
        >
          <ChevronDown className="h-3 w-3 rotate-180" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
          disabled={isLast}
          title="Move down"
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 dark:hover:bg-gray-700 dark:hover:text-gray-200"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
        <div className="mx-0.5 h-3.5 w-px bg-gray-200 dark:bg-gray-700" />
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete step"
          className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block-specific config forms
// ---------------------------------------------------------------------------

function MarkdownEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');

  // Preview mirrors the Slack mrkdwn conversion done on the backend
  function renderPreview(md: string): string {
    return md
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      // Headings → bold
      .replace(/^#{1,6}\s+(.+)$/gm, '<strong>$1</strong>')
      // Horizontal rules → blank
      .replace(/^[-*_]{3,}\s*$/gm, '<hr class="my-1 border-gray-200 dark:border-gray-700" />')
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<strong>$1</strong>')
      // Italic (single *)
      .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
      // Inline code
      .replace(/`(.+?)`/g, '<code class="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs font-mono">$1</code>')
      // Bullet lists
      .replace(/^[ \t]*[-*]\s+(.+)$/gm, '• $1')
      .replace(/\n/g, '<br />');
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
      <div className="flex border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
        {(['edit', 'preview'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
              tab === t
                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
            }`}
          >
            {t}
          </button>
        ))}
        <span className="ml-auto px-3 py-1.5 text-xs text-gray-400">Slack mrkdwn</span>
      </div>
      {tab === 'edit' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={6}
          placeholder="Type your message…"
          className="w-full resize-y bg-white px-3 py-2 font-mono text-xs text-gray-800 focus:outline-none dark:bg-gray-900 dark:text-gray-200"
        />
      ) : (
        <div
          className="min-h-[120px] bg-white px-3 py-2 text-sm text-gray-800 dark:bg-gray-900 dark:text-gray-200"
          dangerouslySetInnerHTML={{ __html: value ? renderPreview(value) : '<span class="text-gray-400 text-xs">Nothing to preview</span>' }}
        />
      )}
    </div>
  );
}

function SlackConfig({ c, set }: { c: Record<string, string>; set: (k: string, v: string) => void }) {
  return (
    <>
      <Field label="Webhook URL">
        <TextInput value={c['webhookUrl'] ?? ''} onChange={(v) => set('webhookUrl', v)} placeholder="https://hooks.slack.com/services/…" />
      </Field>
      <Field label="Channel">
        <TextInput value={c['channel'] ?? ''} onChange={(v) => set('channel', v)} placeholder="#incidents" />
      </Field>
      <Field label="Message">
        <MarkdownEditor value={c['message'] ?? ''} onChange={(v) => set('message', v)} />
      </Field>
    </>
  );
}

function HttpCallConfig({ c, set }: { c: Record<string, string>; set: (k: string, v: string) => void }) {
  return (
    <>
      <Field label="URL">
        <TextInput value={c['url'] ?? ''} onChange={(v) => set('url', v)} placeholder="https://internal-api.washmen.com/…" />
      </Field>
      <Field label="Method">
        <SelectInput value={c['method'] ?? 'GET'} onChange={(v) => set('method', v)}
          options={['GET','POST','PUT','PATCH','DELETE'].map((m) => ({ label: m, value: m }))} />
      </Field>
      <Field label="Body (JSON)">
        <TextareaInput value={c['body'] ?? ''} onChange={(v) => set('body', v)} placeholder="{}" />
      </Field>
      <Field label="Headers (JSON)">
        <TextareaInput value={c['headers'] ?? ''} onChange={(v) => set('headers', v)} placeholder='{"Authorization": "Bearer …"}' rows={2} />
      </Field>
    </>
  );
}

function LambdaConfig({ c, set }: { c: Record<string, string>; set: (k: string, v: string) => void }) {
  return (
    <>
      <Field label="Function">
        <AsyncSelect path="/aws-resources/lambdas" value={c['functionName'] ?? ''} onChange={(v) => set('functionName', v)} placeholder="Select Lambda function…" />
      </Field>
      <Field label="Payload (JSON)">
        <TextareaInput value={c['payload'] ?? '{}'} onChange={(v) => set('payload', v)} />
      </Field>
    </>
  );
}

function EcsConfig({ c, set }: { c: Record<string, string>; set: (k: string, v: string) => void }) {
  const cluster = c['cluster'] ?? '';
  const serviceListPath = cluster ? `/aws-resources/ecs/services?cluster=${encodeURIComponent(cluster)}` : '';

  return (
    <>
      <Field label="Cluster">
        <AsyncSelect
          path="/aws-resources/ecs/clusters"
          value={cluster}
          onChange={(v) => { set('cluster', v); set('service', ''); }}
          placeholder="Select ECS cluster…"
        />
      </Field>
      <Field label="Service">
        <AsyncSelect
          path={serviceListPath}
          value={c['service'] ?? ''}
          onChange={(v) => set('service', v)}
          enabled={!!cluster}
          placeholder={cluster ? 'Select service…' : 'Select a cluster first'}
        />
      </Field>
    </>
  );
}

function CloudWatchLogsConfig({ c, set }: { c: Record<string, string>; set: (k: string, v: string) => void }) {
  const logGroup = c['logGroup'] ?? '';
  const streamPath = logGroup ? `/aws-resources/cloudwatch/log-streams?logGroup=${encodeURIComponent(logGroup)}` : '';

  return (
    <>
      <Field label="Log group">
        <PrefixSearchSelect
          basePath="/aws-resources/cloudwatch/log-groups"
          prefixParam="prefix"
          value={logGroup}
          onChange={(v) => { set('logGroup', v); set('logStream', ''); }}
          placeholder="Type to search log groups…"
        />
      </Field>
      <Field label="Log stream (optional)">
        <AsyncSelect
          path={streamPath}
          value={c['logStream'] ?? ''}
          onChange={(v) => set('logStream', v)}
          enabled={!!logGroup}
          placeholder={logGroup ? 'Select stream…' : 'Select a log group first'}
        />
      </Field>
      <Field label="Line limit">
        <TextInput value={c['limit'] ?? '50'} onChange={(v) => set('limit', v)} placeholder="50" />
      </Field>
    </>
  );
}

function CloudWatchAlarmConfig({ c, set }: { c: Record<string, string>; set: (k: string, v: string) => void }) {
  return (
    <Field label="Alarm">
      <AsyncSelect path="/aws-resources/cloudwatch/alarms" value={c['alarmName'] ?? ''} onChange={(v) => set('alarmName', v)} placeholder="Select alarm…" />
    </Field>
  );
}

function SqsConfig({ c, set }: { c: Record<string, string>; set: (k: string, v: string) => void }) {
  return (
    <Field label="Queue">
      <AsyncSelect path="/aws-resources/sqs/queues" value={c['queueUrl'] ?? ''} onChange={(v) => set('queueUrl', v)} placeholder="Select SQS queue…" />
    </Field>
  );
}

function StepFnConfig({ c, set }: { c: Record<string, string>; set: (k: string, v: string) => void }) {
  return (
    <>
      <Field label="State machine">
        <AsyncSelect path="/aws-resources/step-functions" value={c['stateMachineArn'] ?? ''} onChange={(v) => set('stateMachineArn', v)} placeholder="Select state machine…" />
      </Field>
      <Field label="Input (JSON)">
        <TextareaInput value={c['input'] ?? '{}'} onChange={(v) => set('input', v)} />
      </Field>
    </>
  );
}

function GithubWorkflowConfig({ c, set }: { c: Record<string, string>; set: (k: string, v: string) => void }) {
  const owner = c['owner'] ?? '';
  const repo  = c['repo']  ?? '';
  const repoPath     = owner ? `/aws-resources/github/repos?org=${encodeURIComponent(owner)}` : '';
  const workflowPath = owner && repo ? `/aws-resources/github/workflows?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}` : '';

  return (
    <>
      <Field label="Organisation">
        <TextInput value={owner} onChange={(v) => { set('owner', v); set('repo', ''); set('workflow_id', ''); }} placeholder="washmen" />
      </Field>
      <Field label="Repository">
        <AsyncSelect
          path={repoPath}
          value={repo}
          onChange={(v) => { set('repo', v); set('workflow_id', ''); }}
          enabled={!!owner}
          placeholder={owner ? 'Select repository…' : 'Enter org first'}
        />
      </Field>
      <Field label="Workflow">
        <AsyncSelect
          path={workflowPath}
          value={c['workflow_id'] ?? ''}
          onChange={(v) => set('workflow_id', v)}
          enabled={!!owner && !!repo}
          placeholder={repo ? 'Select workflow…' : 'Select a repository first'}
        />
      </Field>
      <Field label="Ref (branch / tag)">
        <TextInput value={c['ref'] ?? 'main'} onChange={(v) => set('ref', v)} placeholder="main" />
      </Field>
      <Field label="Inputs (JSON)">
        <TextareaInput value={c['inputs'] ?? '{}'} onChange={(v) => set('inputs', v)} rows={3} />
      </Field>
    </>
  );
}

function DelayConfig({ c, set }: { c: Record<string, string>; set: (k: string, v: string) => void }) {
  return (
    <Field label="Duration (seconds)">
      <TextInput value={c['seconds'] ?? '10'} onChange={(v) => set('seconds', v)} placeholder="10" />
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Main Configurator — renders the appropriate sub-form per block type
// ---------------------------------------------------------------------------

function Configurator({
  block,
  onChange,
  onTitleChange,
}: {
  block: RunbookBlock;
  onChange: (key: string, value: string) => void;
  onTitleChange: (title: string) => void;
}) {
  const entry = paletteLookup(block.type);
  const Icon = entry.icon;
  const c = block.config;

  function blockFields() {
    switch (block.type) {
      case 'slack':            return <SlackConfig c={c} set={onChange} />;
      case 'http-call':        return <HttpCallConfig c={c} set={onChange} />;
      case 'lambda-invoke':    return <LambdaConfig c={c} set={onChange} />;
      case 'ecs-describe':
      case 'ecs-force-deploy': return <EcsConfig c={c} set={onChange} />;
      case 'cloudwatch-logs':  return <CloudWatchLogsConfig c={c} set={onChange} />;
      case 'cloudwatch-alarm': return <CloudWatchAlarmConfig c={c} set={onChange} />;
      case 'sqs-peek':         return <SqsConfig c={c} set={onChange} />;
      case 'step-fn-start':    return <StepFnConfig c={c} set={onChange} />;
      case 'github-workflow':  return <GithubWorkflowConfig c={c} set={onChange} />;
      case 'delay':            return <DelayConfig c={c} set={onChange} />;
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-gray-100 pb-3 dark:border-gray-800">
        <Icon className={`h-4 w-4 ${entry.color}`} />
        <p className="text-sm font-semibold text-gray-800 dark:text-white">{entry.title}</p>
      </div>

      {/* Step title */}
      <Field label="Step title">
        <TextInput value={block.title} onChange={onTitleChange} />
      </Field>

      {/* Block-specific fields */}
      {blockFields()}

    </div>
  );
}

function StepResultBadge({ status }: { status: StepStatus | 'pending' }) {
  if (status === 'pending') return <Loader className="h-4 w-4 animate-spin text-gray-400" />;
  if (status === 'ok') return <CheckCircle className="h-4 w-4 text-emerald-500" />;
  if (status === 'error') return <AlertCircle className="h-4 w-4 text-red-500" />;
  return <span className="text-xs text-gray-400">skipped</span>;
}

function ExecutionModal({
  execId,
  runbookId,
  blocks,
  onClose,
}: {
  execId: string;
  runbookId: string;
  blocks: RunbookBlock[];
  onClose: () => void;
}) {
  const [execution, setExecution] = useState<ExecutionRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const data = await fetchApi<ExecutionRecord>(`/runbooks/${runbookId}/executions/${execId}`);
      setExecution(data);
      if (data.status === 'completed' || data.status === 'failed') {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
  }, [execId, runbookId]);

  useEffect(() => {
    void poll();
    intervalRef.current = setInterval(() => void poll(), 2000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [poll]);

  const stepResultMap = new Map(
    (execution?.stepResults ?? []).map((sr) => [sr.blockId, sr]),
  );

  const overallStatus = execution?.status;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-gray-100 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 p-4 dark:border-gray-800">
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">Dry-Run Results</p>
            <p className="text-xs text-gray-400">exec: {execId}</p>
          </div>
          <div className="flex items-center gap-3">
            {overallStatus === 'running' && (
              <span className="flex items-center gap-1.5 text-sm text-blue-600">
                <Loader className="h-4 w-4 animate-spin" /> Running…
              </span>
            )}
            {overallStatus === 'completed' && (
              <span className="flex items-center gap-1.5 text-sm text-emerald-600">
                <CheckCircle className="h-4 w-4" /> Completed
              </span>
            )}
            {overallStatus === 'failed' && (
              <span className="flex items-center gap-1.5 text-sm text-red-600">
                <AlertCircle className="h-4 w-4" /> Failed
              </span>
            )}
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {error && (
          <div className="m-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Steps */}
        <div className="max-h-96 overflow-y-auto p-4">
          <div className="flex flex-col gap-3">
            {blocks.map((block) => {
              const result = stepResultMap.get(block.id);
              const isRunning = overallStatus === 'running' && !result;
              const entry = paletteLookup(block.type);
              const Icon = entry.icon;

              return (
                <div
                  key={block.id}
                  className="rounded-xl border border-gray-100 p-3 dark:border-gray-800"
                >
                  <div className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${entry.color}`} />
                    <p className="flex-1 text-sm font-medium text-gray-800 dark:text-white">
                      {block.title}
                    </p>
                    <StepResultBadge status={result ? result.status : isRunning ? 'pending' : 'pending'} />
                  </div>
                  {result?.output && (
                    <pre className="mt-2 max-h-24 overflow-auto rounded-lg bg-gray-50 p-2 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                      {result.output}
                    </pre>
                  )}
                  {result?.error && (
                    <p className="mt-2 text-xs text-red-500">{result.error}</p>
                  )}
                  {result && (
                    <p className="mt-1 text-xs text-gray-400">{result.durationMs}ms</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function RunbookStudioPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const currentUser = useCurrentUser();

  const [name, setName] = useState('Untitled Runbook');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [blocks, setBlocks] = useState<RunbookBlock[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [runbookId, setRunbookId] = useState<string | undefined>(id);
  const [toast, setToast] = useState<string | null>(null);
  const [testRunExec, setTestRunExec] = useState<{ execId: string } | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [dragSourceIndex, setDragSourceIndex] = useState<number | null>(null);
  const [dragTargetIndex, setDragTargetIndex] = useState<number | null>(null);

  // Runbook auto-generator modal state
  const [showGeneratorModal, setShowGeneratorModal] = useState(false);
  const [generatorServices, setGeneratorServices] = useState<Array<{ name: string; cluster: string }>>([]);
  const [generatorServicesLoading, setGeneratorServicesLoading] = useState(false);
  const [generatorSelectedService, setGeneratorSelectedService] = useState('');
  const [generatorGenerating, setGeneratorGenerating] = useState(false);
  const [generatorError, setGeneratorError] = useState<string | null>(null);
  const [generatorPrompt, setGeneratorPrompt] = useState('');

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  };

  // Load runbook if editing
  useEffect(() => {
    if (!id) return;
    fetchApi<Runbook>(`/runbooks/${id}`)
      .then((rb) => {
        setName(rb.name);
        setDescription(rb.description ?? '');
        setTags((rb.tags ?? []).join(', '));
        setBlocks(rb.blocks);
        setRunbookId(rb.id);
      })
      .catch((err: unknown) => {
        showToast(`Failed to load runbook: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, [id]);

  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) ?? null;

  const addBlock = useCallback((entry: PaletteEntry) => {
    const block: RunbookBlock = {
      id: generateId(),
      type: entry.type,
      title: entry.title,
      config: defaultConfig(entry.type),
    };
    setBlocks((prev) => [...prev, block]);
    setSelectedBlockId(block.id);
  }, []);

  const deleteBlock = useCallback((blockId: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== blockId));
    setSelectedBlockId((prev) => (prev === blockId ? null : prev));
  }, []);

  const moveBlock = useCallback((blockId: string, direction: 'up' | 'down') => {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === blockId);
      if (idx === -1) return prev;
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx]!, next[idx]!];
      return next;
    });
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragSourceIndex !== null && dragTargetIndex !== null && dragSourceIndex !== dragTargetIndex) {
      setBlocks((prev) => {
        const next = [...prev];
        const [item] = next.splice(dragSourceIndex, 1);
        next.splice(dragTargetIndex, 0, item!);
        return next;
      });
    }
    setDragSourceIndex(null);
    setDragTargetIndex(null);
  }, [dragSourceIndex, dragTargetIndex]);

  const updateBlockConfig = useCallback((blockId: string, key: string, value: string) => {
    setBlocks((prev) =>
      prev.map((b) => (b.id === blockId ? { ...b, config: { ...b.config, [key]: value } } : b)),
    );
  }, []);

  const updateBlockTitle = useCallback((blockId: string, title: string) => {
    setBlocks((prev) => prev.map((b) => (b.id === blockId ? { ...b, title } : b)));
  }, []);

  const handleSave = async () => {
    if (!name.trim()) {
      showToast('Runbook name is required');
      return;
    }
    setSaving(true);
    try {
      const tagList = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        tags: tagList.length > 0 ? tagList : undefined,
        blocks,
        ownerId: currentUser.id,
        ownerName: currentUser.name,
      };

      if (runbookId) {
        await fetchApi<Runbook>(`/runbooks/${runbookId}`, {
          method: 'PUT',
          body: JSON.stringify({ ...payload, updatedBy: currentUser.id, updatedByName: currentUser.name }),
        });
        showToast('Runbook saved');
      } else {
        const created = await fetchApi<Runbook>('/runbooks', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setRunbookId(created.id);
        navigate(`/portal/runbooks/${created.id}`, { replace: true });
        showToast('Runbook created');
      }
    } catch (err) {
      showToast(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleTestRun = async () => {
    if (!runbookId) {
      void alert({ title: 'Save required', message: 'Save the runbook before running it.', variant: 'info' });
      return;
    }
    try {
      const response = await fetchApi<ExecuteStartResponse>(`/runbooks/${runbookId}/execute`, {
        method: 'POST',
        body: JSON.stringify({ executedBy: currentUser.id, dryRun: true }),
      });
      setTestRunExec({ execId: response.execId });
    } catch (err) {
      showToast(`Test run failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const handleOpenGenerator = async () => {
    setShowGeneratorModal(true);
    setGeneratorSelectedService('');
    setGeneratorError(null);
    setGeneratorPrompt('');
    if (generatorServices.length > 0) return;
    setGeneratorServicesLoading(true);
    try {
      const data = await infraApi.getResources();
      const filtered = data.ecsServices
        .filter((s) => {
          const n = s.name.toLowerCase();
          const env = (s.environment ?? '').toLowerCase();
          return !n.includes('-dev') && !n.startsWith('dev-') && !env.includes('dev');
        })
        .map((s) => ({ name: s.name, cluster: s.cluster }));
      setGeneratorServices(filtered);
    } catch {
      setGeneratorError('Failed to load ECS services');
    } finally {
      setGeneratorServicesLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!generatorSelectedService) return;
    const found = generatorServices.find((s) => s.name === generatorSelectedService);
    if (!found) return;

    setGeneratorGenerating(true);
    setGeneratorError(null);
    try {
      const detail = await ecsApi.getServiceDetail(found.cluster, found.name);
      const serviceData = {
        cluster: found.cluster,
        cpu: detail.taskCpu,
        memory: detail.taskMemory,
        currentRunning: detail.runningCount,
        autoScaling: detail.autoScaling,
        envVars: detail.envVars,
        dependencies: [],
        rdsInstances: [],
        teamName: null,
        repoUrl: null,
      };
      const result = await aiApi.generateRunbook(found.name, serviceData, generatorPrompt.trim() || undefined);
      setName(`Runbook: ${found.name}`);
      setDescription(result.content);

      // Build pre-populated action blocks from the service data
      const generatedBlocks: RunbookBlock[] = [
        {
          id: crypto.randomUUID(),
          type: 'ecs-describe',
          title: 'Check service status',
          config: { cluster: found.cluster, service: found.name },
        },
        {
          id: crypto.randomUUID(),
          type: 'cloudwatch-logs',
          title: 'Fetch recent logs',
          config: { logGroup: '', logStream: '', limit: '50' },
        },
        {
          id: crypto.randomUUID(),
          type: 'cloudwatch-alarm',
          title: 'Check alarms',
          config: { alarmName: found.name },
        },
        {
          id: crypto.randomUUID(),
          type: 'ecs-force-deploy',
          title: 'Force new deployment',
          config: { cluster: found.cluster, service: found.name },
        },
      ];
      setBlocks(generatedBlocks);

      setShowGeneratorModal(false);
      showToast('Runbook generated — review and save');
    } catch (e) {
      setGeneratorError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setGeneratorGenerating(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-lg dark:border-gray-700 dark:bg-gray-900">
          <p className="text-sm text-gray-700 dark:text-gray-300">{toast}</p>
        </div>
      )}

      {/* Execution modal */}
      {testRunExec && runbookId && (
        <ExecutionModal
          execId={testRunExec.execId}
          runbookId={runbookId}
          blocks={blocks}
          onClose={() => setTestRunExec(null)}
        />
      )}

      {/* Runbook generator modal */}
      {showGeneratorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 p-4 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-purple-500" />
                <p className="font-semibold text-gray-900 dark:text-white">Generate Runbook from Service</p>
              </div>
              <button
                onClick={() => setShowGeneratorModal(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-4">
              <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
                Select a production ECS service. The AI will generate a runbook pre-filled with its actual configuration.
              </p>

              {generatorError && (
                <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
                  {generatorError}
                </div>
              )}

              <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                ECS Service
              </label>
              {generatorServicesLoading ? (
                <div className="flex items-center gap-2 py-2 text-sm text-gray-400">
                  <Loader className="h-4 w-4 animate-spin" /> Loading services…
                </div>
              ) : (
                <select
                  value={generatorSelectedService}
                  onChange={(e) => setGeneratorSelectedService(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                >
                  <option value="">— Select a service —</option>
                  {generatorServices.map((s) => (
                    <option key={`${s.cluster}/${s.name}`} value={s.name}>
                      {s.name} ({s.cluster})
                    </option>
                  ))}
                </select>
              )}

              <label className="mb-1 mt-4 block text-xs font-medium text-gray-500 dark:text-gray-400">
                Additional instructions <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <textarea
                rows={3}
                value={generatorPrompt}
                onChange={(e) => setGeneratorPrompt(e.target.value)}
                placeholder="e.g. Focus on database connection issues and include steps for draining connections. Add a section for rollback."
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm placeholder-gray-400 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 resize-none"
              />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-4 py-3 dark:border-gray-800">
              <button
                onClick={() => setShowGeneratorModal(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleGenerate()}
                disabled={!generatorSelectedService || generatorGenerating}
                className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-60"
              >
                {generatorGenerating ? (
                  <>
                    <Loader className="h-4 w-4 animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Generate
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-4 border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
        <button
          onClick={() => navigate('/portal/runbooks')}
          className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          ← Runbooks
        </button>

        <div className="flex flex-1 items-center gap-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Runbook name"
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          />
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
          />
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="Tags (comma separated)"
            className="w-48 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Generate from service — temporarily hidden
          <button
            onClick={() => void handleOpenGenerator()}
            className="inline-flex items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-sm font-medium text-purple-700 shadow-sm hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-300 dark:hover:bg-purple-950/60"
          >
            <Sparkles className="h-4 w-4" />
            Generate from service
          </button>
          */}
          <button
            onClick={() => void handleTestRun()}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <Play className="h-4 w-4 text-emerald-500" />
            Test Run
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* 3-panel layout */}
      <div className="flex min-h-0 flex-1">
        {/* Left — Palette */}
        <aside className="w-56 shrink-0 overflow-y-auto border-r border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <p className="mb-2 px-1 text-xs font-bold uppercase tracking-wider text-gray-400">
            Blocks
          </p>
          {PALETTE_GROUPS.map((group) => {
            const groupBlocks = PALETTE_BLOCKS.filter((b) => b.group === group);
            const collapsed = collapsedGroups.has(group);
            return (
              <div key={group} className="mb-2">
                <button
                  onClick={() => toggleGroup(group)}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                    {group}
                  </span>
                  {collapsed ? (
                    <ChevronRight className="h-3 w-3 text-gray-400" />
                  ) : (
                    <ChevronDown className="h-3 w-3 text-gray-400" />
                  )}
                </button>
                {!collapsed && (
                  <div className="mt-0.5">
                    {groupBlocks.map((entry) => (
                      <PaletteBlock key={entry.type} entry={entry} onAdd={addBlock} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </aside>

        {/* Center — Canvas */}
        <main className="flex-1 overflow-y-auto bg-gray-50 p-4 dark:bg-gray-950">
          {blocks.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800">
                <Zap className="h-6 w-6 text-gray-400" />
              </div>
              <p className="font-medium text-gray-400">No steps yet</p>
              <p className="mt-1 text-sm text-gray-400">
                Click a block from the left panel to add a step
              </p>
            </div>
          ) : (
            <div
              className="flex flex-col"
              onDragOver={(e) => e.preventDefault()}
            >
              {blocks.map((block, index) => (
                <div key={block.id} className="flex flex-col items-stretch">
                  <CanvasBlock
                    block={block}
                    index={index}
                    selected={selectedBlockId === block.id}
                    isDragTarget={dragTargetIndex === index && dragSourceIndex !== index}
                    onSelect={() => setSelectedBlockId(block.id)}
                    onDelete={() => deleteBlock(block.id)}
                    onMoveUp={() => moveBlock(block.id, 'up')}
                    onMoveDown={() => moveBlock(block.id, 'down')}
                    onDragStart={() => setDragSourceIndex(index)}
                    onDragEnter={() => setDragTargetIndex(index)}
                    onDragEnd={handleDragEnd}
                    isFirst={index === 0}
                    isLast={index === blocks.length - 1}
                  />
                  {index < blocks.length - 1 && <StepArrow />}
                </div>
              ))}
            </div>
          )}
        </main>

        {/* Right — Configurator */}
        <aside className="w-72 shrink-0 overflow-y-auto border-l border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          {selectedBlock ? (
            <Configurator
              block={selectedBlock}
              onChange={(key, value) => updateBlockConfig(selectedBlock.id, key, value)}
              onTitleChange={(title) => updateBlockTitle(selectedBlock.id, title)}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-6 text-center">
              <p className="text-sm text-gray-400">Select a step to configure it</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
