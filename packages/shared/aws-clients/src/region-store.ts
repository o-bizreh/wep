/**
 * Runtime-configurable AWS region store.
 *
 * Priority:
 *   1. Explicit override set via Settings UI / API
 *   2. AWS_REGION environment variable
 *   3. Hard-coded default: eu-west-1 (Washmen primary region)
 *
 * The provider function is AWS-SDK-compatible (returns Promise<string>),
 * so existing module-level clients that accept it pick up changes on the
 * next API call without needing to be recreated.
 */
class RegionStore {
  private override: string | null = null;

  get(): string {
    return this.override ?? process.env['AWS_REGION'] ?? 'eu-west-1';
  }

  set(region: string): void {
    this.override = region;
  }

  clear(): void {
    this.override = null;
  }

  /** AWS SDK compatible region provider — resolves on every call. */
  getProvider(): () => Promise<string> {
    const self = this;
    return () => Promise.resolve(self.get());
  }
}

/** Singleton — one store for the lifetime of the API process. */
export const regionStore = new RegionStore();
