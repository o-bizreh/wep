import type { Result, DomainError, VelocityErrorCode } from '@wep/domain-types';
import type { MetricSnapshot, Period } from '../entities/metric-snapshot.js';
import type { MetricAnomaly } from '../entities/metric-anomaly.js';

export interface MetricRepository {
  saveSnapshot(snapshot: MetricSnapshot): Promise<Result<void, DomainError<VelocityErrorCode>>>;
  getTeamCurrent(teamId: string): Promise<Result<MetricSnapshot | null, DomainError<VelocityErrorCode>>>;
  getTeamHistory(teamId: string, period: Period, count: number): Promise<Result<MetricSnapshot[], DomainError<VelocityErrorCode>>>;
  getOrgCurrent(): Promise<Result<MetricSnapshot | null, DomainError<VelocityErrorCode>>>;
  getOrgHistory(period: Period, count: number): Promise<Result<MetricSnapshot[], DomainError<VelocityErrorCode>>>;
  saveAnomaly(anomaly: MetricAnomaly): Promise<Result<void, DomainError<VelocityErrorCode>>>;
  getAnomalies(teamId?: string, limit?: number): Promise<Result<MetricAnomaly[], DomainError<VelocityErrorCode>>>;
  acknowledgeAnomaly(anomalyId: string): Promise<Result<void, DomainError<VelocityErrorCode>>>;
}
