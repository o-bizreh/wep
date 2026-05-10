export type AnomalySeverity = 'low' | 'medium' | 'high';
export type AnomalyStatus = 'detected' | 'investigating' | 'resolved' | 'expected';

export interface CostAnomaly {
  anomalyId: string;
  serviceId: string;
  date: string;
  expectedCost: number;
  actualCost: number;
  deviationPercentage: number;
  severity: AnomalySeverity;
  possibleCauses: string[];
  correlatedDeployments: string[];
  status: AnomalyStatus;
  resolvedBy: string | null;
  resolution: string | null;
}

export function determineSeverity(deviationPercentage: number): AnomalySeverity {
  if (deviationPercentage > 100) return 'high';
  if (deviationPercentage > 50) return 'medium';
  return 'low';
}
