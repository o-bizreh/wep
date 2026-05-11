import { type ReactNode, useState, useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  Server,
  Rocket,
  BarChart3,
  GitBranch,
  DollarSign,
  Wrench,
  Settings,
  Home,
  ChevronLeft,
  ChevronRight,
  Search,
  Grid,
  Users,
} from 'lucide-react';

import { CommandPalette } from '../organisms/CommandPalette';
import { Breadcrumbs } from '../molecules/Breadcrumbs';
import { ContextSwitcher } from '../molecules/ContextSwitcher';
import { DOMAINS, type NavDomain } from '../constants/navigation';

interface DashboardShellProps {
  children: ReactNode;
  currentPath?: string;
  themeToggle?: ReactNode;
  headerRight?: ReactNode;
}

export function DashboardShell({ children, themeToggle, headerRight }: DashboardShellProps) {
  const { pathname } = useLocation();
  const [activeDomainId, setActiveDomainId] = useState(() => {
    for (const d of DOMAINS) {
      if (!d.isMock && d.sections.some(s => s.items.some(i => pathname.startsWith(i.href)))) {
        return d.id;
      }
    }
    return DOMAINS[0]!.id;
  });
  
  const [isNavExpanded, setIsNavExpanded] = useState(true);
  const [cmdOpen, setCmdOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'h') {
        e.preventDefault();
        window.location.href = '/';
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Update active domain when pathname changes
  useEffect(() => {
    const domain = DOMAINS.find(d => 
      !d.isMock && d.sections.some(s => s.items.some(i => pathname === i.href || (i.href !== '/dashboard' && pathname.startsWith(i.href + '/'))))
    );
    if (domain && domain.id !== activeDomainId) {
      setActiveDomainId(domain.id);
    }
  }, [pathname, activeDomainId]);

  const activeDomain = DOMAINS.find(d => d.id === activeDomainId) || DOMAINS[0]!;

  const commandItems = DOMAINS.filter(d => !d.isMock).flatMap(d => 
    d.sections.flatMap(s => 
      s.items.map(i => ({ ...i, section: s.title }))
    )
  );

  return (
    <div className="flex h-screen bg-[#fafafa] dark:bg-[#0b0c10] transition-colors duration-500 overflow-hidden">
      
      {/* 1. Contextual Sidebar */}
      <aside className={clsx(
        "relative flex flex-col border-r border-slate-200/50 bg-white/60 backdrop-blur-3xl dark:border-white/5 dark:bg-[#0f111a]/40 z-20 transition-all duration-500 ease-in-out shadow-[4px_0_24px_-12px_rgba(0,0,0,0.05)]",
        isNavExpanded ? "w-64" : "w-[72px]"
      )}>
        {/* Launcher Entry */}
        <div className="flex items-center gap-3 px-4 py-8">
           <Link 
             to="/"
             title="Back to App Hub"
             className="h-10 w-10 shrink-0 flex items-center justify-center rounded-[14px] bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 shadow-xl hover:scale-105 active:scale-95 transition-all group"
           >
              <Grid className="h-5 w-5 group-hover:rotate-90 transition-transform duration-500" />
           </Link>
           {isNavExpanded && (
             <div className="flex flex-col animate-in fade-in duration-500">
               <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">Washmen</span>
               <span className="text-sm font-black tracking-tight text-zinc-900 dark:text-white uppercase">{activeDomain.label}</span>
             </div>
           )}
        </div>

        <nav className="flex-1 px-3 space-y-8 overflow-y-auto no-scrollbar py-2">
          {activeDomain.sections.map((section) => (
            <div key={section.title} className="space-y-1">
              {isNavExpanded && (
                <p className="mb-2 px-3 text-[10px] font-black uppercase tracking-[0.25em] text-zinc-400 dark:text-zinc-600">
                  {section.title}
                </p>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const matches = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href + '/'));
                  // Only active if no other item in this section has a longer (more specific) match.
                  const isActive = matches && !section.items.some(
                    (other) => other.href !== item.href && (pathname === other.href || pathname.startsWith(other.href + '/')) && other.href.length > item.href.length
                  );
                  return (
                    <Link
                      key={item.href}
                      to={item.href}
                      title={!isNavExpanded ? item.label : undefined}
                      className={clsx(
                        'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-300',
                        isActive
                          ? 'bg-zinc-950 text-white dark:bg-white dark:text-zinc-900 shadow-lg shadow-black/10'
                          : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-white',
                      )}
                    >
                      <div className={clsx(
                        'transition-transform duration-300 group-hover:scale-110 flex shrink-0',
                        isActive ? 'text-white dark:text-zinc-900' : 'text-zinc-400 dark:text-zinc-500'
                      )}>
                        {item.icon}
                      </div>
                      {isNavExpanded && <span className="whitespace-nowrap">{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Sidebar Footer */}
        <div className="p-3 border-t border-zinc-100 dark:border-white/5 space-y-1">
          <Link
            to="/my-team"
            title={!isNavExpanded ? 'My Team' : undefined}
            className={clsx(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-300",
              pathname.startsWith('/my-team')
                ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5',
              !isNavExpanded && "justify-center"
            )}
          >
            <Users className="h-4 w-4" />
            {isNavExpanded && <span>My Team</span>}
          </Link>
          <Link
            to="/settings"
            title={!isNavExpanded ? 'Settings' : undefined}
            className={clsx(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-300",
              pathname.startsWith('/settings')
                ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5',
              !isNavExpanded && "justify-center"
            )}
          >
            <Settings className="h-4 w-4" />
            {isNavExpanded && <span>Settings</span>}
          </Link>
        </div>
      </aside>

      {/* 2. Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        
        {/* Refined Global Header */}
        <header className="h-20 shrink-0 flex items-center justify-between px-8 border-b border-slate-200/50 bg-white dark:border-white/5 dark:bg-[#0f111a] z-10 transition-all">
          <div className="flex items-center gap-6">
            <button 
              onClick={() => setIsNavExpanded(!isNavExpanded)}
              className="p-2 rounded-xl bg-zinc-50 dark:bg-white/5 text-zinc-400 hover:text-zinc-600 dark:hover:text-white transition-colors"
            >
              {isNavExpanded ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>

            <div className="h-8 w-px bg-slate-200 dark:bg-white/5 hidden lg:block" />

            <div className="flex items-center gap-2">
              <Link
                to="/"
                title="Back to App Hub"
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-white transition-colors"
              >
                  <Home className="h-4 w-4" />
              </Link>
              <span className="text-zinc-300 dark:text-zinc-700 select-none">/</span>
              <span className="text-sm font-bold text-zinc-900 dark:text-white">
                {activeDomain.sections.flatMap(s => s.items).find(i => pathname === i.href || (i.href !== '/dashboard' && pathname.startsWith(i.href + '/')))?.label || activeDomain.label}
              </span>
            </div>
          </div>

          {/* Centered Global Search */}
          <div className="hidden md:flex flex-1 max-w-lg mx-12">
             <div 
               onClick={() => setCmdOpen(true)}
               className="group flex w-full items-center gap-3 px-4 py-2.5 rounded-2xl border border-zinc-200/60 dark:border-white/5 bg-zinc-50 dark:bg-black/20 text-sm font-medium text-zinc-400 cursor-pointer hover:border-zinc-300 dark:hover:bg-white/[0.02] hover:shadow-lg hover:shadow-black/5 transition-all duration-300"
             >
               <Search className="h-4 w-4 group-hover:text-cyan-500 transition-colors" />
               <span className="flex-1">Search or jump to...</span>
               <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 font-mono text-[10px] font-bold">
                 <span className="text-[8px] opacity-60">⌘</span>K
               </div>
             </div>
          </div>

          <div className="flex items-center gap-4">
             <div className="flex items-center gap-1.5 p-1 bg-zinc-100/50 dark:bg-black/20 rounded-2xl border border-zinc-200/50 dark:border-white/5">
                <ContextSwitcher />
                <Link
                  to="/my-team"
                  title="My Team"
                  className={clsx(
                    "p-2 rounded-xl transition-all",
                    pathname.startsWith('/my-team')
                      ? 'bg-white dark:bg-zinc-800 text-cyan-600 dark:text-cyan-400 shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-white'
                  )}
                >
                  <Users className="h-4 w-4" />
                </Link>
                <Link
                  to="/settings"
                  title="Settings"
                  className={clsx(
                    "p-2 rounded-xl transition-all",
                    pathname.startsWith('/settings')
                      ? 'bg-white dark:bg-zinc-800 text-cyan-600 dark:text-cyan-400 shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-white'
                  )}
                >
                  <Settings className="h-4 w-4" />
                </Link>
             </div>

             {themeToggle && <div className="scale-75 -my-2">{themeToggle}</div>}
             {headerRight}
          </div>
        </header>

        {/* Content Body */}
        <main className="flex-1 overflow-y-auto relative p-6 lg:p-10 custom-scrollbar scroll-smooth bg-white dark:bg-[#0b0c10]">
          <div className="mx-auto max-w-7xl relative z-10">
            {children}
          </div>
        </main>
      </div>

      <CommandPalette isOpen={cmdOpen} onClose={() => setCmdOpen(false)} items={commandItems} />
    </div>
  );
}
