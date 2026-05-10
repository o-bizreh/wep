# Data Model

## Shared Types

These types are published by their owning context and consumed as read-only references by other contexts. They live in `packages/shared/domain-types/`.

### ServiceReference
Owner: Service Catalog. Consumed by every other context.

Fields:
- serviceId — deterministic identifier derived from repository URL and runtime type. Format: `svc_<sha256(repoUrl+runtimeType)[:12]>`. This ensures the same service always gets the same ID regardless of when it was discovered.
- serviceName — human-readable name, defaulting to repository name but overridable
- repositoryUrl — full GitHub repository URL
- ownerTeamId — references the Team entity in Service Catalog
- ownerTeamName — denormalized for display purposes, updated via events
- runtimeType — enum: ecs, lambda, ec2, step-function, static
- environment — enum: production, staging, development

### TeamReference
Owner: Service Catalog. Consumed by Velocity Metrics, Cost Intelligence, Self-Service.

Fields:
- teamId — deterministic identifier derived from GitHub team slug. Format: `team_<github_team_slug>`
- teamName — display name
- domain — the organizational domain (CustomerDomain, PaymentDomain, DataDomain, DevOps)
- memberCount — number of team members (used by Velocity Metrics to determine if team is large enough for standalone metrics)
- slackChannelId — for notifications routing

## Per-Context DynamoDB Schemas

### Service Catalog Table: `wep-service-catalog-<env>`

Access patterns this table must support:
1. Get a service by ID
2. List all services owned by a team
3. List all services in an environment
4. Get the dependency graph for a service (what it depends on, what depends on it)
5. Get a team by ID
6. List all teams in a domain
7. Search services by name (prefix match)

Single-table design:

| Access Pattern | PK | SK | GSI1PK | GSI1SK |
|---|---|---|---|---|
| Get service by ID | `SERVICE#<serviceId>` | `METADATA` | — | — |
| Service dependencies | `SERVICE#<serviceId>` | `DEPENDS_ON#<targetServiceId>` | `SERVICE#<targetServiceId>` | `DEPENDED_BY#<serviceId>` |
| Services by team | (scan with filter) | — | `TEAM#<teamId>` | `SERVICE#<serviceName>` |
| Services by environment | (scan with filter) | — | `ENV#<environment>` | `SERVICE#<serviceName>` |
| Get team by ID | `TEAM#<teamId>` | `METADATA` | — | — |
| Teams by domain | (scan with filter) | — | `DOMAIN#<domain>` | `TEAM#<teamName>` |
| Service by name prefix | — | — | `NAME_INDEX` | `<serviceName>` |

Additional attribute: `awsResources` — a map of AWS resource ARNs associated with this service, keyed by resource type. This is a denormalized view maintained by the infrastructure sync Lambda.

### Deployment Tracker Table: `wep-deployment-tracker-<env>`

Access patterns:
1. Get a deployment by ID
2. List deployments for a service (most recent first)
3. List deployments by environment (most recent first)
4. Get current deployed version per service per environment
5. List deployments by actor (for audit, not for metrics)
6. List deployments in a time range

| Access Pattern | PK | SK | GSI1PK | GSI1SK |
|---|---|---|---|---|
| Get deployment by ID | `DEPLOY#<deploymentId>` | `METADATA` | — | — |
| Deployments by service | `SERVICE#<serviceId>` | `DEPLOY#<timestamp>#<deploymentId>` | — | — |
| Current version per env | `SERVICE#<serviceId>` | `CURRENT#<environment>` | — | — |
| Deployments by env | — | — | `ENV#<environment>` | `<timestamp>#<deploymentId>` |
| Deployments by actor | — | — | `ACTOR#<githubUsername>` | `<timestamp>#<deploymentId>` |
| Deployments by time | — | — | `DATE#<YYYY-MM-DD>` | `<timestamp>#<deploymentId>` |

The `CURRENT#<environment>` record is a snapshot that gets overwritten on every successful deployment. It contains: serviceId, environment, sha, version, deployedAt, deployedBy. This enables O(1) lookup for "what's running in production right now."

### Velocity Metrics Table: `wep-velocity-metrics-<env>`

Access patterns:
1. Get current DORA metrics for a team
2. Get DORA metric history for a team (weekly snapshots)
3. Get organization-wide DORA summary
4. Get metric snapshots for a specific time range

