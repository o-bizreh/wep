import { useState, useEffect } from 'react';
import { Loader2, Server, Zap, CheckCircle2, Circle } from 'lucide-react';
import { PageHeader } from '@wep/ui';
import { aiApi, infraApi } from '../../lib/api';
import { cacheGet, cacheSet } from '../../lib/cache';
import { OutputCard, RunBtn, Textarea, TextInput, FormCard } from './shared';

const RESOURCE_CACHE_KEY = 'infra-resources-all';

type Phase = 'idle' | 'gathering' | 'preparing' | 'analyzing' | 'done';

const PHASES: { key: Phase; label: string }[] = [
  { key: 'gathering',  label: 'Gathering details'  },
  { key: 'preparing',  label: 'Preparing data'     },
  { key: 'analyzing',  label: 'Analyzing'          },
];

function PhaseIndicator({ phase }: { phase: Phase }) {
  if (phase === 'idle' || phase === 'done') return null;
  return (
    <div className="flex items-center gap-3">
      {PHASES.map(({ key, label }, i) => {
        const active = phase === key;
        const done   = PHASES.findIndex((p) => p.key === phase) > i;
        return (
          <div key={key} className="flex items-center gap-1.5">
            {done
              ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              : active
                ? <Loader2 className="h-3.5 w-3.5 text-indigo-500 animate-spin shrink-0" />
                : <Circle className="h-3.5 w-3.5 text-gray-300 dark:text-gray-600 shrink-0" />}
            <span className={`text-xs ${active ? 'text-indigo-600 dark:text-indigo-400 font-medium' : done ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`}>
              {label}
            </span>
            {i < PHASES.length - 1 && <span className="text-gray-300 dark:text-gray-600 ml-1">›</span>}
          </div>
        );
      })}
    </div>
  );
}

interface EcsEntry { type: 'ecs-service'; name: string; cluster: string; desiredCount: number; runningCount: number }
interface LambdaEntry { type: 'lambda'; name: string; runtime: string; memoryMb: number; timeoutSec: number }
type ResourceEntry = EcsEntry | LambdaEntry;

function resourceKey(r: ResourceEntry): string {
  return r.type === 'ecs-service' ? `ecs:${r.cluster}:${r.name}` : `lambda:${r.name}`;
}

type ResourceCache = Awaited<ReturnType<typeof infraApi.getResources>>;

