import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { clsx } from 'clsx';

const CONTEXTS = [
  { id: 'prod', name: 'Production', color: 'bg-emerald-500' },
  { id: 'stg',  name: 'Staging',    color: 'bg-amber-500' },
  { id: 'dev',  name: 'Development', color: 'bg-blue-500' },
];

export function ContextSwitcher() {
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState(CONTEXTS[0]!);
  const [dropdownStyle, setDropdownStyle] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownStyle({ top: rect.bottom + 6, left: rect.left });
    }
  }, [isOpen]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-lg border border-slate-200/50 bg-white/50 px-2.5 py-1.5 text-sm font-medium hover:bg-white dark:border-white/5 dark:bg-black/20 dark:hover:bg-white/5 transition-all outline-none"
      >
        <div className={clsx("h-1.5 w-1.5 rounded-full shadow-sm", selected.color)} />
        <span className="text-zinc-700 dark:text-zinc-300">{selected.name}</span>
        <ChevronDown className={clsx("h-3.5 w-3.5 text-zinc-400 transition-transform", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div
            className="fixed z-50 w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-white/10 dark:bg-zinc-900 animate-in fade-in slide-in-from-top-1"
            style={{ top: dropdownStyle.top, left: dropdownStyle.left }}
          >
            <div className="px-2 py-1.5 mb-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Environment</p>
            </div>
            {CONTEXTS.map((ctx) => (
              <button
                key={ctx.id}
                onClick={() => {
                  setSelected(ctx);
                  setIsOpen(false);
                }}
                className={clsx(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
                  selected.id === ctx.id
                    ? "bg-cyan-500/10 text-cyan-600 dark:bg-cyan-500/20 dark:text-cyan-400"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-white/5"
                )}
              >
                <div className={clsx("h-1.5 w-1.5 rounded-full", ctx.color)} />
                <span className="flex-1 text-left">{ctx.name}</span>
                {selected.id === ctx.id && <Check className="h-3.5 w-3.5" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
