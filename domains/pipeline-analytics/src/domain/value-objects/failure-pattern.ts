import type { FailureCategory } from '../entities/pipeline-run.js';

export interface FailurePattern {
  patternId: string;
  category: NonNullable<FailureCategory>;
  regex: string;
  priority: number;
  exampleMatch: string;
}

export const DEFAULT_FAILURE_PATTERNS: Omit<FailurePattern, 'patternId'>[] = [
  { category: 'test-failure', regex: '(FAIL|✗|✘)\\s+.*test', priority: 100, exampleMatch: 'FAIL src/test.ts' },
  { category: 'test-failure', regex: 'Expected.*to (equal|be|match|contain)', priority: 99, exampleMatch: 'Expected 1 to equal 2' },
  { category: 'test-failure', regex: 'AssertionError|jest.*failed', priority: 98, exampleMatch: 'AssertionError: expected true' },
  { category: 'build-error', regex: 'error TS\\d+', priority: 90, exampleMatch: 'error TS2304: Cannot find name' },
  { category: 'build-error', regex: 'Module not found|SyntaxError|Build failed', priority: 89, exampleMatch: 'Module not found: Error' },
  { category: 'dependency-error', regex: 'npm ERR!|ERESOLVE|Could not resolve dependency', priority: 80, exampleMatch: 'npm ERR! code ERESOLVE' },
  { category: 'dependency-error', regex: 'ETARGET|node-gyp', priority: 79, exampleMatch: 'npm ERR! code ETARGET' },
  { category: 'infrastructure-error', regex: 'The runner has received a shutdown signal', priority: 70, exampleMatch: 'The runner has received a shutdown signal' },
  { category: 'infrastructure-error', regex: 'Job exceeded maximum execution time|No space left on device|ETIMEDOUT', priority: 69, exampleMatch: 'No space left on device' },
  { category: 'lint-error', regex: 'eslint.*error|prettier.*--check|Type error:', priority: 60, exampleMatch: 'eslint found 3 errors' },
  { category: 'docker-error', regex: 'docker build.*failed|manifest unknown|COPY failed', priority: 50, exampleMatch: 'docker build failed' },
  { category: 'deployment-error', regex: 'deployment.*failed|rollback triggered|health check.*unhealthy', priority: 40, exampleMatch: 'deployment failed' },
];

export function classifyFailure(logOutput: string, patterns: FailurePattern[]): NonNullable<FailureCategory> {
  const sorted = [...patterns].sort((a, b) => b.priority - a.priority);
  for (const pattern of sorted) {
    try {
      const regex = new RegExp(pattern.regex, 'im');
      if (regex.test(logOutput)) {
        return pattern.category;
      }
    } catch {
      continue;
    }
  }
  return 'unknown';
}
