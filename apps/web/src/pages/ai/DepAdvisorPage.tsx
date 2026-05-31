import { useState } from 'react';
import { PageHeader } from '@wep/ui';
import { ArrowRight } from 'lucide-react';
import { aiApi } from '../../lib/api';
import { OutputCard, RunBtn, FormCard, TextInput } from './shared';

export function DepAdvisorPage() {
  const [packageName, setPackageName] = useState('');
  const [targetVersion, setTargetVersion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    advice: string;
    affectedRepos: Array<{ repo: string; currentVersion: string }>;
    latestVersion: string;
    packageName: string;
  } | null>(null);

  const canRun = packageName.trim() !== '';

  const run = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const data = await aiApi.depAdvisor(packageName.trim(), targetVersion.trim() || undefined);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Dependency Upgrade Advisor" />
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Enter an npm package name to see which repositories in your org use it, at what versions, and get AI guidance on migration and breaking changes.
      </p>

      <FormCard>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">Package Name</label>
            <TextInput value={packageName} onChange={setPackageName} placeholder="express" />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">Target Version (optional)</label>
            <TextInput value={targetVersion} onChange={setTargetVersion} placeholder="5.0.0" />
          </div>
        </div>

        <RunBtn loading={loading} disabled={!canRun} onClick={() => { void run(); }} label="Analyze Package" />
        {error && <p className="text-xs text-red-500">{error}</p>}
      </FormCard>

      {result && (
        <div className="space-y-4">
          {result.affectedRepos.length > 0 ? (
            <div className="rounded-2xl border border-slate-200/60 bg-white dark:border-white/10 dark:bg-zinc-900/40 shadow-xl shadow-slate-200/20 dark:shadow-black/40 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 dark:border-white/10">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                  Affected Repositories <span className="ml-1.5 text-xs font-normal text-gray-400">({result.affectedRepos.length})</span>
                </h3>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-white/5">
                {result.affectedRepos.map((r) => (
                  <div key={r.repo} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">{r.repo}</span>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 px-2 py-0.5 text-amber-700 dark:text-amber-300 font-mono">
                        {r.currentVersion}
                      </span>
                      <ArrowRight className="h-3 w-3 text-gray-400" />
                      <span className="rounded bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 px-2 py-0.5 text-emerald-700 dark:text-emerald-300 font-mono">
                        {result.latestVersion}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">No repositories found using <code className="font-mono text-xs bg-gray-100 dark:bg-zinc-800 px-1 py-0.5 rounded">{result.packageName}</code>.</p>
          )}
          <OutputCard output={result.advice} onClear={() => setResult(null)} />
        </div>
      )}
    </div>
  );
}
