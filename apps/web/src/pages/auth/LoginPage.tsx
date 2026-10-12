import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { KeySquare, Github, CheckCircle2, Loader2, AlertCircle, ArrowRight, Grid } from 'lucide-react';
import { oauthApi } from '../../lib/api';

type Step = 1 | 2;

interface Status {
  aws: { connected: boolean; username?: string };
  github: { connected: boolean; login?: string };
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepDot({ num, active, done }: { num: number; active: boolean; done: boolean }) {
  return (
    <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-black transition-all duration-300 ${
      done    ? 'bg-teal-500 text-white shadow-lg shadow-teal-500/30' :
      active  ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-lg' :
                'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
    }`}>
      {done ? <CheckCircle2 className="h-4 w-4" /> : num}
    </div>
  );
}

function StepConnector({ done }: { done: boolean }) {
  return (
    <div className={`h-0.5 flex-1 transition-all duration-500 ${done ? 'bg-teal-500' : 'bg-zinc-200 dark:bg-zinc-700'}`} />
  );
}

// ─── Step 1: Connect AWS ──────────────────────────────────────────────────────

function StepAWS({ onConnected, error }: { onConnected: () => void; error: string | null }) {
  const [connecting, setConnecting] = useState(false);

  const handleConnect = () => {
    setConnecting(true);
    window.location.href = '/api/v1/oauth/aws?returnTo=login';
  };

  useEffect(() => {
    if (error) setConnecting(false);
  }, [error]);

  return (
    <div className="flex flex-col items-center text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-2xl shadow-orange-500/25 mb-8">
        <KeySquare className="h-10 w-10 text-white" />
      </div>

      <h2 className="text-2xl font-black tracking-tight text-zinc-900 dark:text-white">Connect AWS</h2>
      <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400 max-w-xs leading-relaxed">
        Sign in with your Washmen IAM Identity Center account. Your session lasts 8 hours.
      </p>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="h-4 w-4 flex-none" />
          {error === 'callback_failed' ? 'Connection failed — check your Identity Center configuration.' : 'Something went wrong. Please try again.'}
        </div>
      )}

      <button
        onClick={handleConnect}
        disabled={connecting}
        className="mt-8 inline-flex items-center gap-3 rounded-2xl bg-zinc-900 dark:bg-white hover:bg-zinc-700 dark:hover:bg-zinc-100 px-8 py-4 text-sm font-bold text-white dark:text-zinc-900 shadow-xl transition-all duration-200 disabled:opacity-60"
      >
        {connecting
          ? <><Loader2 className="h-4 w-4 animate-spin" /> Opening AWS SSO…</>
          : <><KeySquare className="h-4 w-4" /> Sign in with AWS SSO</>
        }
      </button>

      <p className="mt-4 text-[11px] text-zinc-400">
        You'll be redirected to your organisation's AWS SSO login page.
      </p>
    </div>
  );
}

// ─── Step 2: Connect GitHub ───────────────────────────────────────────────────

function StepGitHub({ awsUsername, error }: { awsUsername?: string; error: string | null }) {
  const [connecting, setConnecting] = useState(false);

  const handleConnect = () => {
    setConnecting(true);
    window.location.href = '/api/v1/oauth/github?returnTo=login';
  };

  const handleSkip = () => {
    window.location.href = '/';
  };

  useEffect(() => {
    if (error) setConnecting(false);
  }, [error]);

  return (
    <div className="flex flex-col items-center text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
      {awsUsername && (
        <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-800 px-4 py-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-teal-500" />
          <span className="text-xs font-semibold text-teal-700 dark:text-teal-400">AWS connected as {awsUsername}</span>
        </div>
      )}

      <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-zinc-700 to-zinc-900 shadow-2xl shadow-zinc-900/25 mb-8">
        <Github className="h-10 w-10 text-white" />
      </div>

      <h2 className="text-2xl font-black tracking-tight text-zinc-900 dark:text-white">Connect GitHub</h2>
      <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400 max-w-xs leading-relaxed">
        Authorise WEP to read your repositories and organisation membership. Required for the service catalog, PR Review, and security scans.
      </p>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="h-4 w-4 flex-none" />
          {error === 'callback_failed' ? 'Connection failed — check your GitHub OAuth app configuration.' : 'Something went wrong. Please try again.'}
        </div>
      )}

      <button
        onClick={handleConnect}
        disabled={connecting}
        className="mt-8 inline-flex items-center gap-3 rounded-2xl bg-zinc-900 dark:bg-white hover:bg-zinc-700 dark:hover:bg-zinc-100 px-8 py-4 text-sm font-bold text-white dark:text-zinc-900 shadow-xl transition-all duration-200 disabled:opacity-60"
      >
        {connecting
          ? <><Loader2 className="h-4 w-4 animate-spin" /> Opening GitHub…</>
          : <><Github className="h-4 w-4" /> Authorise on GitHub</>
        }
      </button>

      <button
        onClick={handleSkip}
        className="mt-3 text-xs font-semibold text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
      >
        Skip for now — connect later in Settings
      </button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState<Step>(1);
  const [status, setStatus] = useState<Status | null>(null);
  const [checking, setChecking] = useState(true);
  const [awsError, setAwsError] = useState<string | null>(null);
  const [githubError, setGithubError] = useState<string | null>(null);

  // Check session status and advance steps accordingly
  const checkStatus = async () => {
    try {
      const s = await oauthApi.getStatus();
      setStatus(s as Status);

      if (s.aws.connected && s.github.connected) {
        navigate('/', { replace: true });
        return;
      }
      if (s.aws.connected) {
        setStep(2);
      } else {
        setStep(1);
      }
    } catch {
      setStep(1);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    // Handle OAuth callback query params
    const authResult = searchParams.get('auth');
    const provider = searchParams.get('provider');
    const reason = searchParams.get('reason');

    if (authResult === 'error' && provider === 'aws') setAwsError(reason ?? 'unknown');
    if (authResult === 'error' && provider === 'github') setGithubError(reason ?? 'unknown');

    checkStatus();
  }, []);

  // After a successful callback, re-check and advance
  useEffect(() => {
    const authResult = searchParams.get('auth');
    const provider = searchParams.get('provider');
    if (authResult === 'success' && provider) {
      checkStatus();
    }
  }, [searchParams]);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-[#0b0c10]">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-300 dark:text-zinc-600" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-white dark:bg-[#0b0c10]">
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-[420px] flex-none flex-col justify-between bg-zinc-900 dark:bg-zinc-950 p-12">
        <div>
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-zinc-900 shadow-xl mb-10">
            <Grid className="h-7 w-7" />
          </div>
          <p className="text-xs font-black uppercase tracking-[0.4em] text-zinc-500 mb-2">Washmen</p>
          <h1 className="text-3xl font-black tracking-tight text-white leading-snug">
            Engineering<br />Platform
          </h1>
          <p className="mt-4 text-sm text-zinc-400 leading-relaxed max-w-xs">
            Your unified view of services, deployments, costs, and security — all in one place.
          </p>
        </div>

        {/* Feature list */}
        <div className="space-y-4">
          {[
            { label: 'Service Catalog & Ownership', color: 'bg-teal-500' },
            { label: 'Deployment Tracking & DORA', color: 'bg-blue-500' },
            { label: 'Cost Intelligence', color: 'bg-amber-500' },
            { label: 'Security & Compliance', color: 'bg-violet-500' },
            { label: 'AI Studio', color: 'bg-rose-500' },
          ].map((f) => (
            <div key={f.label} className="flex items-center gap-3">
              <div className={`h-2 w-2 rounded-full flex-none ${f.color}`} />
              <span className="text-sm font-medium text-zinc-400">{f.label}</span>
            </div>
          ))}
        </div>

        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-700">
          © 2026 Washmen Engineering
        </p>
      </div>

      {/* Right panel — wizard */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">

          {/* Logo (mobile only) */}
          <div className="flex lg:hidden items-center gap-3 mb-10">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-md">
              <Grid className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Washmen</p>
              <p className="text-base font-black tracking-tight text-zinc-900 dark:text-white">Engineering Platform</p>
            </div>
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-12">
            <StepDot num={1} active={step === 1} done={status?.aws.connected ?? false} />
            <StepConnector done={status?.aws.connected ?? false} />
            <StepDot num={2} active={step === 2} done={status?.github.connected ?? false} />
          </div>

          {/* Step labels */}
          <div className="flex justify-between mb-10 -mt-10 px-0.5">
            <div className="text-left">
              <p className={`text-[10px] font-black uppercase tracking-widest transition-colors ${step === 1 ? 'text-zinc-900 dark:text-white' : 'text-zinc-400'}`}>Step 1</p>
              <p className={`text-xs font-semibold transition-colors ${step === 1 ? 'text-zinc-600 dark:text-zinc-300' : 'text-zinc-400'}`}>AWS SSO</p>
            </div>
            <div className="text-right">
              <p className={`text-[10px] font-black uppercase tracking-widest transition-colors ${step === 2 ? 'text-zinc-900 dark:text-white' : 'text-zinc-400'}`}>Step 2</p>
              <p className={`text-xs font-semibold transition-colors ${step === 2 ? 'text-zinc-600 dark:text-zinc-300' : 'text-zinc-400'}`}>GitHub</p>
            </div>
          </div>

          {/* Step content */}
          {step === 1 && <StepAWS onConnected={() => setStep(2)} error={awsError} />}
          {step === 2 && <StepGitHub awsUsername={status?.aws.connected ? status.aws.username : undefined} error={githubError} />}

          {/* Already have a session? Go home */}
          {(status?.aws.connected) && (
            <div className="mt-10 pt-8 border-t border-zinc-100 dark:border-zinc-800 text-center">
              <button
                onClick={() => navigate('/')}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
              >
                Go to platform <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
