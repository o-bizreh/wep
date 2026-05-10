import { z } from 'zod';

export const ListServicesQuerySchema = z.object({
  query: z.string().optional(),
  teamId: z.string().optional(),
  environment: z.enum(['production', 'staging', 'development']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(20),
  cursor: z.string().optional(),
});

export const CreateServiceBodySchema = z.object({
  serviceName: z.string().min(1).max(200),
  repositoryUrl: z.string().url(),
  runtimeType: z.enum(['ecs', 'lambda', 'ec2', 'step-function', 'static', 'npm-package', 'cli-tool']),
  ownerTeamId: z.string().min(1),
  environments: z.array(z.enum(['production', 'staging', 'development'])).optional(),
  metadata: z.record(z.string()).optional(),
});

export const UpdateServiceBodySchema = z.object({
  serviceName: z.string().min(1).max(200).optional(),
  ownerTeamId: z.string().min(1).optional(),
  metadata: z.record(z.string()).optional(),
});

export const GetDependencyGraphQuerySchema = z.object({
  depth: z.coerce.number().int().min(1).max(5).default(2),
});

export const ListTeamsQuerySchema = z.object({
  domain: z.enum(['CustomerDomain', 'PaymentDomain', 'DataDomain', 'DevOps']).optional(),
});

export type ListServicesQuery = z.infer<typeof ListServicesQuerySchema>;
export type CreateServiceBody = z.infer<typeof CreateServiceBodySchema>;
export type UpdateServiceBody = z.infer<typeof UpdateServiceBodySchema>;