| Access Pattern | PK | SK |
|---|---|---|
| Current metrics by team | `TEAM#<teamId>` | `CURRENT` |
| Weekly snapshot by team | `TEAM#<teamId>` | `WEEK#<YYYY-WW>` |
| Monthly snapshot by team | `TEAM#<teamId>` | `MONTH#<YYYY-MM>` |
| Org-wide current | `ORG#washmen` | `CURRENT` |
| Org-wide weekly | `ORG#washmen` | `WEEK#<YYYY-WW>` |

Each metrics record contains four values: deploymentFrequency (deploys per day), leadTimeForChanges (hours from first commit to production), meanTimeToRecovery (hours from incident to resolution), changeFailureRate (percentage of deployments causing incidents). Each value includes the raw number plus a DORA performance level classification (elite, high, medium, low) based on the published DORA benchmarks.

### Pipeline Analytics Table: `wep-pipeline-analytics-<env>`

Access patterns:
1. Get pipeline run details
2. List runs by workflow (most recent first)
3. List runs by service
4. Get failure categorization summary by time range
5. Get cost summary by team by month

| Access Pattern | PK | SK | GSI1PK | GSI1SK |
|---|---|---|---|---|
| Run by ID | `RUN#<runId>` | `METADATA` | — | — |
| Runs by workflow | `WORKFLOW#<workflowId>` | `RUN#<timestamp>#<runId>` | — | — |
| Runs by service | — | — | `SERVICE#<serviceId>` | `RUN#<timestamp>#<runId>` |
| Failure summary | `FAILURES#<YYYY-MM>` | `CATEGORY#<category>` | — | — |
| Cost by team/month | `COST#<YYYY-MM>` | `TEAM#<teamId>` | — | — |

### Cost Intelligence Table: `wep-cost-intelligence-<env>`

Access patterns:
1. Get daily cost for a service
2. Get monthly cost summary by team
3. Get cost trend for a service (daily over last 90 days)
4. Get unattributed costs
5. Get optimization recommendations by service

| Access Pattern | PK | SK | GSI1PK | GSI1SK |
|---|---|---|---|---|
| Daily cost by service | `SERVICE#<serviceId>` | `DAY#<YYYY-MM-DD>` | — | — |
| Monthly cost by team | `TEAM#<teamId>` | `MONTH#<YYYY-MM>` | — | — |
| Unattributed daily | `UNATTRIBUTED` | `DAY#<YYYY-MM-DD>` | — | — |
| Recommendations | `SERVICE#<serviceId>` | `RECOMMENDATION#<type>` | — | — |
| Monthly org total | `ORG#washmen` | `MONTH#<YYYY-MM>` | — | — |

### Self-Service Table: `wep-self-service-<env>`

Access patterns:
1. Get request by ID
2. List requests by requester (most recent first)
3. List pending approvals by approver
4. Get operation catalog
5. Audit log by service

| Access Pattern | PK | SK | GSI1PK | GSI1SK |
|---|---|---|---|---|
| Request by ID | `REQUEST#<requestId>` | `METADATA` | — | — |
| Requests by user | `USER#<userId>` | `REQUEST#<timestamp>#<requestId>` | — | — |
| Pending approvals | — | — | `APPROVER#<approverId>` | `PENDING#<timestamp>#<requestId>` |
| Operation catalog | `CATALOG` | `OP#<operationType>` | — | — |
| Audit by service | — | — | `AUDIT#SERVICE#<serviceId>` | `<timestamp>#<requestId>` |

## Data Retention

- Service Catalog: No retention limit. Services are soft-deleted (marked inactive) and retained indefinitely for dependency history.
- Deployment Tracker: 365 days of individual deployment records. Current version snapshots retained indefinitely.
- Velocity Metrics: Weekly snapshots retained for 2 years. Daily granularity retained for 90 days.
- Pipeline Analytics: Individual run records retained for 90 days. Monthly summaries retained for 2 years.
- Cost Intelligence: Daily granularity retained for 90 days. Monthly summaries retained for 3 years (aligns with finance requirements).
- Self-Service: Audit records retained for 2 years. Active requests retained until resolved.

Implement TTL using DynamoDB's native TTL feature on an `expiresAt` attribute. The background sync Lambda sets this attribute based on the retention rules above at write time.
