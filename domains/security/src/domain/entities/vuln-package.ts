export type CveSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export interface CveEntry {
  cveId: string;
  aliases: string[];
  summary: string;
  severity: CveSeverity;
  cvssScore: number | null;
  publishedAt: string;
  modifiedAt: string;
  /** Whether this CVE appears in the CISA Known Exploited Vulnerabilities catalog */
  isKevExploited: boolean;
  osvId: string;
  referenceUrl: string;
}

export interface VulnPackage {
  ecosystem: string;
  name: string;
  /** Deduplicated list of repos (or 'radar') that reference this package */
  sources: string[];
  /** Versions found across all sources */
  versions: string[];
  totalCves: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  exploitedCount: number;
  lastCheckedAt: string;
  /**
   * Whether this package is a direct project dependency or pulled in transitively.
   * 'direct'     — listed in the project's own package.json dependencies/devDependencies
   * 'transitive' — pulled in by another package, not directly declared by the project
   */
  depth: 'direct' | 'transitive';
  /**
   * Resolved dependency chain from the project root to this package.
   * Empty for direct deps. For transitive: ['parent-pkg', 'grandparent-pkg', ...]
   * ordered from immediate parent to root.
   */
  dependencyPath: string[];
}
