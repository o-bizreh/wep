export type DependencyType = 'npm-package' | 'aws-resource' | 'api-call' | 'manual';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface Dependency {
  sourceServiceId: string;
  targetServiceId: string;
  dependencyType: DependencyType;
  discoveredAt: string;
  discoveredBy: string;
  confidence: ConfidenceLevel;
}

export function createDependency(
  sourceServiceId: string,
  targetServiceId: string,
  dependencyType: DependencyType,
  discoveredBy: string,
  confidence: ConfidenceLevel,
): Dependency {
  return {
    sourceServiceId,
    targetServiceId,
    dependencyType,
    discoveredAt: new Date().toISOString(),
    discoveredBy,
    confidence,
  };
}
