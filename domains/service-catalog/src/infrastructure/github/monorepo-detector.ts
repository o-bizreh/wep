import * as yaml from 'js-yaml';
import { type Result, success, failure, domainError, CatalogErrorCode, type DomainError } from '@wep/domain-types';
import { GitHubClient } from '@wep/github-client';
import type { AWSResource } from '../../domain/entities/service.js';

export interface MonorepoServiceMapping {
  /** Folder name within apps_dir (e.g. "srv-order") */
  folderName: string;
  /** Actual ECS service name (e.g. "prod-srv-facility-order-backend") */
  ecsServiceName: string;
  /** ECS cluster name */
  clusterName: string;
  /** ECR repository name, if found in config */
  ecrRepository?: string;
}

export interface MonorepoDetectionResult {
  isMonorepo: boolean;
  /** Workflow inputs: the apps_dir value (default "apps") */
  appsDir: string;
  /** Path to services config (default ".github/ecs/services.yml") */
  servicesConfigPath: string;
  /** ECS config directory (default ".github/ecs") */
  configDir: string;
  /** Resolved per-service mappings. Empty if isMonorepo is false. */
  services: MonorepoServiceMapping[];
}

export interface AwsMappingForEnv {
  /** environment key, e.g. "production" or "development" */
  environment: string;
  resources: AWSResource[];
}

export class MonorepoDetector {
  constructor(private readonly client: GitHubClient = new GitHubClient()) {}

  /**
   * Detects whether the repo uses the deploy-ecs-monorepo workflow and, if so,
   * reads the static ECS configs to build a folder → ECS service name mapping.
   *
   * Reads from .github/workflows/*.yml to find the reusable workflow reference,
   * then reads .github/ecs/services.yml + per-service ecs-config.yml files.
   */
  async detect(
    org: string,
    repo: string,
  ): Promise<Result<MonorepoDetectionResult, DomainError<CatalogErrorCode>>> {
    const workflowResult = await this.findMonorepoWorkflow(org, repo);
    if (!workflowResult.ok) return workflowResult;

    if (!workflowResult.value) {
      return success({
        isMonorepo: false,
        appsDir: 'apps',
        servicesConfigPath: '.github/ecs/services.yml',
        configDir: '.github/ecs',
        services: [],
      });
    }

    const { appsDir, servicesConfigPath, configDir } = workflowResult.value;

    const foldersResult = await this.resolveServiceFolders(org, repo, servicesConfigPath, appsDir);
    if (!foldersResult.ok) return foldersResult;

    const services = await this.readServiceConfigs(org, repo, configDir, foldersResult.value);

    return success({
      isMonorepo: true,
      appsDir,
      servicesConfigPath,
      configDir,
      services,
    });
  }

  /**
   * Scans .github/workflows/*.yml for a job that uses the deploy-ecs-monorepo
   * reusable workflow and extracts the `with:` inputs.
   */
  private async findMonorepoWorkflow(
    org: string,
    repo: string,
  ): Promise<Result<{ appsDir: string; servicesConfigPath: string; configDir: string } | null, DomainError<CatalogErrorCode>>> {
    const workflowsResult = await this.client.getFileContent(org, repo, '.github/workflows');
    // getFileContent on a directory returns null — we handle this by trying known file names
    // Since GitHub API for directories requires listing, we try common workflow file names
    const candidateFiles = [
      '.github/workflows/deploy.yml',
      '.github/workflows/deploy-prod.yml',
      '.github/workflows/deploy-production.yml',
      '.github/workflows/cd.yml',
      '.github/workflows/release.yml',
    ];

    for (const filePath of candidateFiles) {
      const fileResult = await this.client.getFileContent(org, repo, filePath);
      if (!fileResult.ok || !fileResult.value) continue;

      const parsed = this.extractMonorepoWorkflowInputs(fileResult.value);
      if (parsed) return success(parsed);
    }

    // Not found — not a monorepo deploy
    return success(null);
  }

  /**
   * Parses a workflow YAML file looking for a job that calls deploy-ecs-monorepo.
   * Extracts apps_dir, services_config, and config_dir from the `with:` block.
   */
  private extractMonorepoWorkflowInputs(
    workflowContent: string,
  ): { appsDir: string; servicesConfigPath: string; configDir: string } | null {
    try {
      const doc = yaml.load(workflowContent) as Record<string, unknown>;
      const jobs = doc['jobs'] as Record<string, unknown> | undefined;
      if (!jobs) return null;

      for (const job of Object.values(jobs)) {
        const jobDef = job as Record<string, unknown>;
        const uses = jobDef['uses'] as string | undefined;
        if (!uses?.includes('deploy-ecs-monorepo')) continue;

        const withBlock = (jobDef['with'] ?? {}) as Record<string, string>;
        return {
          appsDir: withBlock['apps_dir'] ?? 'apps',
          servicesConfigPath: withBlock['services_config'] ?? '.github/ecs/services.yml',
          configDir: withBlock['config_dir'] ?? '.github/ecs',
        };
      }
    } catch {
      // Not valid YAML or unexpected structure — skip
    }
    return null;
  }

