import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, X, Send, Loader2, ChevronDown, Sparkles } from 'lucide-react';
import { assistantApi, type AssistantMessage } from '../lib/api';

const TOOL_LABELS: Record<string, string> = {
  get_cost_overview: 'AWS Costs',
  get_deployment_feed: 'Deployments',
  get_velocity_metrics: 'Velocity Metrics',
  get_errors_overview: 'Error Rates',
  get_services: 'Service Catalog',
  get_infra_resources: 'Infrastructure',
  get_active_portal_requests: 'Portal Requests',
};

const SUGGESTIONS = [
  "What's our AWS spend this month?",
  "Which service had the most failed deploys?",
  "Are there any errors in the last 24h?",
  "How many services do we have in production?",
];

interface ChatEntry {
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
  error?: boolean;
}

export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { if (open) scrollToBottom(); }, [entries, open, scrollToBottom]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userEntry: ChatEntry = { role: 'user', content: trimmed };
    setEntries((prev) => [...prev, userEntry]);
    setInput('');
    setLoading(true);

    // Build history from existing entries (exclude errors)
    const history: AssistantMessage[] = entries
      .filter((e) => !e.error)
      .map((e) => ({ role: e.role, content: e.content }));

    try {
      const result = await assistantApi.chat(trimmed, history);
      setEntries((prev) => [...prev, {
        role: 'assistant',
        content: result.answer,
        toolsUsed: result.toolsUsed,
      }]);
    } catch (e) {
      setEntries((prev) => [...prev, {
        role: 'assistant',
        content: e instanceof Error ? e.message : 'Something went wrong.',
        error: true,
      }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-2xl transition-all duration-200 ${
          open
            ? 'bg-zinc-800 dark:bg-zinc-700 rotate-0'
            : 'bg-gradient-to-br from-cyan-500 to-blue-600 hover:scale-105'
        }`}
        title="Ask WEP Assistant"
      >
        {open
          ? <ChevronDown className="h-5 w-5 text-white" />
          : <MessageCircle className="h-6 w-6 text-white" />}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 flex w-[380px] max-w-[calc(100vw-3rem)] flex-col rounded-2xl border border-slate-200/60 bg-white/90 shadow-2xl shadow-slate-300/30 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/90 dark:shadow-black/50"
          style={{ height: '520px' }}
        >
          {/* Header */}
          <div className="flex items-center gap-2.5 rounded-t-2xl border-b border-slate-200/50 bg-gradient-to-r from-cyan-500/10 to-blue-600/10 px-4 py-3 dark:border-white/5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600">
              <Sparkles className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-zinc-900 dark:text-white">WEP Assistant</p>
              <p className="text-[10px] text-zinc-500">Powered by Amazon Nova Micro</p>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {entries.length === 0 && (
              <div className="space-y-3">
                <p className="text-xs text-zinc-400 text-center pt-2">Ask anything about your platform</p>
                <div className="grid grid-cols-1 gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => void send(s)}
                      className="rounded-xl border border-zinc-200/60 bg-zinc-50/80 px-3 py-2 text-left text-xs text-zinc-600 hover:bg-cyan-50 hover:border-cyan-200 hover:text-cyan-700 transition-colors dark:border-white/10 dark:bg-zinc-800/50 dark:text-zinc-400 dark:hover:bg-cyan-950/30 dark:hover:text-cyan-300"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {entries.map((entry, i) => (
              <div key={i} className={`flex flex-col ${entry.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  entry.role === 'user'
                    ? 'bg-gradient-to-br from-cyan-500 to-blue-600 text-white'
                    : entry.error
                    ? 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400 border border-red-200/50 dark:border-red-800/30'
                    : 'bg-zinc-100/80 text-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-200'
                }`}>
                  {entry.content}
                </div>
                {entry.toolsUsed && entry.toolsUsed.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1 px-1">
                    {entry.toolsUsed.map((t) => (
                      <span key={t} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
                        {TOOL_LABELS[t] ?? t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex items-start gap-2">
                <div className="flex items-center gap-1.5 rounded-2xl bg-zinc-100/80 px-3.5 py-2.5 dark:bg-zinc-800/60">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />
                  <span className="text-xs text-zinc-400">Thinking…</span>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t border-slate-200/50 p-3 dark:border-white/5">
            {entries.length > 0 && (
              <button
                onClick={() => setEntries([])}
                className="mb-2 text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                Clear conversation
              </button>
            )}
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about costs, deployments, errors…"
                disabled={loading}
                className="flex-1 resize-none rounded-xl border border-zinc-200/60 bg-white/80 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/30 disabled:opacity-50 dark:border-white/10 dark:bg-zinc-800/60 dark:text-white dark:placeholder:text-zinc-500 dark:focus:border-cyan-500"
                style={{ maxHeight: '100px', overflowY: 'auto' }}
              />
              <button
                onClick={() => void send(input)}
                disabled={!input.trim() || loading}
                className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-sm transition-all hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1.5 text-[10px] text-zinc-400 text-center">Enter to send · Shift+Enter for new line</p>
          </div>
        </div>
      )}
    </>
  );
}
