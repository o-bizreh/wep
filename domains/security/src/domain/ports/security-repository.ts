import type { Result, DomainError } from '@wep/domain-types';
import type { PlatformUser } from '../entities/user.js';
import type { SecurityTeam } from '../entities/team.js';
import type { MonitoredRepo } from '../entities/monitored-repo.js';
import type { VulnPackage, CveEntry } from '../entities/vuln-package.js';
import type { GitLeaksReport, GitLeaksFinding } from '../entities/gitleaks-report.js';

export interface SecurityRepository {
  // Users
  upsertUser(user: PlatformUser): Promise<Result<void, DomainError>>;
  listUsers(): Promise<Result<PlatformUser[], DomainError>>;
  getUser(username: string): Promise<Result<PlatformUser | null, DomainError>>;

  // Teams
  saveTeam(team: SecurityTeam): Promise<Result<void, DomainError>>;
  getTeam(teamId: string): Promise<Result<SecurityTeam | null, DomainError>>;
  listTeams(): Promise<Result<SecurityTeam[], DomainError>>;
  getTeamByOwner(ownerUsername: string): Promise<Result<SecurityTeam | null, DomainError>>;
  deleteTeam(teamId: string): Promise<Result<void, DomainError>>;

  // Monitored Repos
  saveMonitoredRepo(repo: MonitoredRepo): Promise<Result<void, DomainError>>;
  getMonitoredRepo(fullName: string): Promise<Result<MonitoredRepo | null, DomainError>>;
  listMonitoredRepos(): Promise<Result<MonitoredRepo[], DomainError>>;
  deleteMonitoredRepo(fullName: string): Promise<Result<void, DomainError>>;

  // Vuln Packages
  saveVulnPackage(pkg: VulnPackage): Promise<Result<void, DomainError>>;
  listVulnPackages(): Promise<Result<VulnPackage[], DomainError>>;
  getVulnPackage(ecosystem: string, name: string): Promise<Result<VulnPackage | null, DomainError>>;
  saveCveEntry(ecosystem: string, name: string, cve: CveEntry): Promise<Result<void, DomainError>>;
  listCveEntries(ecosystem: string, name: string): Promise<Result<CveEntry[], DomainError>>;
  deleteAllCveEntries(ecosystem: string, name: string): Promise<Result<void, DomainError>>;

  // GitLeaks
  saveGitLeaksReport(report: GitLeaksReport): Promise<Result<void, DomainError>>;
  listGitLeaksReports(): Promise<Result<GitLeaksReport[], DomainError>>;
  getGitLeaksReport(reportId: string): Promise<Result<GitLeaksReport | null, DomainError>>;
  saveGitLeaksFinding(reportId: string, finding: GitLeaksFinding): Promise<Result<void, DomainError>>;
  listGitLeaksFindings(reportId: string): Promise<Result<GitLeaksFinding[], DomainError>>;
  deleteGitLeaksReport(reportId: string): Promise<Result<void, DomainError>>;
}
