import { useState, useRef } from 'react';
import { PageHeader } from '@wep/ui';
import { Upload, X, FileText } from 'lucide-react';
import { aiApi } from '../../lib/api';
import { OutputCard, RunBtn, FormCard } from './shared';

const MAX_SIZE = 1 * 1024 * 1024; // 1 MB

type Phase = 'idle' | 'analyzing' | 'done';

export function CostAnomalyExplainerPage() {
  const [csvText, setCsvText] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    setFileError(null);
    setCsvText(null);
    setFileName(null);
    setOutput(null);
    setPhase('idle');

    if (file.size > MAX_SIZE) { setFileError('File exceeds 1 MB limit.'); return; }
    if (!file.name.endsWith('.csv')) { setFileError('Only CSV files are supported.'); return; }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setCsvText(text);
      setFileName(file.name);
    };
    reader.readAsText(file);
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function clearFile() {
    setCsvText(null);
    setFileName(null);
    setFileError(null);
    setOutput(null);
    setPhase('idle');
  }

  async function run() {
    if (!csvText) return;
    setError(null);
    setOutput(null);
    setPhase('analyzing');
    try {
      // Send CSV as the "trend" data — backend receives it as a string in the array
      const result = await aiApi.costExplain(fileName ?? 'AWS Cost Explorer export', [csvText]);
      setOutput(result.explanation);
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
      setPhase('idle');
    }
  }

  const loading = phase === 'analyzing';

  return (
    <div className="space-y-6">
      <PageHeader title="Cost Anomaly Explainer" />
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Upload a CSV export from AWS Cost Explorer (last 3 months, max 1 MB). The AI will identify where spending is increasing or decreasing and suggest what can be done.
      </p>

      <FormCard>
        {!csvText ? (
          <div
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => inputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-zinc-800/30 px-6 py-10 cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-600 hover:bg-indigo-50/30 dark:hover:bg-indigo-950/10 transition-colors"
          >
            <Upload className="h-8 w-8 text-gray-400" />
            <div className="text-center">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Drop your CSV here or click to browse</p>
              <p className="text-xs text-gray-400 mt-1">CSV from AWS Cost Explorer · Max 1 MB</p>
            </div>
            <input ref={inputRef} type="file" accept=".csv" onChange={onInputChange} className="hidden" />
          </div>
        ) : (
          <div className="space-y-3">
            {/* File header */}
            <div className="flex items-center justify-between rounded-lg border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-950/20 px-3 py-2">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-emerald-500 shrink-0" />
                <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400 truncate">{fileName}</span>
                <span className="text-xs text-emerald-500">{(csvText.length / 1024).toFixed(1)} KB</span>
              </div>
              <button onClick={clearFile} className="text-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* CSV preview — read-only, no parsing */}
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-zinc-900 overflow-hidden">
              <div className="px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-zinc-800">
                <span className="text-xs font-mono text-gray-500 dark:text-gray-400">Preview (read-only)</span>
              </div>
              <pre className="text-xs font-mono text-gray-600 dark:text-gray-400 p-3 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre">
                {csvText.split('\n').slice(0, 30).join('\n')}
                {csvText.split('\n').length > 30 && `\n… (${csvText.split('\n').length - 30} more rows)`}
              </pre>
            </div>
          </div>
        )}

        {fileError && <p className="text-xs text-red-500">{fileError}</p>}

        <div className="flex flex-wrap items-center gap-4">
          <RunBtn loading={loading} disabled={!csvText || loading} onClick={() => { void run(); }} label="Explain Costs" />
          {loading && <span className="text-xs text-indigo-500 dark:text-indigo-400 animate-pulse">Analyzing with AI…</span>}
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}
      </FormCard>

      {output && <OutputCard output={output} onClear={() => { setOutput(null); setPhase('idle'); }} />}
    </div>
  );
}
