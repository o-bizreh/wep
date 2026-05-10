export interface TeamCostSummary {
  teamId: string;
  month: string;
  totalCost: number;
  serviceBreakdown: Record<string, number>;
  resourceTypeBreakdown: Record<string, number>;
  monthOverMonthChange: number;
  costPerDeployment: number | null;
}
