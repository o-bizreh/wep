import {
  type Result,
  success,
  failure,
  domainError,
  CatalogErrorCode,
  type DomainError,
} from '@wep/domain-types';
import {
  ECSClient,
  DescribeServicesCommand,
  ListServicesCommand,
} from '@wep/aws-clients';
import { LambdaClient, GetFunctionCommand } from '@wep/aws-clients';
import type { AWSScanner, DiscoveredAWSResource } from '../../domain/ports/aws-scanner.js';

const ECS_CLUSTERS = ['washmen-dev', 'washmen-prod'] as const;
const ENV_PREFIX: Record<string, string> = {
  'washmen-dev': 'dev',
  'washmen-prod': 'prod',
};

export class AWSResourceScanner implements AWSScanner {
  private readonly ecsClient: ECSClient;
  private readonly lambdaClient: LambdaClient;
  private readonly region: string;

  constructor(config?: { region?: string }) {
    this.region = config?.region ?? process.env['AWS_REGION'] ?? 'me-south-1';
    this.ecsClient = new ECSClient({ region: this.region });
    this.lambdaClient = new LambdaClient({ region: this.region });
  }

  /**
   * Scans washmen-dev and washmen-prod ECS clusters and returns all services
   * found, tagged with their environment (dev/prod).
   */
  async scanECSServices(): Promise<Result<DiscoveredAWSResource[], DomainError<CatalogErrorCode>>> {
    try {
      const resources: DiscoveredAWSResource[] = [];

      for (const cluster of ECS_CLUSTERS) {
        const env = ENV_PREFIX[cluster]!;
        let nextToken: string | undefined;

        do {
          const listResp = await this.ecsClient.send(
            new ListServicesCommand({ cluster, nextToken }),
          );
          const serviceArns = listResp.serviceArns ?? [];
          nextToken = listResp.nextToken;

          if (serviceArns.length === 0) continue;

          // DescribeServices accepts max 10 at a time
          for (let i = 0; i < serviceArns.length; i += 10) {
            const batch = serviceArns.slice(i, i + 10);
            const descResp = await this.ecsClient.send(
              new DescribeServicesCommand({ cluster, services: batch }),
            );

            for (const svc of descResp.services ?? []) {
              const tags: Record<string, string> = {};
              for (const tag of svc.tags ?? []) {
                if (tag.key && tag.value) tags[tag.key] = tag.value;
              }
              resources.push({
                arn: svc.serviceArn ?? '',
                name: svc.serviceName ?? '',
                resourceType: 'ecs-service',
                region: this.region,
                tags: { ...tags, 'wep:environment': env, 'wep:cluster': cluster },
                serviceId: tags['wep:service-id'] ?? null,
                runningCount: svc.runningCount ?? 0,
                desiredCount: svc.desiredCount ?? 0,
                status: svc.status ?? 'UNKNOWN',
              });
            }
          }
        } while (nextToken);
      }

      return success(resources);
    } catch (error) {
      return failure(domainError(CatalogErrorCode.SYNC_FAILED, 'ECS scan failed', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  /**
   * Checks whether a Lambda function exists in both dev and prod environments.
   * Uses GetFunction (single call per name) — cheaper than listing all functions.
   */
  async probeLambda(repoName: string): Promise<{
    dev: { exists: boolean; state: string } | null;
    prod: { exists: boolean; state: string } | null;
  }> {
    const probe = async (name: string) => {
      try {
        const resp = await this.lambdaClient.send(new GetFunctionCommand({ FunctionName: name }));
        return { exists: true, state: resp.Configuration?.State ?? 'Unknown' };
      } catch {
        return null;
      }
    };

    const [dev, prod] = await Promise.all([
      probe(`dev-${repoName}`),
      probe(`prod-${repoName}`),
    ]);

    return { dev, prod };
  }

  async scanLambdaFunctions(): Promise<Result<DiscoveredAWSResource[], DomainError<CatalogErrorCode>>> {
    return success([]); // Not used in reconciliation — we use probeLambda per repo instead
  }

  async scanCloudFormationStacks(): Promise<Result<DiscoveredAWSResource[], DomainError<CatalogErrorCode>>> {
    return success([]);
  }
}
