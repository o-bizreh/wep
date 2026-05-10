# Deployment Tracker — Bounded Context Instructions

## Purpose

This context answers: "What is deployed where right now?", "Who deployed what and when?", and "What is the difference between staging and production?" It is the single source of truth for deployment state across all runtime targets (ECS, Lambda, EC2, Step Functions). It feeds deployment data to the Velocity Metrics context for DORA calculations.

## Domain Model

### Entities

**Deployment** — a single deployment event representing a version change of a service in an environment. A deployment has a lifecycle: started → completed (success or failure) or started → cancelled. Rollbacks are a special type of completed deployment where the target SHA is older than the current SHA.

Deployment attributes: deploymentId (UUIDv4), serviceId (reference to Service Catalog), environment, sha (the Git commit SHA being deployed), previousSha (the SHA that was running before this deployment), actor (GitHub username who triggered it), triggerSource (github-actions, ecs-direct, manual, cloudformation), status (started, success, failure, cancelled, rolled-back), startedAt, completedAt, durationSeconds, metadata (extensible map for workflow run IDs, ECS deployment IDs, etc.).

**EnvironmentSnapshot** — the current state of a service in an environment. This is a continuously updated projection, not a historical record. There is exactly one EnvironmentSnapshot per service-environment combination.

EnvironmentSnapshot attributes: serviceId, environment, currentSha, currentVersion (if semantic versioning is used), deployedAt, deployedBy, deploymentId (reference to the Deployment that produced this state), configHash (hash of the task definition or function configuration — used for drift detection).

**EnvironmentDiff** — a computed comparison between two environments for the same service. Not persisted — calculated on demand from the two EnvironmentSnapshots.

