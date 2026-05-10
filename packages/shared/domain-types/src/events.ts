import type { ServiceReference } from './service-reference.js';
import type { TeamReference } from './team-reference.js';

export const EventSource = {
  SERVICE_CATALOG: 'wep.service-catalog',
  DEPLOYMENT_TRACKER: 'wep.deployment-tracker',
  VELOCITY_METRICS: 'wep.velocity-metrics',
} as const;

export type EventSource = (typeof EventSource)[keyof typeof EventSource];

export interface DomainEvent<T> {
  eventId: string;
  entityId: string;
  entityType: string;
  timestamp: string;
  version: number;
  correlationId?: string;
  data: T;
}

// --- Service Catalog Events ---

export interface ServiceRegisteredPayload {
  service: ServiceReference;
  discoveryMethod: 'automated' | 'manual';
  initialHealthStatus: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
}

export interface ServiceUpdatedPayload {
  service: ServiceReference;
  changedFields: string[];
  previousValues: Record<string, unknown>;
}

export interface ServiceDeregisteredPayload {
  serviceId: string;
  reason: 'manual' | 'repository-archived' | 'resource-deleted';
}

export interface TeamUpdatedPayload {
  team: TeamReference;
  changedFields: string[];
}

export interface DependencyChangedPayload {
  serviceId: string;
  added: string[];
  removed: string[];
}

// --- Deployment Tracker Events ---

export interface DeploymentStartedPayload {
  deploymentId: string;
  serviceId: string;
  environment: string;
  sha: string;
  actor: string;
  triggerSource: 'github-actions' | 'ecs-direct' | 'manual' | 'cloudformation';
}

export interface DeploymentCompletedPayload {
  deploymentId: string;
  serviceId: string;
  environment: string;
  sha: string;
  actor: string;
  status: 'success' | 'failure' | 'cancelled';
  durationSeconds: number;
  previousSha: string | null;
  changedFiles: number | null;
}

export interface DeploymentRolledBackPayload {
  deploymentId: string;
  serviceId: string;
  environment: string;
  rolledBackSha: string;
  rolledBackToSha: string;
  rollbackReason: 'manual' | 'automated' | 'health-check-failure';
}

export interface EnvironmentDriftPayload {
  serviceId: string;
  stagingSha: string;
  productionSha: string;
  commitsBehind: number;
  daysBehind: number;
}

export interface UnknownServiceDeployedPayload {
  rawIdentifier: string;
  environment: string;
  deploymentDetails: Record<string, unknown>;
}

// --- Velocity Metrics Events ---

export interface SnapshotGeneratedPayload {
  snapshotPeriod: string;
  metrics: Record<string, DORAMetricValues>;
  orgWideMetrics: DORAMetricValues;
}

export interface DORAMetricValues {
  deploymentFrequency: number;
  leadTimeForChanges: number;
  meanTimeToRecovery: number | null;
  changeFailureRate: number;
}

export interface AnomalyDetectedPayload {
  teamId: string;
  metricName: string;
  currentValue: number;
  rollingAverage: number;
  standardDeviations: number;
  direction: 'improved' | 'degraded';
}
