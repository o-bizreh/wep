import { useState } from 'react';
import { PageHeader } from '@wep/ui';
import { GitPullRequest } from 'lucide-react';
import { aiApi } from '../../lib/api';
import { OutputCard, RunBtn, FormCard, TextInput } from './shared';

export function PrReviewPage() {
  const [owner, setOwner] = useState('washmen');
  const [repo, setRepo] = useState('');
  const [prNumber, setPrNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ review: string; prTitle: string; filesReviewed: number } | null>(null);

  const canRun = owner.trim() !== '' && repo.trim() !== '' && /^\d+$/.test(prNumber.trim());

  const run = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const data = await aiApi.prReview(owner.trim(), repo.trim(), parseInt(prNumber.trim(), 10));
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="PR Review Assistant" />
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Enter a GitHub pull request and get an AI-powered code review focused on TypeScript anti-patterns, security issues, missing validation, and test coverage gaps.
      </p>

      <FormCard>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">GitHub Owner</label>
            <TextInput value={owner} onChange={setOwner} placeholder="washmen" />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">Repository</label>
            <TextInput value={repo} onChange={setRepo} placeholder="my-service" />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">PR Number</label>
            <TextInput value={prNumber} onChange={setPrNumber} placeholder="123" />
          </div>
        </div>

        <RunBtn loading={loading} disabled={!canRun} onClick={() => { void run(); }} label="Review PR" />
        {error && <p className="text-xs text-red-500">{error}</p>}
      </FormCard>

      {result && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <GitPullRequest className="h-4 w-4 text-indigo-400" />
            <span className="font-medium text-gray-900 dark:text-white">{result.prTitle}</span>
            <span className="text-gray-400">·</span>
            <span>{result.filesReviewed} file{result.filesReviewed !== 1 ? 's' : ''} reviewed</span>
          </div>
          <OutputCard output={result.review} onClear={() => setResult(null)} />
        </div>
      )}
    </div>
  );
}