EnvironmentDiff attributes: serviceId, sourceEnvironment, targetEnvironment, sourceSha, targetSha, commitsBehind (number of commits between the two SHAs), daysBehind (time since the leading environment's deployment), diffUrl (GitHub compare URL).

### Value Objects

**DeploymentTrigger** — the source that initiated the deployment. Each trigger type has different data available.

For github-actions: workflowRunId, workflowName, branch, pullRequestNumber (if triggered by a PR merge).
For ecs-direct: ecsDeploymentId, clusterName, serviceName, taskDefinitionArn.
For cloudformation: stackName, stackId, changeSetId.
For manual: reason (free text provided by the operator).

**DeploymentDelta** — what changed in this deployment. Computed by comparing the previousSha to the current sha via GitHub Compare API.

DeploymentDelta attributes: commitCount, authors (list of unique commit authors), pullRequests (list of merged PRs included in this range), changedFileCount, hasBreakingChanges (boolean, determined by conventional commit prefixes or PR labels if available).

## Infrastructure Adapters

### GitHub Webhook Receiver

A Lambda function behind an API Gateway endpoint that receives GitHub webhook events. This is the primary real-time data source.

Events to process:
- `deployment_status` — GitHub's native deployment events. When status is "success" or "failure", record a completed deployment. When status is "pending" or "in_progress", record a started deployment. Map the environment from the deployment payload to the platform's environment enum.
- `workflow_run.completed` — for repositories that don't use GitHub Deployments API, infer deployments from workflow runs. A workflow run is treated as a deployment if its name matches a configurable pattern (default: contains "deploy" case-insensitive) AND it ran on the default branch or a release branch.

Webhook validation: Every incoming webhook must be validated using the webhook secret (stored in Secrets Manager) by computing the HMAC-SHA256 signature and comparing it to the X-Hub-Signature-256 header. Reject any request with an invalid or missing signature.

Deduplication: A deployment event may arrive via both webhook and polling. Before creating a record, check if a deployment with the same serviceId + environment + sha already exists within the last hour. If it does, update the existing record instead of creating a duplicate.

### ECS Deployment Monitor

A Lambda function triggered by CloudWatch Events rule matching ECS deployment state changes. ECS publishes events when deployments start, progress, and complete.

Event pattern to match: source = "aws.ecs", detail-type = "ECS Deployment State Change". Map ECS deployment statuses to domain statuses: PRIMARY → started, COMPLETED → success, FAILED → failure.

Service mapping: Extract the ECS service name and cluster name from the event. Look up the serviceId by querying the Service Catalog's DynamoDB table (or the local ServiceReference projection) using the ECS service ARN. If no mapping exists, emit the `unknown-service-deployed` event.

### Lambda Version Monitor

Lambda does not emit deployment events natively. Two approaches, use both:

1. CloudTrail: Configure a CloudWatch Events rule that matches CloudTrail API call events for `lambda:UpdateFunctionCode` and `lambda:PublishVersion`. Extract the function name and new SHA256 hash.

2. Polling: A scheduled Lambda runs every 15 minutes, lists all Lambda functions, and compares their `LastModified` timestamp and `CodeSha256` against the last known state in DynamoDB. If either has changed, record a deployment.

### GitHub Compare Adapter

When a deployment completes, the tracker needs to compute the DeploymentDelta (what changed between the previous and current SHA). This adapter calls the GitHub Compare API: `GET /repos/{owner}/{repo}/compare/{previousSha}...{currentSha}`.

Rate limiting: This is a supplementary data enrichment, not critical path. If the GitHub API rate limit is low, skip the delta computation and set the delta to null. It can be backfilled on the next scheduled reconciliation.

Caching: SHA comparisons are immutable — the diff between two commits never changes. Cache the result in DynamoDB with a TTL of 30 days to avoid redundant API calls when the same SHA range appears in multiple deployments (e.g., staging then production).

## Application Layer (Use Cases)

### RecordDeploymentStarted
Input: serviceId, environment, sha, actor, triggerSource, trigger-specific metadata.
Validation: serviceId must reference a known service (query ServiceReference projection). Environment must be a valid enum value.
Side effects: Creates Deployment record with status "started". Publishes `deployment.started` event.
Idempotency: If a deployment with status "started" already exists for the same serviceId + environment + sha within the last 2 hours, return the existing record.

### RecordDeploymentCompleted
Input: deploymentId OR (serviceId + environment + sha), status (success, failure, cancelled), completedAt.
Process: Find the matching started deployment. Update its status, completedAt, and durationSeconds. If status is success, update the EnvironmentSnapshot. If the completed SHA is older than the current SHA, mark the deployment as a rollback and set status to "rolled-back."
Side effects: Publishes `deployment.completed` event. If rollback, also publishes `deployment.rolled-back`. Triggers async DeploymentDelta computation.
Edge case: If no matching "started" deployment exists (webhook was missed), create a complete deployment record from scratch using the completion data. This self-healing behavior ensures the deployment log is complete even when data sources are unreliable.

### GetCurrentState
Input: serviceId, environment (optional — returns all environments if omitted).
Output: EnvironmentSnapshot(s) for the service. Includes current SHA, deployer, timestamp, and the DeploymentDelta (what changed in the last deployment).
Performance: Direct DynamoDB GetItem on the CURRENT#<environment> key. O(1).

### GetEnvironmentDiff
Input: serviceId, sourceEnvironment (default: staging), targetEnvironment (default: production).
Process: Fetch both EnvironmentSnapshots. If SHAs differ, call GitHub Compare API (via adapter) to get commit count and PR list. Calculate daysBehind from the deployment timestamps.
Output: EnvironmentDiff with all computed fields and a direct link to the GitHub compare view.

### DetectEnvironmentDrift
Input: none (runs on schedule).
Process: For each service with both staging and production EnvironmentSnapshots, compute the EnvironmentDiff. If commitsBehind exceeds the configured threshold (default: 5) or daysBehind exceeds 7, emit `environment.drift-detected`.
Schedule: Runs once per hour via EventBridge schedule.

### ListDeployments
Input: filters (serviceId, environment, actor, dateRange, status), pagination (limit, cursor).
Output: Paginated list of Deployments, most recent first. Each deployment includes the DeploymentDelta if available.

## API Surface

All endpoints are prefixed with `/api/v1/deployments/`.

- `GET /` — list deployments with filters
- `GET /:deploymentId` — get deployment detail including delta
- `POST /webhook/github` — GitHub webhook receiver
- `GET /services/:serviceId/current` — current state across all environments
- `GET /services/:serviceId/current/:environment` — current state for a specific environment
- `GET /services/:serviceId/diff` — environment diff (query params: source, target)
- `GET /services/:serviceId/history` — deployment history for a service
- `GET /environments/:environment/recent` — recent deployments across all services in an environment
- `GET /feed` — real-time deployment feed (SSE endpoint for the frontend dashboard)

## Frontend Pages

### Deployment Feed Page (/deployments)
A real-time feed of deployments across all services, most recent at the top. Each card shows: service name, environment badge, SHA (short), actor avatar, timestamp, status indicator (green check, red X, yellow spinner), and the deployment delta summary (e.g., "3 commits, 2 PRs by alice and bob").

Filter bar: environment selector, team/domain selector, status filter, date range picker. A toggle for "show only my team's deployments" that filters by the logged-in user's team.

Auto-refresh: The feed updates via Server-Sent Events. New deployments slide in at the top with a subtle animation. A notification badge appears if the user has scrolled down and new deployments arrived.

### Environment Comparison Page (/deployments/compare)
A table with one row per service. Columns: service name, staging SHA (linked to GitHub), production SHA (linked to GitHub), commits behind, days behind, diff link. Rows are sorted by drift severity (most behind at top). Rows with zero drift are collapsed into a "N services are in sync" summary.

Color coding: green = in sync, yellow = 1-5 commits behind, orange = 5-10 commits behind, red = 10+ commits behind or 7+ days behind.

### Service Deployment History Page (/deployments/services/:serviceId)
Timeline view of all deployments for a specific service across all environments. Each deployment shows the full detail including delta, actor, and trigger source. Environment lanes (staging and production as parallel swim lanes) make it visually clear how code flows from staging to production.

## Quick Win — Deliverable In Under 1 Week

A GitHub webhook receiver Lambda that listens for `deployment_status` and `workflow_run.completed` events, writes deployment records to DynamoDB, and posts a summary to a dedicated `#deployments` Slack channel using the existing Slack notification infrastructure. The Slack message includes: service name, environment, SHA (linked to GitHub), actor, and status emoji.

This gives immediate value: everyone can see deployments happening in real time in Slack without checking multiple AWS consoles or GitHub Actions tabs.
