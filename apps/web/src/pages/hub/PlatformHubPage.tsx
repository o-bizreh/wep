import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Grid, Search, Settings, X, ArrowRight, KeySquare, Github, UserCircle, CheckCircle2, Sparkles
} from 'lucide-react';
import { clsx } from 'clsx';
import { DOMAINS } from '@wep/ui';
import { settings } from '../../lib/settings';
import { settingsApi } from '../../lib/api';

function SetupStep({ num, icon: Icon, title, body, done }: {
  num: number;
  icon: typeof KeySquare;
  title: string;
  body: React.ReactNode;
  done: boolean;
}) {
  return (
    <div className="relative flex gap-4 rounded-2xl border border-white/20 bg-white/10 p-5 backdrop-blur-md transition hover:bg-white/15">
      <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-white/20 ring-1 ring-white/30 shadow-lg">
        {done
          ? <CheckCircle2 className="h-5 w-5 text-emerald-300" />
          : <Icon className="h-5 w-5 text-white" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-widest text-white/60">Step {num}</p>
        <p className="mt-0.5 text-sm font-bold text-white">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-white/80">{body}</p>
      </div>
      {done && (
        <div className="absolute right-4 top-4 rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300 ring-1 ring-emerald-400/30">Done</div>
      )}
    </div>
  );
}

function SetupOverlay({ onDismiss }: { onDismiss: () => void }) {
  const navigate = useNavigate();
  const [credsDone, setCredsDone] = useState(settings.hasAwsCredentials());
  const [githubDone, setGithubDone] = useState(settings.hasGithubToken());
  const allDone = credsDone && githubDone;

  useEffect(() => {
    settingsApi.getStatus().then((s) => {
      setCredsDone(!!s.credentials.source);
      setGithubDone(!!s.github?.tokenConfigured);
    }).catch(() => {});
  }, []);

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center p-6 rounded-[44px] overflow-hidden">
      {/* blurred backdrop over the cards */}
      <div className="absolute inset-0 bg-zinc-950/70 backdrop-blur-md rounded-[44px]" />

      <div className="relative w-full max-w-2xl overflow-hidden rounded-3xl bg-gradient-to-br from-cyan-500 via-blue-600 to-indigo-700 p-8 shadow-2xl shadow-blue-900/50">
        {/* decorative blobs */}
        <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-3xl pointer-events-none" />
        <div className="absolute -left-10 bottom-0 h-40 w-40 rounded-full bg-white/10 blur-2xl pointer-events-none" />

        <button
          onClick={onDismiss}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-white/30 bg-white/10 text-white backdrop-blur-md transition hover:bg-white/20"
          aria-label="Dismiss setup guide"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="relative">
          <div className="flex items-center gap-3 mb-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 ring-1 ring-white/30">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/60">Get started</p>
              <h2 className="text-2xl font-bold text-white tracking-tight">Three steps to unlock the platform</h2>
            </div>
          </div>
          <p className="mt-2 text-sm text-white/80 max-w-lg">
            The platform talks to AWS and GitHub on your behalf. Complete the steps below to activate the catalog, deployments, costs, and the Act tab.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <SetupStep
              num={1}
              icon={KeySquare}
              done={credsDone}
              title="Add AWS SSO keys"
              body={<>Copy your export block from the AWS access portal and paste it in <strong>Settings → Your Profile</strong>.</>}
            />
            <SetupStep
              num={2}
              icon={Github}
              done={githubDone}
              title="Add GitHub token"
              body={<>A PAT with <code className="font-mono text-[11px] bg-white/20 px-1 rounded">read:org</code> + <code className="font-mono text-[11px] bg-white/20 px-1 rounded">repo</code> scopes. Paste it in <strong>Settings → GitHub Token</strong>.</>}
            />
            <SetupStep
              num={3}
              icon={UserCircle}
              done={false}
              title="Fill department & role"
              body="Used by Act-tab auto-approval rules. Match the casing of your resources' Owner tag."
            />
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={() => navigate('/settings')}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-blue-700 shadow-lg shadow-blue-900/30 transition hover:bg-blue-50"
            >
              <Settings className="h-4 w-4" /> Open Settings
            </button>
            {allDone && (
              <button
                onClick={onDismiss}
                className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-5 py-2.5 text-sm font-bold text-white backdrop-blur-md transition hover:bg-white/20"
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-300" /> All done — explore
              </button>
            )}
          </div>

          <p className="mt-4 text-[11px] text-white/50">
            Dismiss this guide with the × button once you're ready to explore.
          </p>
        </div>
      </div>
    </div>
  );
}

