import { Sun, Moon } from 'lucide-react';
import { useTheme, type Theme } from '../lib/theme';

const next: Record<Theme, Theme> = { light: 'dark', dark: 'light', system: 'dark' };

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <button
      onClick={() => setTheme(next[theme])}
      title="Toggle light / dark theme"
      className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-gray-400 transition-all hover:bg-white/5 hover:text-white"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      <span>{isDark ? 'Light mode' : 'Dark mode'}</span>
    </button>
  );
}
