import { useState } from 'react';
import { Sparkles, Loader2, Copy, Check, Download } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy} className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
      {copied ? <><Check className="h-3 w-3 text-emerald-500" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
    </button>
  );
}

function DownloadButton({ text }: { text: string }) {
  const download = () => {
    const blob = new Blob([text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-report-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <button onClick={download} className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
      <Download className="h-3 w-3" /> Download
    </button>
  );
}

export function OutputCard({ output, onClear }: { output: string; onClear: () => void }) {
  return (
    <div className="rounded-xl border border-indigo-100 dark:border-indigo-900/40 bg-indigo-50/40 dark:bg-indigo-950/10 shadow-xl shadow-slate-200/20 dark:shadow-black/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
          <Sparkles className="h-3.5 w-3.5" /> AI Response
        </span>
        <div className="flex items-center gap-3">
          <CopyButton text={output} />
          <DownloadButton text={output} />
          <button onClick={onClear} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">Clear</button>
        </div>
      </div>
      <div className="max-h-[60vh] overflow-y-auto pr-1">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-lg font-bold text-gray-900 dark:text-white mt-4 mb-2">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-bold text-gray-900 dark:text-white mt-4 mb-1">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-bold text-gray-900 dark:text-white mt-3 mb-1">{children}</h3>,
          p:  ({ children }) => <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed mb-2">{children}</p>,
          ul: ({ children }) => <ul className="space-y-1 mb-2 pl-1">{children}</ul>,
          ol: ({ children }) => <ol className="space-y-1 mb-2 pl-1 list-decimal list-inside">{children}</ol>,
          li: ({ children }) => (
            <li className="flex gap-2 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              <span className="text-indigo-400 mt-0.5 shrink-0">•</span>
              <span>{children}</span>
            </li>
          ),
          strong: ({ children }) => <strong className="font-semibold text-gray-900 dark:text-white">{children}</strong>,
          code: ({ children, className }) => {
            const isBlock = className?.includes('language-');
            return isBlock
              ? <code className="block bg-gray-100 dark:bg-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-gray-800 dark:text-gray-200 my-2 overflow-x-auto whitespace-pre">{children}</code>
              : <code className="bg-gray-100 dark:bg-zinc-800 rounded px-1 py-0.5 text-xs font-mono text-gray-800 dark:text-gray-200">{children}</code>;
          },
          blockquote: ({ children }) => <blockquote className="border-l-2 border-indigo-300 dark:border-indigo-700 pl-3 my-2 text-sm text-gray-500 dark:text-gray-400 italic">{children}</blockquote>,
          hr: () => <hr className="border-gray-200 dark:border-white/10 my-3" />,
          a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 underline underline-offset-2 hover:text-indigo-700">{children}</a>,
          table: ({ children }) => <div className="overflow-x-auto my-2"><table className="w-full text-xs border-collapse">{children}</table></div>,
          th: ({ children }) => <th className="text-left px-3 py-1.5 bg-gray-50 dark:bg-zinc-800 font-semibold text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-white/10">{children}</th>,
          td: ({ children }) => <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-white/10">{children}</td>,
        }}
      >
        {output}
      </ReactMarkdown>
      </div>
    </div>
  );
}

export function RunBtn({ loading, disabled, onClick, label = 'Generate' }: { loading: boolean; disabled: boolean; onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} disabled={disabled || loading}
      className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 transition-colors">
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      {loading ? 'Generating…' : label}
    </button>
  );
}

export function Textarea({ value, onChange, placeholder, rows = 4 }: { value: string; onChange: (v: string) => void; placeholder: string; rows?: number }) {
  return (
    <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows}
      className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-zinc-900 text-sm text-gray-900 dark:text-white placeholder-gray-400 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none" />
  );
}

export function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-zinc-900 text-sm text-gray-900 dark:text-white placeholder-gray-400 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
  );
}

export function FormCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white dark:border-white/10 dark:bg-zinc-900/40 shadow-xl shadow-slate-200/20 dark:shadow-black/40 p-5 space-y-4">
      {children}
    </div>
  );
}