  /**
   * Reads services.yml to get the list of service folder names.
   * Falls back to listing directories in apps_dir if services.yml doesn't exist.
   */
  private async resolveServiceFolders(
    org: string,
    repo: string,
    servicesConfigPath: string,
    _appsDir: string,
  ): Promise<Result<string[], DomainError<CatalogErrorCode>>> {
    const fileResult = await this.client.getFileContent(org, repo, servicesConfigPath);
    if (!fileResult.ok) {
      return failure(domainError(CatalogErrorCode.SYNC_FAILED, 'Failed to read services.yml', {
        cause: fileResult.error.message,
      }));
    }

    if (!fileResult.value) {
      // No services.yml — caller will get empty list, user must map manually
      return success([]);
    }

    try {
      const doc = yaml.load(fileResult.value) as Record<string, unknown>;
      const folders = this.parseServiceFolders(doc);
      return success(folders);
    } catch {
      return success([]);
    }
  }

  /**
   * Parses services.yml supporting two common formats:
   * - { phases: [{ level: 1, services: ['svc1'] }] }
   * - { services: ['svc1', { name: 'svc2' }] }
   */
  private parseServiceFolders(doc: Record<string, unknown>): string[] {
    if (Array.isArray(doc['phases'])) {
      return (doc['phases'] as Array<Record<string, unknown>>).flatMap((phase) => {
        const svcs = phase['services'];
        return Array.isArray(svcs) ? (svcs as string[]) : [];
      });
    }

    if (Array.isArray(doc['services'])) {
      return (doc['services'] as Array<string | Record<string, string>>).map((s) =>
        typeof s === 'string' ? s : (s['name'] ?? ''),
      ).filter(Boolean);
    }

    return [];
  }

  /**
   * For each service folder, reads ecs-config.yml (or ecs-config.dev.yml)
   * and extracts the ECS service name, cluster, and ECR repo.
   * Tries multiple common YAML shapes since the format isn't standardised.
   */
  private async readServiceConfigs(
    org: string,
    repo: string,
    configDir: string,
    folders: string[],
  ): Promise<MonorepoServiceMapping[]> {
    const mappings: MonorepoServiceMapping[] = [];

    for (const folder of folders) {
      const configPath = `${configDir}/${folder}/ecs-config.yml`;
      const fileResult = await this.client.getFileContent(org, repo, configPath);
      if (!fileResult.ok || !fileResult.value) continue;

      try {
        const doc = yaml.load(fileResult.value) as Record<string, unknown>;
        const parsed = this.parseEcsConfig(doc, folder);
        if (parsed.ecsServiceName && parsed.clusterName) {
          mappings.push({ folderName: folder, ...parsed } as MonorepoServiceMapping);
        }
      } catch {
        // Invalid YAML — skip this service
      }
    }

    return mappings;
  }

  /**
   * Flexible parser that tries multiple common field name patterns used in ecs-config.yml.
   * Tries: service.name / service_name / name  for service name
   *        cluster.name / cluster_name / cluster for cluster
   *        ecr.repository / ecr_repository / repository for ECR
   */
  private parseEcsConfig(
    doc: Record<string, unknown>,
    folderName: string,
  ): { ecsServiceName: string; clusterName: string; ecrRepository?: string } {
    const get = (obj: Record<string, unknown>, ...keys: string[]): string | undefined => {
      for (const key of keys) {
        const val = obj[key];
        if (typeof val === 'string' && val) return val;
        if (val && typeof val === 'object') {
          const nested = val as Record<string, unknown>;
          const nameVal = nested['name'];
          if (typeof nameVal === 'string' && nameVal) return nameVal;
        }
      }
      return undefined;
    };

    const ecsServiceName =
      get(doc, 'service_name', 'ecs_service_name') ??
      (doc['service'] ? get(doc['service'] as Record<string, unknown>, 'name') : undefined) ??
      get(doc, 'name') ??
      folderName; // last resort

    const clusterName =
      get(doc, 'cluster_name', 'cluster') ??
      (doc['cluster'] ? get(doc['cluster'] as Record<string, unknown>, 'name') : undefined) ??
      '';

    const ecrRepository =
      get(doc, 'ecr_repository', 'repository') ??
      (doc['ecr'] ? get(doc['ecr'] as Record<string, unknown>, 'repository', 'name') : undefined);

    return { ecsServiceName: ecsServiceName ?? folderName, clusterName, ecrRepository };
  }
}
