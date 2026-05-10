/**
 * Tiny request cache + hook with the properties of TanStack Query that we
 * actually need, without the dependency.
 *
 * Properties:
 *  1. **Survives navigation.** Cached results live in a module-level Map, not
 *     inside React state. Going A → B → A returns the cached value instantly
 *     while a background refetch validates it.
 *  2. **Doesn't cancel on unmount.** A page started loading and the user
 *     navigated away? The fetch keeps running. When they come back, the
 *     answer is already there.
 *  3. **Deduplicates concurrent fetches.** Two components mounting the same
 *     key share one in-flight Promise.
 *  4. **Stale-while-revalidate.** When TTL expires we still return the stale
 *     value immediately, then refetch in the background and notify subscribers.
 *
 * Trade-offs deliberately taken vs TanStack Query: no infinite query, no
 * mutation helpers, no devtools, no per-component error retry policy. Add
 * those only if a feature actually requires them.
 */

import { useEffect, useState } from 'react';

interface Entry<T> {
  value: T | undefined;
  expiresAt: number;
  inflight?: Promise<T>;
  error?: unknown;
}

type Listener = () => void;

const store = new Map<string, Entry<unknown>>();
const listeners = new Map<string, Set<Listener>>();

function notify(key: string): void {
  const set = listeners.get(key);
  if (!set) return;
  for (const l of set) l();
}

function subscribe(key: string, listener: Listener): () => void {
  let set = listeners.get(key);
  if (!set) { set = new Set(); listeners.set(key, set); }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(key);
  };
}

interface QueryOptions {
  /** Time the value is considered fresh. After this, we refetch in the background. */
  staleTimeMs?: number;
  /**
   * If true, the query is paused and won't fetch. Pages with required URL
   * params often need this to avoid firing on null.
   */
  enabled?: boolean;
}

const DEFAULT_STALE_MS = 60_000;

/**
 * Forces a refetch for `key` even if the cached value is fresh. Use after a
 * mutation that should reflect immediately.
 */
export function invalidateQuery(key: string): void {
  const entry = store.get(key);
  if (!entry) return;
  store.set(key, { ...entry, expiresAt: 0 });
  notify(key);
}

/** Drop everything matching a prefix — useful for "invalidate all budgets". */
export function invalidatePrefix(prefix: string): void {
  for (const k of [...store.keys()]) {
    if (k.startsWith(prefix)) {
      const e = store.get(k);
      if (e) store.set(k, { ...e, expiresAt: 0 });
      notify(k);
    }
  }
}

/** Synchronous read of any cached value. Mostly for SSR-style pre-fills. */
export function peekQuery<T>(key: string): T | undefined {
  return store.get(key)?.value as T | undefined;
}

/**
 * Triggers a fetch for `key` if no fresh value is in cache. Safe to call
 * repeatedly; concurrent calls dedupe to a single Promise.
 */
function ensureFetched<T>(key: string, fetcher: () => Promise<T>, staleMs: number): void {
  const now = Date.now();
  const entry = store.get(key) as Entry<T> | undefined;

  if (entry && entry.expiresAt > now) return;       // fresh
  if (entry?.inflight) return;                       // someone else is fetching

  const inflight = fetcher().then(
    (value) => {
      store.set(key, { value, expiresAt: Date.now() + staleMs });
      notify(key);
      return value;
    },
    (err) => {
      // Keep the previous value so subscribers can show stale-on-error;
      // mark error so callers know.
      const prev = store.get(key) as Entry<T> | undefined;
      store.set(key, { value: prev?.value, expiresAt: 0, error: err });
      notify(key);
      throw err;
    },
  );

  store.set(key, {
    value: entry?.value,
    expiresAt: entry?.expiresAt ?? 0,
    inflight,
  });
  notify(key);
}

export interface QueryResult<T> {
  data: T | undefined;
  /** True when there's no cached value AND a fetch is in progress. */
  isLoading: boolean;
  /** True when there IS a cached value but a refetch is running in the background. */
  isFetching: boolean;
  error: unknown;
  refetch: () => void;
}

/**
 * Subscribes a component to a cached query. Renders the cached value
 * immediately when present; triggers a background fetch when stale.
 *
 * Identity of `fetcher` is irrelevant — the cache key is what matters.
 * Pass a stable string key per logical resource (e.g. `costs:overview`).
 */
export function useCachedQuery<T>(key: string, fetcher: () => Promise<T>, opts: QueryOptions = {}): QueryResult<T> {
  const enabled = opts.enabled ?? true;
  const staleMs = opts.staleTimeMs ?? DEFAULT_STALE_MS;

  const [, force] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = subscribe(key, () => force((n) => n + 1));
    ensureFetched(key, fetcher, staleMs);
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, staleMs]);

  const entry = store.get(key) as Entry<T> | undefined;
  return {
    data: entry?.value,
    isLoading: !entry?.value && !!entry?.inflight,
    isFetching: !!entry?.inflight,
    error: entry?.error,
    refetch: () => {
      invalidateQuery(key);
      if (enabled) ensureFetched(key, fetcher, staleMs);
    },
  };
}
