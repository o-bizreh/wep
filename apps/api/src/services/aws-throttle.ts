/**
 * Lightweight semaphore + per-API rate-limit guard for AWS SDK calls.
 *
 * Why this exists:
 *  - AWS Cost Explorer is hard-capped at ~1 request/second per account. Burst
 *    above that and AWS returns `ThrottlingException` / 429.
 *  - CloudWatch GetMetricData is generous but our portfolio recommendations
 *    endpoint can issue dozens of parallel batches; without a ceiling we'll
 *    drown the account.
 *  - Without a guard a single slow request can pin the event loop on
 *    ~20 outbound connections; a semaphore shapes the burst.
 *
 * Pattern mirrors apps/api/src/services/github-throttle.ts (semaphore-based);
 * we keep it intentionally simple — no exponential backoff, no header parsing,
 * just concurrency caps. AWS SDKs already retry their own 429s; our job is to
 * not generate them in the first place.
 */

class Semaphore {
  private inUse = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.inUse < this.max) {
      this.inUse++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.inUse++;
  }

  release(): void {
    this.inUse--;
    const next = this.waiters.shift();
    if (next) next();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try { return await fn(); }
    finally { this.release(); }
  }
}

// CloudWatch GetMetricData: generous limits but the portfolio endpoints fan
// out dozens of parallel batches. 8 concurrent in-flight is a sane ceiling.
export const cloudwatchSemaphore = new Semaphore(8);

// Cost Explorer hard-caps at ~1 request/sec. Use a single-slot semaphore so
// concurrent callers serialise even within one route handler.
export const costExplorerSemaphore = new Semaphore(1);

// ECS DescribeServices/DescribeTaskDefinition: generous but we're chained.
export const ecsSemaphore = new Semaphore(10);
