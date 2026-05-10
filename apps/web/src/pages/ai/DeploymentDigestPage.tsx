import { useState, useEffect } from 'react';
import { PageHeader } from '@wep/ui';
import { Loader2, GitBranch, ExternalLink } from 'lucide-react';
import { catalogApi, aiApi } from '../../lib/api';
import { OutputCard, RunBtn, FormCard } from './shared';

type Phase = 'idle' | 'gathering' | 'analyzing' | 'done';

export function DeploymentDigestPage() {
  const [repos, setRepos] = useState<string[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);

  useEffect(() => {
    void catalogApi.getDeploymentPreferences()
      .then((d) => setRepos(d.watchedRepos))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load repos'))
      .finally(() => setLoadingRepos(false));
  }, []);

  async function run() {
    if (!selectedRepo) return;
    setError(null);
    setOutput(null);
    setPhase('gathering');

    try {
      // Fetch the deployment feed filtered to this repo's service (match by serviceId / serviceName)
      const feed = await catalogApi.getDeploymentFeed({ page: 1 });
      const relevant = feed.items.filter(
        (d) => d.serviceId === selectedRepo || d.serviceName === selectedRepo || d.serviceId.includes(selectedRepo) || selectedRepo.includes(d.serviceName),
      ).slice(0, 30);

      setPhase('analyzing');

      const result = await aiApi.digest(selectedRepo, relevant as unknown[]);
      setOutput(result.digest);
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Digest failed');
      setPhase('idle');
    }
  }

  const loading = phase !== 'idle' && phase !== 'done';
  const phaseLabel = phase === 'gathering' ? 'Gathering deployments…' : phase === 'analyzing' ? 'Analyzing with AI…' : '';

  return (
    <div className="space-y-6">
      <PageHeader title="Deployment Digest" />
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Choose a tracked repository and get a plain-English summary of recent deployments — frequency, success rate, rollbacks, and notable patterns.
      </p>

      <FormCard>
        {loadingRepos ? (
          <div className="flex items-center gap-2 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading repositories…</div>
        ) : repos.length === 0 ? (
          <div className="rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 space-y-2">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">No watched repositories found</p>
            <p className="text-xs text-amber-600 dark:text-amber-500">
              Go to <a href="/deployments" className="underline font-medium">Deployments</a>, select the repositories you want to track, then come back here.
            </p>
            <a href="/deployments" className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline">
              <ExternalLink className="h-3.5 w-3.5" /> Go to Deployments
            </a>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">Select repository</label>
              <div className="max-h-56 overflow-y-auto space-y-1 border border-gray-100 dark:border-gray-800 rounded-lg p-2">
                {repos.map((repo) => {
                  const isSelected = selectedRepo === repo;
                  return (
                    <button key={repo} onClick={() => setSelectedRepo(isSelected ? null : repo)}
                      className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${isSelected ? 'bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-400' : 'hover:bg-gray-50 dark:hover:bg-zinc-800 border border-transparent'}`}>
                      <GitBranch className="h-4 w-4 text-emerald-400 shrink-0" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{repo}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <RunBtn loading={loading} disabled={!selectedRepo || loading} onClick={() => { void run(); }} label="Generate Digest" />
              {loading && <span className="text-xs text-indigo-500 dark:text-indigo-400 animate-pulse">{phaseLabel}</span>}
            </div>
          </>
        )}

        {error && <p className="text-xs text-red-500">{error}</p>}
      </FormCard>

      {output && <OutputCard output={output} onClear={() => { setOutput(null); setPhase('idle'); }} />}
    </div>
  );
}
