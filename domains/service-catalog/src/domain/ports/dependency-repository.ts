import type { Result, DomainError, CatalogErrorCode } from '@wep/domain-types';
import type { Dependency } from '../entities/dependency.js';

export interface DependencyGraphNode {
  serviceId: string;
  serviceName: string;
  healthStatus: string;
}

export interface DependencyGraph {
  nodes: DependencyGraphNode[];
  edges: Dependency[];
}

export interface DependencyRepository {
  save(dependency: Dependency): Promise<Result<void, DomainError<CatalogErrorCode>>>;
  findDependencies(
    serviceId: string,
    depth: number,
  ): Promise<Result<DependencyGraph, DomainError<CatalogErrorCode>>>;
  findDependents(
    serviceId: string,
    depth: number,
  ): Promise<Result<DependencyGraph, DomainError<CatalogErrorCode>>>;
  delete(
    sourceServiceId: string,
    targetServiceId: string,
  ): Promise<Result<void, DomainError<CatalogErrorCode>>>;
}
