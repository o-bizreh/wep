import { z } from 'zod';

export const ListDeploymentsQuerySchema = z.object({
  serviceId: z.string().optional(),
  environment: z.string().optional(),
  actor: z.string().optional(),
  status: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const GetCurrentStateQuerySchema = z.object({
  environment: z.string().optional(),
});

export const GetEnvironmentDiffQuerySchema = z.object({
  source: z.string().default('staging'),
  target: z.string().default('production'),
});
