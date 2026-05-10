export type HealthStatusLevel = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface HealthSignal {
  source: string;
  status: 'healthy' | 'unhealthy';
  checkedAt: string;
}

export interface HealthStatus {
  status: HealthStatusLevel;
  signals: HealthSignal[];
}

export function calculateHealth(signals: HealthSignal[]): HealthStatus {
  if (signals.length === 0) {
    return { status: 'unknown', signals: [] };
  }

  const unhealthyCount = signals.filter((s) => s.status === 'unhealthy').length;

  let status: HealthStatusLevel;
  if (unhealthyCount === 0) {
    status = 'healthy';
  } else if (unhealthyCount >= 2) {
    status = 'unhealthy';
  } else {
    status = 'degraded';
  }

  return { status, signals };
}
