import { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@wep/ui';
import { CalendarDays, Rocket, Server, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { fetchApi } from '../../lib/api';

interface WeeklyDigest {
  generatedAt: string;
  weekOf: string;
  deployments: { total: number; services: string[] };
  highlights: string[];
}

export function WeeklyDigestPage() {
  const [digest, setDigest] = useState<WeeklyDigest | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [noDigest, setNoDigest] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchApi<WeeklyDigest>('/notify/weekly-digest/latest');
      setDigest(data);
      setNoDigest(false);
    } catch {
      setNoDigest(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function generate() {
    setGenerating(true);
    try {
      const data = await fetchApi<WeeklyDigest>('/notify/weekly-digest/generate', { method: 'POST' });
      setDigest(data);
      setNoDigest(false);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Weekly Engineering Digest"
        actions={
          <button onClick={() => { void generate(); }} disabled={generating}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors">
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Generate Digest
          </button>
        }
      />

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
      ) : noDigest && !digest ? (
        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 py-16 text-center text-sm text-gray-500">
          No digest generated yet. Click "Generate Digest" to create one.
        </div>
      ) : digest ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <CalendarDays className="h-3.5 w-3.5" />
            <span>Week of {digest.weekOf}</span>
            <span className="mx-1">·</span>
            <span>Generated {new Date(digest.generatedAt).toLocaleString()}</span>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
              <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                <Rocket className="h-4 w-4 text-indigo-500" />
                Deployments
              </div>
              <div className="text-3xl font-bold text-indigo-600 dark:text-indigo-400">{digest.deployments.total}</div>
              <p className="text-xs text-gray-400 mt-1">in the last 7 days</p>
            </div>

            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
              <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                <Server className="h-4 w-4 text-emerald-500" />
                Services Deployed
              </div>
              <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">{digest.deployments.services.length}</div>
              <p className="text-xs text-gray-400 mt-1">unique services</p>
            </div>

            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 sm:col-span-2 lg:col-span-1">
              <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                <CalendarDays className="h-4 w-4 text-amber-500" />
                Week Of
              </div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">
                {new Date(digest.weekOf + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </div>
              <p className="text-xs text-gray-400 mt-1">Monday start</p>
            </div>
          </div>

          {/* Services List */}
          {digest.deployments.services.length > 0 && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Services Deployed</p>
              <div className="flex flex-wrap gap-2">
                {digest.deployments.services.map(svc => (
                  <span key={svc}
                    className="inline-flex rounded-full bg-gray-100 dark:bg-gray-800 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:text-gray-300">
                    {svc}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Highlights */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Highlights</p>
            </div>
            <ul className="space-y-2">
              {digest.highlights.map((h, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0" />
                  {h}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
