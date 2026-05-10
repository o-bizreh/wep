export interface DeploymentDelta {
  commitCount: number;
  authors: string[];
  pullRequests: Array<{ number: number; title: string }>;
  changedFileCount: number;
  hasBreakingChanges: boolean;
}
