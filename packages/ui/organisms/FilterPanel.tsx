import { SearchBar } from '../molecules/SearchBar.js';

export interface FilterOption {
  label: string;
  value: string;
}

export interface FilterConfig {
  key: string;
  label: string;
  options: FilterOption[];
}

interface FilterPanelProps {
  filters: FilterConfig[];
  values: Record<string, string>;
  searchValue?: string;
  onFilterChange: (key: string, value: string) => void;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
}

export function FilterPanel({
  filters,
  values,
  searchValue,
  onFilterChange,
  onSearchChange,
  searchPlaceholder,
}: FilterPanelProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {onSearchChange && (
        <div className="w-80">
          <SearchBar
            value={searchValue}
            onChange={onSearchChange}
            placeholder={searchPlaceholder}
          />
        </div>
      )}
      {filters.map((filter) => (
        <div key={filter.key} className="relative">
          <select
            className="appearance-none rounded-xl border border-zinc-200/50 bg-white/60 backdrop-blur-xl py-2 pl-4 pr-10 text-sm font-bold text-zinc-700 shadow-sm transition-all focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 hover:bg-white hover:shadow-md dark:border-white/10 dark:bg-zinc-900/40 dark:text-zinc-200 dark:focus:border-cyan-400 dark:hover:bg-zinc-800"
            value={values[filter.key] ?? ''}
            onChange={(e) => onFilterChange(filter.key, e.target.value)}
          >
            <option value="">{filter.label}</option>
            {filter.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-zinc-500">
            <svg className="h-4 w-4 fill-current" viewBox="0 0 20 20">
              <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
            </svg>
          </div>
        </div>
      ))}
    </div>
  );
}
