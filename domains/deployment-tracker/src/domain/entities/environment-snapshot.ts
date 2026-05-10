export interface EnvironmentSnapshot {
  serviceId: string;
  environment: string;
  currentSha: string;
  currentVersion: string | null;
  deployedAt: string;
  deployedBy: string;
  deploymentId: string;
  configHash: string | null;
}

export function createSnapshot(
  serviceId: string,
  environment: string,
  sha: string,
  deployedBy: string,
  deploymentId: string,
): EnvironmentSnapshot {
  return {
    serviceId,
    environment,
    currentSha: sha,
    currentVersion: null,
    deployedAt: new Date().toISOString(),
    deployedBy,
    deploymentId,
    configHash: null,
  };
}
