import { useState } from 'react';
import { PageHeader } from '@wep/ui';
import { aiApi } from '../../lib/api';
import { OutputCard, RunBtn, Textarea, FormCard } from './shared';

export function RunbookAssistantPage() {
  const [problem, setProblem] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);

  const run = async () => {
    setLoading(true); setError(null); setOutput(null);
    try { const r = await aiApi.runbook(problem); setOutput(r.runbook); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Runbook Assistant" />
      <p className="text-sm text-gray-500 dark:text-gray-400">Describe an incident or problem and get a structured investigation runbook with causes, steps, and escalation guidance.</p>
      <FormCard>
        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">Problem description</label>
        <Textarea value={problem} onChange={setProblem} rows={5}
          placeholder="e.g. API latency spiked 3× in the last 30 minutes on the orders service, error rate at 8%, no recent deployments…" />
        <RunBtn loading={loading} disabled={!problem.trim()} onClick={() => { void run(); }} label="Generate Runbook" />
        {error && <p className="text-xs text-red-500">{error}</p>}
      </FormCard>
      {output && <OutputCard output={output} onClear={() => setOutput(null)} />}
    </div>
  );
}
