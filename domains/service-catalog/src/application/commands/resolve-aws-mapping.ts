import {
  type Result,
  success,
  failure,
  domainError,
  CatalogErrorCode,
  type DomainError,
} from '@wep/domain-types';
import { ECSClient, DescribeServicesCommand } from '@wep/aws-clients';
import type { ServiceRepository } from '../../domain/ports/service-repository.js';
import type { AWSResource } from '../../domain/entities/service.js';
import { MonorepoDetector, type MonorepoServiceMapping } from '../../infrastructure/github/monorepo-detector.js';

export interface ResolvedMapping {
  environment: string;
  resources: AWSResource[];
}

export interface ResolveMappingResult {
  /** Mappings that were successfully resolved (auto or manual) */
  resolved: ResolvedMapping[];
  /** True if the user needs to pick mappings manually */
  needsManualInput: boolean;
  /** Available ECS services in the cluster for the UI picker */
  suggestions?: string[];
  /** For monorepo: the folder → ECS service name mappings found */
  monoRepoMappings?: MonorepoServiceMapping[];
}

export interface SetAwsMappingInput {
  serviceId: string;
  /** Environment → list of AWSResource overrides */
  mappings: Record<string, AWSResource[]>;
}

export class ResolveAwsMappingHandler {
  private readonly detector = new MonorepoDetector();

  constructor(private readonly serviceRepo: ServiceRepository) {}

  /**
   * Auto-detect AWS resources for a service by:
   * 1. Checking if the repo is a monorepo (reads ecs-config.yml files)
   * 2. For single-service repos: trying the {env}-{repo-name} naming convention
   * Returns resolved mappings or signals that manual input is needed.
   */
  async resolve(
    serviceId: string,
    org: string,
  ): Promise<Result<ResolveMappingResult, DomainError<CatalogErrorCode>>> {
    const svcResult = await this.serviceRepo.findById(serviceId);
    if (!svcResult.ok) return svcResult;
    if (!svcResult.value) {
      return failure(domainError(CatalogErrorCode.SERVICE_NOT_FOUND, `Service ${serviceId} not found`));
    }

    const service = svcResult.value;
    const repoName = service.repositoryUrl.split('/').pop() ?? '';
    const region = process.env['AWS_REGION'] ?? 'me-south-1';

    // --- Monorepo path ---
    if (service.serviceDirectory) {
      return this.resolveMonorepoService(org, repoName, service.serviceDirectory, region);
    }

    // --- Check if the repo is a monorepo (no serviceDirectory set yet) ---
    const detectionResult = await this.detector.detect(org, repoName);
    if (!detectionResult.ok) return detectionResult;

    if (detectionResult.value.isMonorepo) {
      return success({
        resolved: [],
        needsManualInput: true,
        monoRepoMappings: detectionResult.value.services,
      });
    }

    // --- Single-service repo: try {env}-{repo-name} convention ---
    return this.resolveSingleServiceRepo(repoName, region);
  }

  /**
   * Apply manually-chosen (or confirmed) mappings to a service.
   */
  async setMapping(
    input: SetAwsMappingInput,
  ): Promise<Result<void, DomainError<CatalogErrorCode>>> {
    const svcResult = await this.serviceRepo.findById(input.serviceId);
    if (!svcResult.ok) return svcResult;
    if (!svcResult.value) {
      return failure(domainError(CatalogErrorCode.SERVICE_NOT_FOUND, `Service ${input.serviceId} not found`));
    }

    const service = svcResult.value;
    const updated = {
      ...service,
      awsResources: { ...service.awsResources, ...input.mappings },
      lastSyncedAt: new Date().toISOString(),
    };

    return this.serviceRepo.save(updated);
  }

  private async resolveMonorepoService(
    org: string,
    repoName: string,
    serviceDirectory: string,
    region: string,
  ): Promise<Result<ResolveMappingResult, DomainError<CatalogErrorCode>>> {
    const detectionResult = await this.detector.detect(org, repoName);
    if (!detectionResult.ok) return detectionResult;

    const mapping = detectionResult.value.services.find(
      (s) => s.folderName === serviceDirectory,
    );

    if (!mapping) {
      return success({ resolved: [], needsManualInput: true, monoRepoMappings: detectionResult.value.services });
    }

    const resolved = await this.buildMappingsFromMonorepo(mapping, region);
    return success({ resolved, needsManualInput: resolved.length === 0, monoRepoMappings: [mapping] });
  }

  private async buildMappingsFromMonorepo(
    mapping: MonorepoServiceMapping,
    region: string,
  ): Promise<ResolvedMapping[]> {
    const environments = ['production', 'development', 'staging'];
    const resolved: ResolvedMapping[] = [];

    for (const env of environments) {
      const envPrefix = env === 'production' ? 'prod' : env === 'development' ? 'dev' : 'stg';
      // ECS service name from config may already include env prefix, or we derive it
      const ecsServiceName = mapping.ecsServiceName.startsWith(envPrefix)
        ? mapping.ecsServiceName
        : `${envPrefix}-${mapping.ecsServiceName}`;

      const clusterName = mapping.clusterName.startsWith(envPrefix)
        ? mapping.clusterName
        : `${envPrefix}-${mapping.clusterName}`;

      const exists = await this.verifyEcsService(clusterName, ecsServiceName, region);
      if (exists) {
        resolved.push({
          environment: env,
          resources: [{
            resourceType: 'ECS_SERVICE',
            identifier: ecsServiceName,
            region,
            clusterName,
            ecrRepository: mapping.ecrRepository,
            mappingStatus: 'auto-verified',
          }],
        });
      }
    }

    return resolved;
  }

  private async resolveSingleServiceRepo(
    repoName: string,
    region: string,
  ): Promise<Result<ResolveMappingResult, DomainError<CatalogErrorCode>>> {
    const candidates = [
      { env: 'production', prefix: 'prod' },
      { env: 'development', prefix: 'dev' },
      { env: 'staging', prefix: 'stg' },
    ];

    const resolved: ResolvedMapping[] = [];

    for (const { env, prefix } of candidates) {
      const candidateService = `${prefix}-${repoName}`;
      // Try common cluster naming patterns
      for (const cluster of [`${prefix}-cluster`, `${prefix}-ecs-cluster`, repoName]) {
        const exists = await this.verifyEcsService(cluster, candidateService, region);
        if (exists) {
          resolved.push({
            environment: env,
            resources: [{
              resourceType: 'ECS_SERVICE',
              identifier: candidateService,
              region,
              clusterName: cluster,
              mappingStatus: 'auto-verified',
            }],
          });
          break;
        }
      }
    }

    if (resolved.length > 0) {
      return success({ resolved, needsManualInput: false });
    }

    // Nothing found — return unverified guesses so the UI can show a picker
    return success({
      resolved: [],
      needsManualInput: true,
      suggestions: candidates.map((c) => `${c.prefix}-${repoName}`),
    });
  }

  private async verifyEcsService(cluster: string, serviceName: string, region: string): Promise<boolean> {
    try {
      const client = new ECSClient({ region });
      const response = await client.send(
        new DescribeServicesCommand({ cluster, services: [serviceName] }),
      );
      return (response.services?.length ?? 0) > 0 && response.services![0]!.status !== 'INACTIVE';
    } catch {
      return false;
    }
  }
}
