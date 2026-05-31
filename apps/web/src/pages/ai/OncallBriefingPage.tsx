import { useState } from 'react';
import { PageHeader } from '@wep/ui';
import { Info } from 'lucide-react';
import { aiApi } from '../../lib/api';
import { OutputCard, RunBtn, FormCard } from './shared';

export function OncallBriefingPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ briefing: string; generatedAt: string } | null>(null);

  const run = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const data = await aiApi.oncallBriefing();
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="On-Call Morning Briefing" />
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Get an AI-generated briefing summarizing recent deployments and active incidents to start your on-call shift informed and ready.
      </p>

      <FormCard>
        <div className="flex items-start gap-2 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40 px-3 py-2.5">
          <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700 dark:text-blue-300">
            Generate each morning at the start of your shift. The briefing pulls live deployment and incident data.
          </p>
        </div>
        <RunBtn loading={loading} disabled={loading} onClick={() => { void run(); }} label="Generate Briefing" />
        {error && <p className="text-xs text-red-500">{error}</p>}
      </FormCard>

      {result && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            Generated at {new Date(result.generatedAt).toLocaleString()}
          </p>
          <OutputCard output={result.briefing} onClear={() => setResult(null)} />
        </div>
      )}
    </div>
  );
}
