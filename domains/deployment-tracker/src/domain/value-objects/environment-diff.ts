export interface EnvironmentDiff {
  serviceId: string;
  sourceEnvironment: string;
  targetEnvironment: string;
  sourceSha: string;
  targetSha: string;
  commitsBehind: number;
  daysBehind: number;
  diffUrl: string;
}
