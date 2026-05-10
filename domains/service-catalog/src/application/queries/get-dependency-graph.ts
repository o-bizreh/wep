import type { Result, DomainError, CatalogErrorCode } from '@wep/domain-types';
import type { DependencyRepository, DependencyGraph } from '../../domain/ports/dependency-repository.js';

const graphCache = new Map<string, { graph: DependencyGraph; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export class GetDependencyGraphHandler {
  constructor(private readonly depRepo: DependencyRepository) {}

  async execute(
    serviceId: string,
    depth: number = 2,
  ): Promise<Result<DependencyGraph, DomainError<CatalogErrorCode>>> {
    const clampedDepth = Math.min(Math.max(depth, 1), 5);
    const cacheKey = `${serviceId}:${clampedDepth}`;

    const cached = graphCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ok: true, value: cached.graph };
    }

    const result = await this.depRepo.findDependencies(serviceId, clampedDepth);
    if (result.ok) {
      graphCache.set(cacheKey, { graph: result.value, expiresAt: Date.now() + CACHE_TTL_MS });
    }
    return result;
  }
}

export class GetDependentsHandler {
  constructor(private readonly depRepo: DependencyRepository) {}

  async execute(
    serviceId: string,
    depth: number = 2,
  ): Promise<Result<DependencyGraph, DomainError<CatalogErrorCode>>> {
    return this.depRepo.findDependents(serviceId, Math.min(Math.max(depth, 1), 5));
  }
}
