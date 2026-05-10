import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles, Eye, Zap, Activity, ShieldCheck, Cpu, ArrowRight, ArrowLeft,
  Settings as SettingsIcon, X,
} from 'lucide-react';
import { settings } from '../lib/settings';

interface Slide {
  /** Icon used as the hero visual. */
  icon: typeof Sparkles;
  /** Eyebrow label above the title. */
  eyebrow: string;
  title: string;
  description: string;
  /** Tailwind classes for the gradient background of the hero panel. */
  gradient: string;
}

const SLIDES: Slide[] = [
  {
    icon: Sparkles,
    eyebrow: 'Welcome',
    title: 'The Washmen Engineering Platform',
    description:
      "One place to see what's running, ship safely, measure delivery, and act fast when things go wrong.",
    gradient: 'from-cyan-500 via-blue-500 to-indigo-600',
  },
  {
    icon: Eye,
    eyebrow: 'Observe',
    title: 'See what you own and what changed',
    description:
      'Service catalog, deployments, errors and pipeline health — kept in sync with GitHub and AWS automatically.',
    gradient: 'from-blue-500 via-cyan-500 to-teal-500',
  },
  {
    icon: Zap,
    eyebrow: 'Act',
    title: 'Self-serve operations with safe defaults',
    description:
      'Request short-lived credentials, run runbooks, and let auto-approval handle the routine. Slack DMs deliver creds; CloudTrail records the actor.',
    gradient: 'from-amber-500 via-orange-500 to-rose-500',
  },
  {
    icon: Activity,
    eyebrow: 'Measure',
    title: 'Velocity, quality, and cost — at a glance',
    description:
      'Sprint digests, DORA metrics, AWS spend trends, rightsizing recommendations and budget alerts. Lazy-scanned so it stays fast.',
    gradient: 'from-emerald-500 via-teal-500 to-cyan-500',
  },
  {
    icon: ShieldCheck,
    eyebrow: 'Security & AI',
    title: 'Vulnerability feeds and agentic helpers',
    description:
      'CVE triage, GitLeaks reports, AI-generated runbooks and deployment risk scoring — wherever a human in the loop adds value.',
    gradient: 'from-indigo-600 via-violet-600 to-purple-600',
  },
  {
    icon: SettingsIcon,
    eyebrow: 'Get started',
    title: 'Two minutes to set up',
    description:
      'Add your AWS SSO session keys and a GitHub token in Settings. The platform identifies you, populates your profile, and starts pulling data.',
    gradient: 'from-zinc-700 via-zinc-800 to-zinc-900',
  },
];

interface OnboardingProps {
  onClose: () => void;
}

/**
 * Full-screen first-run tour. Shown once per browser (localStorage flag set
 * via settings.setOnboardingSeen) and dismissable from any slide. Both Skip
 * and the final "Open Settings" button mark the flag and route the user to
 * /settings, where the GET_STARTED card explains what to do next.
 */
export function Onboarding({ onClose }: OnboardingProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const slide = SLIDES[step]!;
  const isFirst = step === 0;
  const isLast = step === SLIDES.length - 1;

  const goToHome = () => {
    onClose();
    navigate('/');
  };

  // Keyboard navigation: arrows to step, Esc to skip → home.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') goToHome();
      else if (e.key === 'ArrowRight' && !isLast) setStep((s) => s + 1);
      else if (e.key === 'ArrowLeft' && !isFirst) setStep((s) => s - 1);
      else if (e.key === 'Enter' && isLast) goToHome();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFirst, isLast]);

  const Icon = slide.icon;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/80 backdrop-blur-md p-4 animate-fade-in">
      <div className="relative w-full max-w-3xl overflow-hidden rounded-3xl border border-white/10 bg-white shadow-2xl shadow-black/40 dark:bg-zinc-950">
        {/* Skip button — always visible, top-right. Routes to /settings so
            the user lands on the same instructions the final slide promises. */}
        <button
          onClick={goToHome}
          className="absolute right-4 top-4 z-20 inline-flex items-center gap-1 rounded-full border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-md transition hover:bg-white/20"
          aria-label="Skip onboarding and go to home"
        >
          <X className="h-3.5 w-3.5" /> Skip
        </button>

        {/* Hero panel — gradient + animated icon */}
        <div className={`relative overflow-hidden bg-gradient-to-br ${slide.gradient} px-8 pt-12 pb-10`}>
          {/* Decorative blobs */}
          <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -left-12 bottom-0 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
          <div className="relative">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-md ring-1 ring-white/30 shadow-2xl">
              <Icon className="h-9 w-9 text-white drop-shadow" />
            </div>
            <p className="mt-6 text-xs font-bold uppercase tracking-[0.2em] text-white/80">{slide.eyebrow}</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">{slide.title}</h1>
            <p className="mt-3 max-w-xl text-base text-white/90">{slide.description}</p>
          </div>
        </div>

        {/* Body — keyboard hint only; per-slide quick-link cards intentionally
            removed so users complete the tour before jumping into the app. */}
        <div className="px-8 py-6">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Tip: use the <kbd className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-mono dark:bg-zinc-800">←</kbd> and{' '}
            <kbd className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-mono dark:bg-zinc-800">→</kbd> arrow keys to navigate, or{' '}
            <kbd className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-mono dark:bg-zinc-800">Esc</kbd> to skip.
          </p>
        </div>

        {/* Footer — progress dots + nav */}
        <div className="flex items-center justify-between gap-4 border-t border-zinc-200/60 bg-zinc-50/60 px-8 py-4 dark:border-white/5 dark:bg-zinc-900/40">
          <div className="flex items-center gap-1.5">
            {SLIDES.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                aria-label={`Go to slide ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${
                  i === step
                    ? 'w-8 bg-gradient-to-r from-cyan-500 to-blue-600'
                    : 'w-1.5 bg-zinc-300 hover:bg-zinc-400 dark:bg-zinc-700 dark:hover:bg-zinc-600'
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={isFirst}
              className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-30 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            {isLast ? (
              <button
                onClick={goToHome}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-sm font-bold text-white shadow-md shadow-cyan-500/30 transition hover:shadow-cyan-500/50"
              >
                <SettingsIcon className="h-4 w-4" /> Get Started
              </button>
            ) : (
              <button
                onClick={() => setStep((s) => s + 1)}
                className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-sm font-bold text-white shadow-md shadow-cyan-500/30 transition hover:shadow-cyan-500/50"
              >
                Next <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Stateful wrapper — checks the flag on mount and renders the tour if the user
 * hasn't seen it. Closing (Skip or Finish) sets the flag so it never reappears.
 */
export function OnboardingGate() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!settings.hasSeenOnboarding()) setShow(true);
  }, []);

  if (!show) return null;
  return (
    <Onboarding
      onClose={() => {
        settings.setOnboardingSeen(true);
        setShow(false);
      }}
    />
  );
}
