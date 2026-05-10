export {
  type Result,
  type Success,
  type Failure,
  success,
  failure,
  isSuccess,
  isFailure,
  map,
  flatMap,
  unwrapOr,
  fromPromise,
} from './result.js';

export {
  type ServiceReference,
  ServiceReferenceSchema,
  RuntimeType,
  Environment,
} from './service-reference.js';

export {
  type TeamReference,
  TeamReferenceSchema,
  Domain,
} from './team-reference.js';

export {
  EventSource,
  type DomainEvent,
  type ServiceRegisteredPayload,
  type ServiceUpdatedPayload,
  type ServiceDeregisteredPayload,
  type TeamUpdatedPayload,
  type DependencyChangedPayload,
  type DeploymentStartedPayload,
  type DeploymentCompletedPayload,
  type DeploymentRolledBackPayload,
  type EnvironmentDriftPayload,
  type UnknownServiceDeployedPayload,
  type SnapshotGeneratedPayload,
  type DORAMetricValues,
  type AnomalyDetectedPayload,
} from './events.js';

export {
  type DomainError,
  type ProblemDetails,
  CatalogErrorCode,
  DeploymentErrorCode,
  VelocityErrorCode,
  domainError,
  problemDetails,
} from './errors.js';

export { type PaginatedRequest, type PaginatedResponse } from './pagination.js';
