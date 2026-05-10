import { createHash } from 'node:crypto';
import {
  type Result,
  success,
  failure,
  type DomainError,
  domainError,
  CatalogErrorCode,
  type RuntimeType,
  type Environment,
  type TeamReference,
} from '@wep/domain-types';
import type { HealthStatus } from '../value-objects/health-status.js';

export type AwsResourceType = 'ECS_SERVICE' | 'LAMBDA' | 'ECR_REPOSITORY' | 'RDS' | 'S3_BUCKET' | 'OTHER';
export type AwsMappingStatus = 'auto-verified' | 'auto-unverified' | 'manual' | 'pending';

export interface AWSResource {
  resourceType: AwsResourceType;
  /** The exact AWS identifier — ECS service name, Lambda function name, etc. */
  identifier: string;
  region: string;
  /** ECS only: the cluster that hosts this service */
  clusterName?: string;
  /** ECR repository name linked to this service */
  ecrRepository?: string;
  /** Whether this mapping was verified against real AWS, derived from config, or set manually */
  mappingStatus: AwsMappingStatus;
  arn?: string;
}

export interface Service {
  serviceId: string;
  serviceName: string;
  repositoryUrl: string;
  /** For monorepo services: path within the repo (e.g. "srv-order"). Null for single-service repos. */
  serviceDirectory?: string;
  runtimeType: RuntimeType;
  ownerTeam: TeamReference;
  environments: Environment[];
  /** Keyed by environment name (e.g. "production", "development") */
  awsResources: Record<string, AWSResource[]>;
  healthStatus: HealthStatus;
  discoveryMethod: 'automated' | 'manual';
  lastSyncedAt: string;
  metadata: Record<string, string>;
  isActive: boolean;
  /** True once AWS resources and health have been resolved for this service. */
  awsEnriched: boolean;
}

export interface CreateServiceInput {
  serviceName: string;
  repositoryUrl: string;
  serviceDirectory?: string;
  runtimeType: RuntimeType;
  ownerTeam: TeamReference;
  environments?: Environment[];
  awsResources?: Record<string, AWSResource[]>;
  discoveryMethod: 'automated' | 'manual';
  metadata?: Record<string, string>;
}

export function generateServiceId(repositoryUrl: string, runtimeType: string): string {
  const hash = createHash('sha256')
    .update(`${repositoryUrl}+${runtimeType}`)
    .digest('hex')
    .slice(0, 12);
  return `svc_${hash}`;
}

export function createService(
  input: CreateServiceInput,
): Result<Service, DomainError<CatalogErrorCode>> {
  if (!input.serviceName.trim()) {
    return failure(domainError(CatalogErrorCode.INVALID_INPUT, 'Service name cannot be empty'));
  }

  if (!input.repositoryUrl.includes('github.com')) {
    return failure(
      domainError(CatalogErrorCode.INVALID_INPUT, 'Repository URL must be a GitHub URL'),
    );
  }

  const service: Service = {
    serviceId: generateServiceId(input.repositoryUrl, input.runtimeType),
    serviceName: input.serviceName,
    repositoryUrl: input.repositoryUrl,
    serviceDirectory: input.serviceDirectory,
    runtimeType: input.runtimeType,
    ownerTeam: input.ownerTeam,
    environments: input.environments ?? [],
    awsResources: input.awsResources ?? {},
    healthStatus: { status: 'unknown', signals: [] },
    discoveryMethod: input.discoveryMethod,
    lastSyncedAt: new Date().toISOString(),
    metadata: input.metadata ?? {},
    isActive: true,
    awsEnriched: false,
  };

  return success(service);
}

export function updateServiceOwnership(
  service: Service,
  newOwnerTeam: TeamReference,
): Result<Service, DomainError<CatalogErrorCode>> {
  return success({
    ...service,
    ownerTeam: newOwnerTeam,
    lastSyncedAt: new Date().toISOString(),
  });
}

export function deregisterService(service: Service): Service {
  return { ...service, isActive: false, lastSyncedAt: new Date().toISOString() };
}
