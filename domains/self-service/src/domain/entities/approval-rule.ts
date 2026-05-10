export interface ApprovalRule {
  ruleId: string;
  tier: string;
  scope: 'global' | 'domain' | 'team' | 'service';
  scopeId: string;
  approverRole: 'team-lead' | 'domain-lead' | 'devops-engineer';
  approverIds: string[];
  autoApproveConditions?: {
    environments?: string[];
    timeWindow?: { startHour: number; endHour: number };
  };
}
