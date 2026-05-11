import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { AlertTriangle, Info, X } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
}

interface AlertOptions {
  title: string;
  message?: string;
  variant?: 'error' | 'info';
}

interface DialogState {
  type: 'confirm' | 'alert';
  options: ConfirmOptions | AlertOptions;
  resolve: (value: boolean) => void;
}

interface DialogContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  alert: (options: AlertOptions) => Promise<void>;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used inside <DialogProvider>');
  return ctx;
}

// ─── Modal UI ─────────────────────────────────────────────────────────────────

function DialogModal({ state, onClose }: { state: DialogState; onClose: (value: boolean) => void }) {
  const { type, options } = state;
  const isConfirm = type === 'confirm';
  const confirmOpts = options as ConfirmOptions;
  const alertOpts = options as AlertOptions;

  const isDanger = isConfirm ? confirmOpts.variant === 'danger' : alertOpts.variant === 'error';

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      aria-modal="true"
      role="dialog"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-zinc-900/50 backdrop-blur-sm"
        onClick={() => isConfirm ? onClose(false) : onClose(true)}
      />

      {/* Card */}
      <div className="relative w-full max-w-sm animate-in fade-in zoom-in-95 duration-200 rounded-2xl border border-slate-200/60 bg-white shadow-2xl shadow-black/20 dark:border-white/10 dark:bg-zinc-900">
        {/* Close button */}
        <button
          onClick={() => onClose(isConfirm ? false : true)}
          className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-white/5 dark:hover:text-white transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="px-6 pt-6 pb-5">
          {/* Icon + Title */}
          <div className="flex items-start gap-3 pr-6">
            <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
              isDanger
                ? 'bg-red-100 dark:bg-red-950/40'
                : 'bg-blue-100 dark:bg-blue-950/40'
            }`}>
              {isDanger
                ? <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
                : <Info className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              }
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-900 dark:text-white leading-snug">
                {options.title}
              </h3>
              {options.message && (
                <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  {options.message}
                </p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="mt-5 flex justify-end gap-2">
            {isConfirm ? (
              <>
                <button
                  onClick={() => onClose(false)}
                  className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                >
                  {confirmOpts.cancelLabel ?? 'Cancel'}
                </button>
                <button
                  onClick={() => onClose(true)}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold text-white transition-colors ${
                    isDanger
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {confirmOpts.confirmLabel ?? 'Confirm'}
                </button>
              </>
            ) : (
              <button
                onClick={() => onClose(true)}
                className={`rounded-xl px-4 py-2 text-sm font-semibold text-white transition-colors ${
                  isDanger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                OK
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function DialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setState({ type: 'confirm', options, resolve });
    });
  }, []);

  const alert = useCallback((options: AlertOptions): Promise<void> => {
    return new Promise<void>((resolve) => {
      setState({ type: 'alert', options, resolve: (v) => { resolve(); } });
    });
  }, []);

  function handleClose(value: boolean) {
    if (!state) return;
    state.resolve(value);
    setState(null);
  }

  return (
    <DialogContext.Provider value={{ confirm, alert }}>
      {children}
      {state && <DialogModal state={state} onClose={handleClose} />}
    </DialogContext.Provider>
  );
}
