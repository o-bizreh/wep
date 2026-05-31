import { useState } from 'react';
import { PageHeader } from '@wep/ui';
import { Users } from 'lucide-react';
import { aiApi } from '../../lib/api';
import { OutputCard, RunBtn, FormCard, TextInput } from './shared';

export function ReleaseNotesPage() {
  const [owner, setOwner] = useState('washmen');
  const [repo, setRepo] = useState('');
  const [fromSha, setFromSha] = useState('');
  const [toSha, setToSha] = useState('');
  const [version, setVersion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ notes: string; commitCount: number; contributors: string[] } | null>(null);

  const canRun = owner.trim() !== '' && repo.trim() !== '' && fromSha.trim() !== '' && toSha.trim() !== '';

  const run = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const data = await aiApi.releaseNotes(
        owner.trim(), repo.trim(), fromSha.trim(), toSha.trim(),
        version.trim() || undefined,
      );
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Release Notes Generator" />
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Compare two commits or tags and generate clean, grouped release notes ready to share with stakeholders.
      </p>

      <FormCard>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">GitHub Owner</label>
            <TextInput value={owner} onChange={setOwner} placeholder="washmen" />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">Repository</label>
            <TextInput value={repo} onChange={setRepo} placeholder="my-service" />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">Base SHA / Tag</label>
            <TextInput value={fromSha} onChange={setFromSha} placeholder="v1.2.0 or abc1234" />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">Head SHA / Tag</label>
            <TextInput value={toSha} onChange={setToSha} placeholder="v1.3.0 or HEAD" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">Version (optional)</label>
            <TextInput value={version} onChange={setVersion} placeholder="v1.3.0" />
          </div>
        </div>

        <RunBtn loading={loading} disabled={!canRun} onClick={() => { void run(); }} label="Generate Release Notes" />
        {error && <p className="text-xs text-red-500">{error}</p>}
      </FormCard>

      {result && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">{result.commitCount} commits</span>
            <span className="text-gray-300 dark:text-white/20">·</span>
            <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
              <Users className="h-3.5 w-3.5" /> {result.contributors.length} contributor{result.contributors.length !== 1 ? 's' : ''}
            </span>
            {result.contributors.map((c) => (
              <span key={c} className="inline-flex items-center rounded-full bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/40 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
                {c}
              </span>
            ))}
          </div>
          <OutputCard output={result.notes} onClear={() => setResult(null)} />
        </div>
      )}
    </div>
  );
}
