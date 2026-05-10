/**
 * Lightweight throttle for GitHub API calls. Two layers:
 *
 *  1. Semaphore — caps the number of in-flight GitHub calls system-wide.
 *     Lazy fan-out from any router (Sprint Digest, Project Health, errors,
 *     reconciliation) shares this budget so the API instance can't burst
 *     past the GitHub secondary-rate-limit threshold.
 *
 *  2. Rate-limit guard — Octokit responses carry x-ratelimit-* headers.
 *     We track the latest seen value; if remaining drops below RESERVE,
 *     `assertRateLimitOk` throws a clear error so callers fail loud
 *     instead of issuing more calls and getting silently 429'd.
 *
 *  Wrap any Octokit call with `withGitHubLimit(() => octokit.…)`. After
 *  the response lands, call `recordRateLimit(response.headers)` to keep
 *  the guard up to date.
 */

const MAX_CONCURRENT = 12;     // peak in-flight GitHub calls across the API
const RESERVE = 200;           // bail out before we burn through the last 200

class Semaphore {
  private active = 0;
  private waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return () => this.release();
    }
    return new Promise<() => void>((resolve) => {
      this.waiters.push(() => {
        this.active++;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }

  inFlight(): number { return this.active; }
  queued(): number { return this.waiters.length; }
}

const sem = new Semaphore(MAX_CONCURRENT);

interface RateLimitState {
  remaining: number | null;
  resetAt: number | null;     // ms epoch
  lastSeenAt: number | null;
}
const rl: RateLimitState = { remaining: null, resetAt: null, lastSeenAt: null };

export function recordRateLimit(headers: { [key: string]: unknown } | undefined): void {
  if (!headers) return;
  // Octokit normalises header names to lowercase; defensively try both.
  const get = (k: string): string | undefined => {
    const v = headers[k] ?? headers[k.toLowerCase()];
    return typeof v === 'string' ? v : undefined;
  };
  const remaining = get('x-ratelimit-remaining');
  const reset = get('x-ratelimit-reset');
  if (remaining) {
    const n = Number(remaining);
    if (!isNaN(n)) rl.remaining = n;
  }
  if (reset) {
    const n = Number(reset);
    if (!isNaN(n)) rl.resetAt = n * 1000;
  }
  rl.lastSeenAt = Date.now();
}

export function assertRateLimitOk(): void {
  if (rl.remaining === null) return;
  // If we're past the reset moment, the budget refreshes on next call.
  if (rl.resetAt && Date.now() > rl.resetAt) return;
  if (rl.remaining < RESERVE) {
    const resetIn = rl.resetAt ? Math.max(0, Math.round((rl.resetAt - Date.now()) / 1000)) : null;
    const msg = resetIn !== null
      ? `GitHub rate limit reserve hit (${rl.remaining} calls left, resets in ${resetIn}s)`
      : `GitHub rate limit reserve hit (${rl.remaining} calls left)`;
    throw new Error(msg);
  }
}

export async function withGitHubLimit<T>(fn: () => Promise<T>): Promise<T> {
  assertRateLimitOk();
  const release = await sem.acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

export function getThrottleStatus(): {
  inFlight: number;
  queued: number;
  rateLimit: RateLimitState;
} {
  return { inFlight: sem.inFlight(), queued: sem.queued(), rateLimit: { ...rl } };
}