export function InfraSimulatorPage() {
  const [resources, setResources] = useState<ResourceEntry[]>([]);
  const [loadingResources, setLoadingResources] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [change, setChange] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);

  useEffect(() => {
    const cached = cacheGet<ResourceCache>(RESOURCE_CACHE_KEY);
    if (cached) {
      setResources([
        ...cached.ecsServices.map((s): EcsEntry => ({ type: 'ecs-service', name: s.name, cluster: s.cluster, desiredCount: s.desiredCount, runningCount: s.runningCount })),
        ...cached.lambdaFunctions.map((f): LambdaEntry => ({ type: 'lambda', name: f.name, runtime: f.runtime, memoryMb: f.memoryMb, timeoutSec: f.timeoutSec })),
      ]);
      setLoadingResources(false);
      return;
    }
    void infraApi.getResources().then((data) => {
      cacheSet(RESOURCE_CACHE_KEY, data);
      setResources([
        ...data.ecsServices.map((s): EcsEntry => ({ type: 'ecs-service', name: s.name, cluster: s.cluster, desiredCount: s.desiredCount, runningCount: s.runningCount })),
        ...data.lambdaFunctions.map((f): LambdaEntry => ({ type: 'lambda', name: f.name, runtime: f.runtime, memoryMb: f.memoryMb, timeoutSec: f.timeoutSec })),
      ]);
    }).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : 'Failed to load resources');
    }).finally(() => setLoadingResources(false));
  }, []);

  const filtered = resources.filter((r) => {
    const lower = search.toLowerCase();
    return r.name.toLowerCase().includes(lower) || (r.type === 'ecs-service' && r.cluster.toLowerCase().includes(lower));
  });

  const selectedResource = resources.find((r) => resourceKey(r) === selectedKey) ?? null;
  const canRun = !!selectedResource && change.trim().length > 0 && phase === 'idle';

  async function run() {
    if (!selectedResource) return;
    setError(null);
    setOutput(null);

    setPhase('gathering');
    await new Promise((r) => setTimeout(r, 0));

    try {
      const cluster = selectedResource.type === 'ecs-service' ? selectedResource.cluster : undefined;

      setPhase('preparing');
      const apiPromise = aiApi.infraSimulate(selectedResource.type, selectedResource.name, change, cluster);
      await new Promise((r) => setTimeout(r, 600));
      setPhase('analyzing');

      const result = await apiPromise;
      setOutput(result.report);
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Simulation failed');
      setPhase('idle');
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Infrastructure Simulator" />
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Select a resource, describe a change, and get an AI-powered analysis covering cost, performance, reliability, and rollback planning.
      </p>

      <FormCard>
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">Select resource</label>
          <TextInput value={search} onChange={setSearch} placeholder="Search by name or cluster…" />
        </div>

        {loadingResources ? (
          <div className="flex items-center gap-2 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading resources…</div>
        ) : (
          <div className="max-h-56 overflow-y-auto space-y-1 pr-1 border border-gray-100 dark:border-gray-800 rounded-lg p-2">
            {filtered.length === 0 ? (
              <p className="text-sm text-gray-400 p-2">No resources match your search.</p>
            ) : (
              filtered.map((r) => {
                const key = resourceKey(r);
                const isSelected = selectedKey === key;
                return (
                  <button key={key} onClick={() => setSelectedKey(isSelected ? null : key)}
                    className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${isSelected ? 'bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-400' : 'hover:bg-gray-50 dark:hover:bg-zinc-800 border border-transparent'}`}>
                    {r.type === 'ecs-service' ? <Server className="h-4 w-4 text-blue-500 shrink-0" /> : <Zap className="h-4 w-4 text-amber-500 shrink-0" />}
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-gray-900 dark:text-white truncate">{r.name}</span>
                      <span className="block text-xs text-gray-400 truncate">{r.type === 'ecs-service' ? `ECS · ${r.cluster}` : `Lambda · ${r.runtime}`}</span>
                    </span>
                    <span className={`text-xs rounded-full px-2 py-0.5 font-medium shrink-0 ${r.type === 'ecs-service' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                      {r.type === 'ecs-service' ? 'ECS' : 'Lambda'}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}

        {selectedResource && (
          <div className="rounded-lg border border-indigo-100 dark:border-indigo-900/40 bg-indigo-50/40 dark:bg-indigo-950/10 px-4 py-3 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">Selected: {selectedResource.name}</p>
            {selectedResource.type === 'ecs-service' ? (
              <div className="flex gap-4 text-xs text-gray-600 dark:text-gray-400">
                <span>Cluster: <strong className="text-gray-900 dark:text-white">{selectedResource.cluster}</strong></span>
                <span>Desired: <strong className="text-gray-900 dark:text-white">{selectedResource.desiredCount}</strong></span>
                <span>Running: <strong className="text-gray-900 dark:text-white">{selectedResource.runningCount}</strong></span>
              </div>
            ) : (
              <div className="flex gap-4 text-xs text-gray-600 dark:text-gray-400">
                <span>Runtime: <strong className="text-gray-900 dark:text-white">{selectedResource.runtime}</strong></span>
                <span>Memory: <strong className="text-gray-900 dark:text-white">{selectedResource.memoryMb} MB</strong></span>
                <span>Timeout: <strong className="text-gray-900 dark:text-white">{selectedResource.timeoutSec}s</strong></span>
              </div>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">Describe your change</label>
          <Textarea value={change} onChange={setChange} rows={4}
            placeholder="e.g. Increase Lambda memory from 512MB to 2048MB, Add an SQS trigger to this Lambda, Scale max ECS tasks from 5 to 20…" />
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <RunBtn loading={phase !== 'idle' && phase !== 'done'} disabled={!canRun} onClick={() => { void run(); }} label="Simulate" />
          <PhaseIndicator phase={phase} />
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}
      </FormCard>

      {output && <OutputCard output={output} onClear={() => { setOutput(null); setPhase('idle'); }} />}
    </div>
  );
}
