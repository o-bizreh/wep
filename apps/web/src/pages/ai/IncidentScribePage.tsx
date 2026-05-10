import { useState } from 'react';
import { PageHeader } from '@wep/ui';
import { aiApi } from '../../lib/api';
import { OutputCard, RunBtn, Textarea, FormCard } from './shared';

export function IncidentScribePage() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);

  const run = async () => {
    setLoading(true); setError(null); setOutput(null);
    try { const r = await aiApi.incident(input); setOutput(r.report); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Incident Scribe" />
      <p className="text-sm text-gray-500 dark:text-gray-400">Paste error logs, a Slack thread, or raw incident notes and get a structured incident report with timeline, root cause, impact, and action items.</p>
      <FormCard>
        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">Raw incident data</label>
        <Textarea value={input} onChange={setInput} rows={10}
          placeholder="Paste error logs, Slack thread, or notes about the incident…" />
        <RunBtn loading={loading} disabled={!input.trim()} onClick={() => { void run(); }} label="Generate Report" />
        {error && <p className="text-xs text-red-500">{error}</p>}
      </FormCard>
      {output && <OutputCard output={output} onClear={() => setOutput(null)} />}
    </div>
  );
}
