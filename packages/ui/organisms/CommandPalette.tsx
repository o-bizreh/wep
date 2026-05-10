import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Command, Play, Plus, Zap, ArrowRight } from 'lucide-react';
import { clsx } from 'clsx';

interface CommandItem {
  label: string;
  href: string;
  icon?: React.ReactNode;
  section?: string;
  isAction?: boolean;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  items: CommandItem[];
}

export function CommandPalette({ isOpen, onClose, items }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const allItems = useMemo(() => {
    const list = [...items];
    // Add some simulated platform actions
    list.unshift(
      { label: 'Create New Runbook', href: '/portal/runbooks/new', icon: <Plus className="h-4 w-4" />, section: 'Actions', isAction: true },
      { label: 'Run Manual Audit',   href: '#',                   icon: <Play className="h-4 w-4" />, section: 'Actions', isAction: true },
      { label: 'Clear System Cache',   href: '#',                   icon: <Zap  className="h-4 w-4" />, section: 'Actions', isAction: true },
    );
    return list;
  }, [items]);

  const filteredItems = useMemo(() => {
    const isActionQuery = query.startsWith('>');
    const searchStr = isActionQuery ? query.slice(1).trim() : query.trim();

    return allItems.filter((item) => {
      if (isActionQuery && !item.isAction) return false;
      if (!searchStr) return true;
      
      return (
        item.label.toLowerCase().includes(searchStr.toLowerCase()) || 
        (item.section && item.section.toLowerCase().includes(searchStr.toLowerCase()))
      );
    });
  }, [allItems, query]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredItems.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const selected = filteredItems[selectedIndex];
        if (selected) {
          if (selected.href !== '#') {
            navigate(selected.href);
          }
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredItems, selectedIndex, onClose, navigate]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4 sm:px-6 animate-in fade-in duration-200">
      <div className="fixed inset-0 bg-zinc-900/60 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative w-full max-w-2xl divide-y divide-zinc-200/50 dark:divide-white/10 rounded-2xl bg-white/90 dark:bg-[#1a1c24]/90 backdrop-blur-3xl shadow-[0_32px_128px_-16px_rgba(0,0,0,0.5)] ring-1 ring-zinc-200 dark:ring-white/10 overflow-hidden">
        <div className="flex items-center gap-4 px-6 py-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 dark:bg-white/5">
            {query.startsWith('>') ? <Zap className="h-5 w-5 text-cyan-500" /> : <Search className="h-5 w-5 text-zinc-400" />}
          </div>
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent text-lg text-zinc-900 dark:text-white placeholder-zinc-400 outline-none font-medium"
            placeholder="Search pages or type '>' for actions..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 bg-zinc-100 dark:bg-white/5 rounded-lg border border-zinc-200 dark:border-white/5">
            <kbd className="font-mono text-[10px] text-zinc-400 font-bold uppercase tracking-widest">ESC</kbd>
            <span className="text-[10px] text-zinc-400 font-bold tracking-widest">to close</span>
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-2 py-4 custom-scrollbar">
          {filteredItems.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-50 dark:bg-white/5 mb-4 text-zinc-400">
                <Search className="h-6 w-6" />
              </div>
              <p className="text-zinc-500">No results found for "{query}"</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Grouped logic could go here, but for now simple list with section indicators */}
              <ul className="space-y-1">
                {filteredItems.map((item, idx) => {
                  const isFirstInSection = idx === 0 || filteredItems[idx-1]?.section !== item.section;
                  const isActive = idx === selectedIndex;
                  
                  return (
                    <div key={item.label + item.href}>
                      {isFirstInSection && (
                        <li className="px-4 pt-4 pb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">
                          {item.section || 'General'}
                        </li>
                      )}
                      <li
                        className={clsx(
                          'group flex cursor-pointer select-none items-center gap-4 px-4 py-3 rounded-xl transition-all duration-200',
                          isActive 
                            ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/25 scale-[1.02] transform' 
                            : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5'
                        )}
                        onClick={() => {
                          if (item.href !== '#') navigate(item.href);
                          onClose();
                        }}
                        onMouseEnter={() => setSelectedIndex(idx)}
                      >
                        <div className={clsx(
                          'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                          isActive ? 'bg-white/20 text-white' : 'bg-zinc-100 dark:bg-white/5 text-zinc-400 group-hover:text-cyan-500'
                        )}>
                          {item.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="block font-semibold truncate">{item.label}</span>
                        </div>
                        {isActive && <ArrowRight className="h-4 w-4 animate-in slide-in-from-left-2" />}
                      </li>
                    </div>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
        
        <div className="flex items-center justify-between px-6 py-4 bg-zinc-50 dark:bg-black/20 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
           <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5"><ArrowRight className="h-3 w-3" /> Select</span>
              <span className="flex items-center gap-1.5"><Command className="h-3 w-3" /> Navigation</span>
           </div>
           <div className="flex items-center gap-1.5">
             <div className="px-1.5 py-0.5 rounded border border-zinc-200 dark:border-white/10">{filteredItems.length}</div>
             <span>Results</span>
           </div>
        </div>
      </div>
    </div>
  );
}
