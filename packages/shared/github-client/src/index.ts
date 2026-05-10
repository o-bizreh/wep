export {
  GitHubClient,
  setGitHubTokenOverride,
  type GitHubRepo,
  type GitHubTeam,
  type GitHubTeamMember,
  type GitHubCompareResult,
  type WorkflowRun,
  type WorkflowArtifact,
  type ArtifactFile,
} from './client.js';

// Re-export async generator method is on GitHubClient instance — no standalone export needed
