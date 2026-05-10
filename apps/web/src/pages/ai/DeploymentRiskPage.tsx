import { useState } from 'react';
import { Loader2, CheckCircle2, Circle, ExternalLink } from 'lucide-react';
import { PageHeader } from '@wep/ui';
import { aiApi, githubApi } from '../../lib/api';
import { OutputCard, RunBtn, TextInput, FormCard } from './shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParsedPr {
  owner: string;
  repo: string;
  prNumber: number;
}

// ---------------------------------------------------------------------------
// PR URL parser
// ---------------------------------------------------------------------------

function parsePrUrl(url: string): ParsedPr | null {
  try {
    const match = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url.trim());
    if (!match) return null;
    return { owner: match[1]!, repo: match[2]!, prNumber: Number(match[3]) };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Phase indicator
// ---------------------------------------------------------------------------

type Phase = 'idle' | 'analyzing' | 'done';

const PHASES: { key: Phase; label: string }[] = [
  { key: 'analyzing', label: 'Fetching PR & analyzing' },
];

function PhaseIndicator({ phase }: { phase: Phase }) {
  if (phase === 'idle' || phase === 'done') return null;
  return (
    <div className="flex items-center gap-3">
      {PHASES.map(({ key, label }, i) => {
        const active = phase === key;
        const done   = PHASES.findIndex((p) => p.key === phase) > i;
        return (
          <div key={key} className="flex items-center gap-1.5">
            {done
              ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              : active
                ? <Loader2 className="h-3.5 w-3.5 text-indigo-500 animate-spin shrink-0" />
                : <Circle className="h-3.5 w-3.5 text-gray-300 dark:text-gray-600 shrink-0" />}
            <span className={`text-xs ${active ? 'text-indigo-600 dark:text-indigo-400 font-medium' : done ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`}>
              {label}
            </span>
            {i < PHASES.length - 1 && <span className="text-gray-300 dark:text-gray-600 ml-1">›</span>}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function DeploymentRiskPage() {
  const [prUrl, setPrUrl]         = useState('');
  const [phase, setPhase]         = useState<Phase>('idle');
  const [error, setError]         = useState<string | null>(null);
  const [output, setOutput]       = useState<string | null>(null);

  // PR comment state
  const [posting, setPosting]         = useState(false);
  const [commentUrl, setCommentUrl]   = useState<string | null>(null);
  const [commentError, setCommentError] = useState<string | null>(null);

  // Parsed URL display
  const parsed = parsePrUrl(prUrl);
  const urlError = prUrl.trim() && !parsed
    ? 'Invalid URL — expected https://github.com/org/repo/pull/123'
    : null;

  const canRun = !!parsed && phase === 'idle';

  async function run() {
    if (!parsed) return;
    setError(null);
    setOutput(null);
    setCommentUrl(null);
    setCommentError(null);

    const { owner, repo, prNumber } = parsed;

    setPhase('analyzing');
    try {
      const result = await aiApi.deploymentRisk({ owner, repo, prNumber });
      setOutput(result.report);
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
      setPhase('idle');
    }
  }

  async function postComment() {
    if (!parsed || !output) return;
    setPosting(true);
    setCommentError(null);
    try {
      const result = await githubApi.postPrComment(parsed.owner, parsed.repo, parsed.prNumber, output);
      setCommentUrl(result.commentUrl);
    } catch (e) {
      setCommentError(e instanceof Error ? e.message : 'Failed to post comment');
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Deployment Risk Scorer" />
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Paste a GitHub Pull Request URL to get a thorough AI-powered risk assessment covering code complexity, blast radius, deployment safety, and a go/no-go recommendation.
      </p>

      <FormCard>
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">GitHub PR URL</label>
          <TextInput
            value={prUrl}
            onChange={setPrUrl}
            placeholder="https://github.com/org/repo/pull/123"
          />
          {parsed && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              {parsed.owner}/{parsed.repo} #{parsed.prNumber}
            </p>
          )}
          {urlError && (
            <p className="text-xs text-red-500">{urlError}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <RunBtn
            loading={phase !== 'idle' && phase !== 'done'}
            disabled={!canRun}
            onClick={() => { void run(); }}
            label="Analyze Risk"
          />
          <PhaseIndicator phase={phase} />
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}
      </FormCard>

      {output && (
        <div className="space-y-3">
          <OutputCard output={output} onClear={() => { setOutput(null); setPhase('idle'); setCommentUrl(null); setCommentError(null); }} />

          {/* Post as PR comment */}
          <div className="flex items-center gap-3 flex-wrap">
            {!commentUrl ? (
              <button
                onClick={() => { void postComment(); }}
                disabled={posting}
                className="inline-flex items-center gap-2 rounded-lg border border-indigo-400 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 disabled:opacity-50 text-sm font-medium px-4 py-2 transition-colors"
              >
                {posting ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Posting…</>
                ) : (
                  'Post as PR Comment'
                )}
              </button>
            ) : (
              <a
                href={commentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 font-medium"
              >
                <CheckCircle2 className="h-4 w-4" />
                Posted to PR
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            {commentError && <p className="text-xs text-red-500">{commentError}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
