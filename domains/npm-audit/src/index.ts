export { createNpmAuditRouter } from './interfaces/api/routes.js';
export { NpmAuditRepository } from './infrastructure/dynamodb/npm-audit-repository.js';
export { runAuditScan, getScanStatus } from './application/services/audit-scanner.js';
export type { ScanRun, RepoScanResult, VulnerableDep, Advisory, Severity, ScanStatus } from './domain/entities/audit-types.js';
