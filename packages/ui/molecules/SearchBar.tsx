import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';

interface SearchBarProps {
  placeholder?: string;
  value?: string;
  onChange: (value: string) => void;
  debounceMs?: number;
}

export function SearchBar({ placeholder = 'Search...', value, onChange, debounceMs = 300 }: SearchBarProps) {
  const [localValue, setLocalValue] = useState(value ?? '');
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (value !== undefined) setLocalValue(value);
  }, [value]);

  const handleChange = useCallback(
    (newValue: string) => {
      setLocalValue(newValue);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => onChange(newValue), debounceMs);
    },
    [onChange, debounceMs],
  );

  const handleClear = useCallback(() => {
    setLocalValue('');
    onChange('');
  }, [onChange]);

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
      <input
        type="text"
        className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-10 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:border-blue-400"
        placeholder={placeholder}
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
      />
      {localValue && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
