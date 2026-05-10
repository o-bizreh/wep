import { clsx } from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

const variants = {
  primary: 'bg-cyan-500 text-white hover:bg-cyan-400 shadow-md shadow-cyan-500/20 border border-transparent',
  secondary: 'bg-white/80 text-zinc-700 border border-zinc-200/50 hover:bg-white shadow-sm dark:bg-zinc-800/80 dark:text-zinc-200 dark:border-zinc-700/50 dark:hover:bg-zinc-700 backdrop-blur-sm',
  ghost: 'bg-transparent text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800',
  danger: 'bg-red-500 text-white hover:bg-red-400 shadow-md shadow-red-500/20 border border-transparent',
} as const;

const sizes = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
} as const;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center rounded-xl font-bold transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:ring-offset-2 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
