import { z } from 'zod';

export const RuntimeType = {
  ECS: 'ecs',
  LAMBDA: 'lambda',
  EC2: 'ec2',
  STEP_FUNCTION: 'step-function',
  STATIC: 'static',
  NPM_PACKAGE: 'npm-package',
  CLI_TOOL: 'cli-tool',
} as const;

export type RuntimeType = (typeof RuntimeType)[keyof typeof RuntimeType];

export const Environment = {
  PRODUCTION: 'production',
  STAGING: 'staging',
  DEVELOPMENT: 'development',
} as const;

export type Environment = (typeof Environment)[keyof typeof Environment];

export interface ServiceReference {
  serviceId: string;
  serviceName: string;
  repositoryUrl: string;
  ownerTeamId: string;
  ownerTeamName: string;
  runtimeType: RuntimeType;
  environment: Environment;
}

export const ServiceReferenceSchema = z.object({
  serviceId: z.string().min(1),
  serviceName: z.string().min(1),
  repositoryUrl: z.string().url(),
  ownerTeamId: z.string().min(1),
  ownerTeamName: z.string().min(1),
  runtimeType: z.enum(['ecs', 'lambda', 'ec2', 'step-function', 'static', 'npm-package', 'cli-tool']),
  environment: z.enum(['production', 'staging', 'development']),
});
