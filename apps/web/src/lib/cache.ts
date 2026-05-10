const TTL_MS = 24 * 60 * 60 * 1000; // 1 day

interface CacheEntry<T> { data: T; expiresAt: number }

export function cacheGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() > entry.expiresAt) { localStorage.removeItem(key); return null; }
    return entry.data;
  } catch { return null; }
}

export function cacheSet<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify({ data, expiresAt: Date.now() + TTL_MS }));
  } catch { /* storage full — ignore */ }
}

export function cacheClear(key: string): void {
  localStorage.removeItem(key);
}
