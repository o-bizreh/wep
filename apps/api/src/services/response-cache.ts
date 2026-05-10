/**
 * Tiny in-memory response cache for expensive route handlers.
 *
 * Goals:
 *  - Cap upstream AWS API calls (Cost Explorer is 1 req/sec hard limit; CloudWatch
 *    GetMetricData calls compound across users) regardless of how many concurrent
 *    users hit a route.
 *  - Deduplicate concurrent fetches: if 5 users hit `/costs/overview` at the same
 *    time on a cold cache, only the first triggers the upstream work; the rest
 *    await the same Promise.
 *  - Stale-while-revalidate: serve stale data instantly if the upstream fetch
 *    fails (e.g. AWS 429), so a transient throttle doesn't propagate as a 502.
 *
 * Not goals: persistence, distribution. This is a single-process cache. The
 * platform runs one API instance today; if/when it scales horizontally we'll
 * swap this for a Redis-backed implementation behind the same interface.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
  /** When set, refreshes are in-flight; concurrent callers await this Promise. */
  inflight?: Promise<T>;
}

export interface CacheOptions {
  /** Time-to-live in milliseconds. */
  ttlMs: number;
  /**
   * Optional fallback window. Within this many ms after `ttlMs`, if the upstream
   * loader throws, return the stale value instead of propagating the error.
   * Default = ttlMs (so we serve stale up to 2× the TTL on upstream failure).
   */
  staleWhileErrorMs?: number;
}

export class ResponseCache {
  private readonly store = new Map<string, Entry<unknown>>();

  /**
   * Returns the cached value for `key` if fresh; otherwise calls `loader()` once
   * and caches the result. Concurrent callers for the same key share the same
   * in-flight promise so the loader runs at most once per TTL window.
   *
   * On loader error, falls back to a stale value (within `staleWhileErrorMs`)
   * if one exists; otherwise rethrows.
   */
  async getOrLoad<T>(key: string, opts: CacheOptions, loader: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const entry = this.store.get(key) as Entry<T> | undefined;

    if (entry && entry.expiresAt > now) {
      return entry.value;
    }

    if (entry?.inflight) {
      return entry.inflight;
    }

    const inflight = loader().then(
      (value) => {
        this.store.set(key, { value, expiresAt: Date.now() + opts.ttlMs });
        return value;
      },
      (err) => {
        // Allow a stale fallback within the configured grace window.
        const graceMs = opts.staleWhileErrorMs ?? opts.ttlMs;
        if (entry && entry.expiresAt + graceMs > Date.now()) {
          // Retain the entry but mark it for retry on next request by leaving
          // expiresAt as-is. Don't rewrite — we want the next caller to retry.
          this.store.set(key, { value: entry.value, expiresAt: entry.expiresAt });
          return entry.value;
        }
        // No usable stale value — drop the entry so the next caller retries fresh.
        this.store.delete(key);
        throw err;
      },
    );

    // Stash the inflight promise on a placeholder entry so concurrent callers join.
    this.store.set(key, {
      value: entry?.value as T,
      expiresAt: entry?.expiresAt ?? 0,
      inflight,
    });

    return inflight;
  }

  /** Invalidate a single key — useful after a write that should refresh reads. */
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /** Invalidate every key whose name starts with `prefix` (e.g. `'budgets:'`). */
  invalidatePrefix(prefix: string): void {
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) this.store.delete(k);
    }
  }

  /** Diagnostic — exposed for /health-style endpoints if we want it later. */
  size(): number { return this.store.size; }
}

/** Process-wide singleton; keep one instance so all routers share the cache. */
export const responseCache = new ResponseCache();
