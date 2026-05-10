import type { Result, DomainError, CatalogErrorCode } from '@wep/domain-types';

export interface DiscoveredAWSResource {
  arn: string;
  name: string;
  resourceType: string;
  region: string;
  tags: Record<string, string>;
  serviceId: string | null;
  runningCount?: number;
  desiredCount?: number;
  status?: string;
}

export interface AWSScanResult {
  resources: DiscoveredAWSResource[];
  scannedAt: string;
}

export interface AWSScanner {
  scanECSServices(): Promise<Result<DiscoveredAWSResource[], DomainError<CatalogErrorCode>>>;
  scanLambdaFunctions(): Promise<Result<DiscoveredAWSResource[], DomainError<CatalogErrorCode>>>;
  scanCloudFormationStacks(): Promise<Result<DiscoveredAWSResource[], DomainError<CatalogErrorCode>>>;
  probeLambda(repoName: string): Promise<{
    dev: { exists: boolean; state: string } | null;
    prod: { exists: boolean; state: string } | null;
  }>;
}
