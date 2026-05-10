export const CatalogErrorCode = {
  SERVICE_NOT_FOUND: 'SERVICE_NOT_FOUND',
  TEAM_NOT_FOUND: 'TEAM_NOT_FOUND',
  DUPLICATE_SERVICE: 'DUPLICATE_SERVICE',
  INVALID_DEPENDENCY: 'INVALID_DEPENDENCY',
  SYNC_FAILED: 'SYNC_FAILED',
  INVALID_INPUT: 'INVALID_INPUT',
} as const;

export type CatalogErrorCode = (typeof CatalogErrorCode)[keyof typeof CatalogErrorCode];

export const DeploymentErrorCode = {
  DEPLOYMENT_NOT_FOUND: 'DEPLOYMENT_NOT_FOUND',
  SERVICE_UNKNOWN: 'SERVICE_UNKNOWN',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  WEBHOOK_VALIDATION_FAILED: 'WEBHOOK_VALIDATION_FAILED',
  INVALID_INPUT: 'INVALID_INPUT',
} as const;

export type DeploymentErrorCode = (typeof DeploymentErrorCode)[keyof typeof DeploymentErrorCode];

export const VelocityErrorCode = {
  TEAM_TOO_SMALL: 'TEAM_TOO_SMALL',
  SNAPSHOT_NOT_FOUND: 'SNAPSHOT_NOT_FOUND',
  CALCULATION_FAILED: 'CALCULATION_FAILED',
  INVALID_INPUT: 'INVALID_INPUT',
} as const;

export type VelocityErrorCode = (typeof VelocityErrorCode)[keyof typeof VelocityErrorCode];

export interface DomainError<C extends string = string> {
  code: C;
  message: string;
  details?: Record<string, unknown>;
}

export function domainError<C extends string>(
  code: C,
  message: string,
  details?: Record<string, unknown>,
): DomainError<C> {
  return { code, message, details };
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
}

export function problemDetails(
  status: number,
  title: string,
  detail: string,
  type?: string,
  instance?: string,
): ProblemDetails {
  return {
    type: type ?? `https://wep.washmen.com/errors/${status}`,
    title,
    status,
    detail,
    instance,
  };
}