export function HubPage() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [showSetupOverlay, setShowSetupOverlay] = useState(
    !settings.hasCompletedFirstRunSetup() && (!settings.hasAwsCredentials() || !settings.hasGithubToken()),
  );

  function dismissSetupOverlay() {
    settings.setFirstRunSetupDone();
    setShowSetupOverlay(false);
  }

  return (
    <div className="min-h-screen bg-white dark:bg-[#0b0c10] transition-colors duration-500 overflow-x-hidden">
      {/* Background Orbs */}
      <div className="fixed top-0 right-0 w-[800px] h-[800px] bg-cyan-500/5 rounded-full blur-[150px] pointer-events-none" />
      <div className="fixed bottom-0 left-0 w-[600px] h-[600px] bg-blue-500/5 rounded-full blur-[150px] pointer-events-none" />

      <div className="relative z-10 w-full max-w-7xl mx-auto px-6 py-12 lg:py-24 animate-in fade-in duration-1000">
        
        {/* HEADER / BRANDING */}
        <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-8 mb-20 px-4">
          <div className="flex items-center gap-6">
            <div className="h-20 w-20 flex items-center justify-center rounded-[28px] bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 shadow-2xl shadow-black/20">
              <Grid className="h-10 w-10" />
            </div>
            <div className="flex flex-col select-none">
              <span className="text-sm font-black uppercase tracking-[0.5em] text-zinc-400 leading-none mb-3">Washmen</span>
              <h1 className="text-4xl lg:text-5xl font-black tracking-tighter text-zinc-900 dark:text-white uppercase leading-none">
                Engineering <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-500 to-blue-600">Platform</span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Link
              to="/settings"
              className="h-14 w-14 flex items-center justify-center rounded-2xl bg-zinc-100 dark:bg-white/5 text-zinc-500 hover:text-cyan-500 hover:bg-white dark:hover:bg-white/10 transition-all shadow-sm"
              title="Global Settings"
            >
              <Settings className="h-7 w-7" />
            </Link>
          </div>
        </header>

        {/* SEARCH SECTION */}
        <div className="max-w-3xl mb-24 px-4">
          <div className="relative group">
            <div className="absolute inset-y-0 left-6 flex items-center pointer-events-none">
              <Search className="h-6 w-6 text-zinc-400 group-focus-within:text-cyan-500 transition-colors" />
            </div>
            <input 
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search services, workflows, or infrastructure..."
              className="w-full bg-white/50 dark:bg-zinc-900/50 backdrop-blur-2xl border-2 border-zinc-100 dark:border-white/5 rounded-[32px] pl-16 pr-8 py-6 text-xl font-medium text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/5 shadow-2xl shadow-black/5 transition-all"
            />
            <div className="absolute inset-y-0 right-6 flex items-center gap-2">
              <kbd className="hidden sm:inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 font-mono text-xs font-bold text-zinc-400">
                ⌘K
              </kbd>
            </div>
          </div>
          <p className="mt-4 px-6 text-sm text-zinc-400 font-medium">
            Quickly jump between modules or search for specific resources.
          </p>
        </div>

        {/* MODULE GRID */}
        <div className="relative px-4">
        {showSetupOverlay && <SetupOverlay onDismiss={dismissSetupOverlay} />}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {DOMAINS.map((domain, idx) => {
            const isMock = domain.isMock;
            const items = domain.sections.flatMap((s) => s.items);
            const totalItems = items.length;
            const previewItems = items.slice(0, 3);
            const remainder = Math.max(0, totalItems - previewItems.length);

            return (
              <div
                key={domain.id}
                onClick={() => {
                  if (!isMock) {
                    const firstHref = domain.sections[0]?.items[0]?.href || '/dashboard';
                    navigate(firstHref);
                  }
                }}
                style={{ animationDelay: `${idx * 50}ms` }}
                className={clsx(
                  "group relative flex flex-col p-8 rounded-[44px] border transition-all duration-700 cursor-pointer overflow-hidden animate-in fade-in slide-in-from-bottom-6 block",
                  isMock
                    ? "border-zinc-100 dark:border-white/5 bg-zinc-50/30 dark:bg-white/[0.01] opacity-60 grayscale hover:grayscale-0 hover:opacity-100"
                    : "border-zinc-200/60 bg-white/80 dark:border-white/10 dark:bg-zinc-900/80 backdrop-blur-xl shadow-xl hover:shadow-[0_40px_80px_-20px_rgba(0,0,0,0.12)] hover:-translate-y-4"
                )}
              >
                <div className={clsx(
                  "h-16 w-16 rounded-[24px] flex items-center justify-center mb-10 text-white shadow-2xl bg-gradient-to-br transition-all duration-500 group-hover:scale-110 group-hover:rotate-6",
                  domain.color
                )}>
                  {domain.icon}
                </div>

                <div className="flex-1">
                  <h3 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tighter flex items-center gap-3">
                    {domain.label}
                    {isMock && <span className="text-[10px] font-black uppercase text-zinc-400 tracking-[0.2em] border border-zinc-200 dark:border-white/10 px-2 py-0.5 rounded-full">Soon</span>}
                  </h3>
                  <p className="mt-3 text-base text-zinc-500 leading-relaxed font-medium">
                    {domain.description}
                  </p>
                </div>

                <div className="mt-12 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex -space-x-3">
                      {previewItems.map((item, i) => (
                        <div
                          key={item.href}
                          title={item.label}
                          className="h-8 w-8 rounded-full border-4 border-white dark:border-zinc-900 bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500 dark:text-zinc-400"
                          style={{ zIndex: previewItems.length - i }}
                        >
                          {item.icon}
                        </div>
                      ))}
                      {remainder > 0 && (
                        <div className="h-8 w-8 rounded-full border-4 border-white dark:border-zinc-900 bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-400 group-hover:text-cyan-500 transition-colors">
                          +{remainder}
                        </div>
                      )}
                    </div>
                    <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
                      {totalItems} {totalItems === 1 ? 'tool' : 'tools'}
                    </span>
                  </div>
                  {!isMock && (
                    <div className="h-12 w-12 rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 flex items-center justify-center opacity-0 group-hover:opacity-100 group-hover:translate-x-0 -translate-x-6 transition-all duration-500 shadow-xl shadow-black/10">
                      <ArrowRight className="h-6 w-6" />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        </div>

        {/* HUB FOOTER */}
        <footer className="mt-32 pt-12 border-t border-zinc-100 dark:border-white/5 flex flex-col items-center gap-8">
          <div className="flex flex-wrap justify-center gap-x-12 gap-y-4">
            <a href="#" className="text-xs font-bold text-zinc-400 uppercase tracking-widest hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">Documentation</a>
            <a href="https://status.washmen.com/" target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-zinc-400 uppercase tracking-widest hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">Platform Status</a>
            <a href="#" className="text-xs font-bold text-zinc-400 uppercase tracking-widest hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">Community Support</a>
            <a href="#" className="text-xs font-bold text-zinc-400 uppercase tracking-widest hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">Engineering Blog</a>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="text-[10px] font-black text-zinc-300 dark:text-zinc-700 uppercase tracking-[0.6em]">
              Build v2.4.0 • Region: EU-WEST-1 • 2026 Washmen Engineering
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}


