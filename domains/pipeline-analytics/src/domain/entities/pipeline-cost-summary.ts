export interface WorkflowCost {
  workflowId: number;
  workflowName: string;
  cost: number;
  billableMinutes: number;
}

export interface PipelineCostSummary {
  entityId: string;
  entityType: 'team' | 'organization';
  billingPeriod: string;
  totalBillableMinutes: number;
  totalCostEstimate: number;
  breakdownByWorkflow: Record<string, number>;
  breakdownByRunnerType: Record<string, number>;
  topCostWorkflows: WorkflowCost[];
}
