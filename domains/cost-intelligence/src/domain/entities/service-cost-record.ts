export interface ResourceCost {
  arn: string;
  name: string;
  cost: number;
}

export interface UtilizationMetrics {
  cpuAverage: number | null;
  memoryAverage: number | null;
  invocationCount: number | null;
}

export interface ServiceCostRecord {
  serviceId: string;
  date: string;
  totalCost: number;
  breakdownByResourceType: Record<string, number>;
  breakdownByUsageType: Record<string, number>;
  topResources: ResourceCost[];
  utilizationMetrics: UtilizationMetrics;
}
