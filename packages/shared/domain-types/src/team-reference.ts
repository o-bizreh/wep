import { z } from 'zod';

export const Domain = {
  CUSTOMER: 'CustomerDomain',
  PAYMENT: 'PaymentDomain',
  DATA: 'DataDomain',
  DEVOPS: 'DevOps',
} as const;

export type Domain = (typeof Domain)[keyof typeof Domain];

export interface TeamReference {
  teamId: string;
  teamName: string;
  domain: Domain;
  memberCount: number;
  slackChannelId: string;
}

export const TeamReferenceSchema = z.object({
  teamId: z.string().min(1),
  teamName: z.string().min(1),
  domain: z.enum(['CustomerDomain', 'PaymentDomain', 'DataDomain', 'DevOps']),
  memberCount: z.number().int().min(0),
  slackChannelId: z.string().min(1),
});
