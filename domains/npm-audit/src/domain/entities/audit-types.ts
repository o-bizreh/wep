export type ScanStatus = 'pending' | 'scanning' | 'done' | 'failed';
export type Severity = 'critical' | 'high' | 'moderate' | 'low' | 'info';

export interface Advisory {
  ghsaId: string;
  cveId: string | null;
  summary: string;
  severity: Severity;
  publishedAt: string;
  updatedAt: string;
  references: string[];
  cvssScore: number | null;
}

export interface VulnerableDep {
  packageName: string;
  installedVersion: string;
  fixedIn: string | null;
  isDirect: boolean;
  advisories: Advisory[];
}

export interface RepoScanResult {
  repoFullName: string;
  scannedAt: string;
  pushedAt: string;
  deps: VulnerableDep[];
  totalVulns: number;
  critical: number;
  high: number;
  moderate: number;
  low: number;
  error: string | null;
}

export interface ScanRun {
  runId: string;
  org: string;
  startedAt: string;
  finishedAt: string | null;
  status: ScanStatus;
  reposScanned: number;
  reposTotal: number;
  error: string | null;
}
