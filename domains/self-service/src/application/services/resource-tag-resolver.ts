import {
  ResourceGroupsTaggingAPIClient,
  GetResourcesCommand,
  credentialStore,
  regionStore,
} from '@wep/aws-clients';

const CACHE_TTL_MS = 5 * 60_000;

interface CacheEntry { tags: Record<string, string>; expiresAt: number }

/**
 * Reads the tags of a single AWS resource by ARN. Used by the auto-approval
 * evaluator to check rules like "auto-approve when the target resource has
 * Owner=Customer". Cached briefly to avoid hammering the tagging API on
 * repeated submissions for the same resource.
 *
 * The platform's role needs `tag:GetResources` (commonly granted already).
 */
export class ResourceTagResolver {
  private cache = new Map<string, CacheEntry>();

  async getTags(arn: string): Promise<Record<string, string>> {
    const now = Date.now();
    const cached = this.cache.get(arn);
    if (cached && cached.expiresAt > now) return cached.tags;

    const region = inferRegion(arn) ?? regionStore.getProvider();
    const client = new ResourceGroupsTaggingAPIClient({ region, credentials: credentialStore.getProvider() });
    const tags: Record<string, string> = {};
    try {
      const result = await client.send(new GetResourcesCommand({ ResourceARNList: [arn] }));
      const mapping = result.ResourceTagMappingList?.[0];
      for (const t of mapping?.Tags ?? []) {
        if (t.Key) tags[t.Key] = t.Value ?? '';
      }
    } catch {
      // Tagging API can fail for legitimate reasons (cross-region, IAM, eventual consistency).
      // Treat as "no tags found" — auto-approval rules requiring a tag will then no-match
      // and the request will fall through to manual approval. Safe default.
    }
    this.cache.set(arn, { tags, expiresAt: now + CACHE_TTL_MS });
    return tags;
  }
}

/** Best-effort region extraction from an ARN (`arn:aws:service:region:account:resource`). */
function inferRegion(arn: string): string | null {
  const parts = arn.split(':');
  return parts.length >= 4 && parts[3] ? parts[3] : null;
}
