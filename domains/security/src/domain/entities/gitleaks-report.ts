export interface GitLeaksFinding {
  fingerprint: string;
  ruleId: string;
  description: string;
  file: string;
  startLine: number;
  endLine: number;
  /** First 4 chars of the secret only — never store the full secret */
  secretPreview: string;
  match: string;
  commit: string;
  author: string;
  email: string;
  date: string;
  tags: string[];
}

export interface GitLeaksReport {
  reportId: string;
  repoFullName: string;
  uploadedBy: string;
  uploadedAt: string;
  findingCount: number;
  ruleBreakdown: Record<string, number>;
}
