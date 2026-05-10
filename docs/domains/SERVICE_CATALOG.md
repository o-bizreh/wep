# Service Catalog — Bounded Context Instructions

## Purpose

This is the foundational context of the platform. It answers three questions: "Who owns this service?", "What breaks if this service goes down?", and "What services exist in this domain?" Every other context in the platform depends on this one. Build it carefully — mistakes here propagate everywhere.

## Domain Model

### Entities

**Service** — the central entity. A Service represents a deployable unit that the organization operates. It is NOT necessarily a 1:1 mapping with a GitHub repository — a single repo may contain multiple services (e.g., a monorepo with both an API and a worker), and a service may span multiple AWS resources (an ECS service backed by an SQS queue and a DynamoDB table).

Service identity is derived from the combination of repository URL and runtime type. Two Lambda functions in the same repo are two distinct services. An ECS service and a Lambda in the same repo are also distinct. This reflects the operational reality that they are deployed and scaled independently.

Service attributes: serviceId, serviceName, repositoryUrl, runtimeType, ownerTeam (reference), environments (list of environments this service exists in), awsResources (map of ARNs by resource type), healthStatus (healthy, degraded, unhealthy, unknown), discoveryMethod (automated or manual), lastSyncedAt, metadata (extensible key-value map for custom attributes).

**Team** — the ownership entity. A Team maps to a GitHub team in the Washmen organization. Team identity is derived from the GitHub team slug to ensure consistency between GitHub and this platform.

Team attributes: teamId, teamName, domain, githubTeamSlug, slackChannelId, members (list of member references with role: lead or member), services (list of ServiceReferences they own).

**Dependency** — a directed relationship between two services. Service A depends on Service B means "if B goes down, A is affected." Dependencies are discovered automatically from package.json (for npm packages that are internal services), from AWS resource references (an ECS service reading from an SQS queue that another service writes to), and from manual declaration for dependencies that cannot be automatically detected.

Dependency attributes: sourceServiceId, targetServiceId, dependencyType (npm-package, aws-resource, api-call, manual), discoveredAt, discoveredBy (automation or a user identifier), confidence (high for explicit declarations, medium for package.json, low for inferred from infrastructure).

### Value Objects

**HealthStatus** — an assessment of the service's current operational state. Derived from the latest data from NewRelic (APM health), Sentry (error rate), and CloudWatch (resource health). The worst signal wins: if NewRelic says healthy but Sentry shows a spike, the service is degraded.

Health calculation logic: healthy = no active NewRelic incidents AND Sentry error rate below threshold AND all CloudWatch alarms OK. Degraded = any one signal is unhealthy. Unhealthy = two or more signals are unhealthy. Unknown = no monitoring data available (flag for investigation).

**AWSResourceMapping** — the set of AWS resources that belong to a service. Each resource is identified by ARN and typed by AWS service (ecs-service, lambda-function, sqs-queue, dynamodb-table, s3-bucket, cloudfront-distribution, etc.). This mapping is maintained by the infrastructure sync process and validated against the service's CloudFormation stack if one exists.

## Infrastructure Adapters

### GitHub Organization Crawler

This adapter connects to the GitHub API to discover repositories, teams, team memberships, and CODEOWNERS files. It runs on a 15-minute schedule.

The crawl process:
1. List all repositories in the Washmen GitHub organization. For each repository, extract: name, default branch, language, archived status, topics (used for metadata).
2. List all teams in the organization. For each team, extract: slug, name, members with roles.
3. For each non-archived repository, fetch the CODEOWNERS file from the default branch. Parse it to determine which team owns the repository. If no CODEOWNERS file exists, fall back to the GitHub team with admin access to the repo.
4. For each non-archived repository, fetch package.json from the default branch. Parse dependencies and devDependencies to identify internal packages (packages whose names match other repositories in the organization).

Rate limiting: GitHub API has a rate limit of 5000 requests per hour for authenticated requests. The crawler must track remaining quota and pause gracefully if it approaches the limit. Use conditional requests (If-None-Match with ETags) to avoid consuming quota for unchanged resources.

Pagination: All GitHub API list endpoints paginate. The crawler must follow Link headers to retrieve all pages. Never assume a single page contains all results.

### AWS Resource Scanner

This adapter connects to AWS APIs to discover ECS services, Lambda functions, EC2 instances, and other resources, then maps them to services in the catalog.

The scan process:
1. List all ECS clusters. For each cluster, list all services. For each service, describe the task definition to extract the image repository (maps to a GitHub repo) and resource tags.
2. List all Lambda functions. For each function, extract the function name, runtime, tags, and description. The tag `wep:service-id` is the primary mapping mechanism. If the tag is absent, attempt to match the function name to a repository name.
3. List all CloudFormation stacks. For each stack, list resources. This provides the most reliable resource-to-service mapping when stacks are organized per-service.
4. For resources that cannot be matched to a service, create an "orphaned resource" record. This surfaces untagged or unmapped resources for the DevOps team to investigate.

Multi-account consideration: If Washmen uses multiple AWS accounts (e.g., separate accounts for production and staging), the scanner must assume an IAM role in each target account. The roles and account IDs are configured in the environment, not hard-coded.

### Health Aggregator

This adapter periodically queries NewRelic, Sentry, and CloudWatch to compute the HealthStatus for each service.

NewRelic: Use the NerdGraph API to query active incidents and alert conditions per application. Map NewRelic application names to service IDs using a configurable mapping (NewRelic application names rarely match repository or service names exactly).

Sentry: Use the Sentry API to query error rates per project over the last 15 minutes. Map Sentry project slugs to service IDs using a configurable mapping.

CloudWatch: Query alarm states for alarms tagged with `wep:service-id`. A service's infrastructure health is determined by the worst alarm state among its associated resources.

## Application Layer (Use Cases)

### RegisterService
Input: Service metadata (manually provided or from automated discovery).
Validation: serviceName must be unique. repositoryUrl must be a valid Washmen GitHub repo URL. ownerTeam must reference an existing team.
Side effects: Publishes `service.registered` event. If the service has AWS resources, triggers an immediate resource scan for that service.
Idempotency: If a service with the same serviceId already exists, this is an update, not a creation. Publish `service.updated` instead.

### UpdateServiceOwnership
Input: serviceId, newOwnerTeamId.
Validation: Both service and team must exist. The requesting user must be a member of either the current or new owner team, or a DevOps team member.
Side effects: Publishes `service.updated` with changedFields = ["ownerTeamId"]. Also publishes `team.updated` for both the old and new owner teams.

### GetDependencyGraph
Input: serviceId, depth (default 2, max 5).
Output: A graph structure with nodes (services) and edges (dependencies), expanding outward from the input service to the specified depth. Each node includes the ServiceReference and HealthStatus. Each edge includes the dependency type and confidence level.
Performance: This is a recursive traversal of the dependency table. Cache the result for 5 minutes since the dependency graph changes infrequently.

### ReconcileDiscoveredState
Input: Full crawl results from GitHub and AWS adapters.
Process: Compare discovered state against current registry. For each difference, determine if it is a new service, an updated service, or a removed service. Emit appropriate events. Services that are present in the registry but not discovered in the crawl are marked as "stale" after 3 consecutive missed discoveries — they are not immediately deregistered to account for transient crawl failures.

### SearchServices
Input: query string, filters (team, domain, environment, runtime type, health status).
Output: Paginated list of ServiceReferences matching the criteria.
Implementation: Use DynamoDB query on the appropriate GSI for filter-based searches. For text search on service name, use the name prefix GSI. If full-text search is needed in the future, add an OpenSearch domain — but start with prefix matching and exact filters, which cover the majority of use cases.

## API Surface

All endpoints are prefixed with `/api/v1/catalog/`.

- `GET /services` — list services with optional filters
- `GET /services/:serviceId` — get service detail including AWS resources and health
- `POST /services` — manually register a service
- `PATCH /services/:serviceId` — update service metadata
- `DELETE /services/:serviceId` — soft delete (deregister)
- `GET /services/:serviceId/dependencies` — get dependency graph
- `GET /services/:serviceId/dependents` — get reverse dependency graph (what depends on me)
- `GET /teams` — list teams with optional domain filter
- `GET /teams/:teamId` — get team detail including owned services
- `GET /teams/:teamId/services` — list services owned by a team
- `GET /health/sync-status` — last sync times for each adapter, any errors

## Frontend Pages

### Service List Page (/catalog)
A searchable, filterable table of all services. Columns: service name, owner team, runtime type, environment badges, health status indicator, last deployed timestamp (pulled from Deployment Tracker via BFF). Clicking a service navigates to the service detail page.

The filter panel is a molecule component with dropdowns for team, domain, environment, and runtime type, plus a search input for name. Filters are reflected in the URL query parameters for shareability.

### Service Detail Page (/catalog/services/:serviceId)
Top section: service metadata card (name, owner, repo link, runtime type, health status with tooltip showing contributing signals). Below: tabbed view with tabs for Dependencies (visual graph), AWS Resources (table of ARNs with links to AWS console), Deployments (recent deployments pulled from Deployment Tracker), and Configuration (environment variables from Parameter Store, if accessible).

The dependency graph visualization uses a directed graph layout. Nodes are clickable to navigate to the dependent service's detail page. Edge colors indicate dependency type. Node colors indicate health status.

### Team Dashboard Page (/catalog/teams/:teamId)
Overview of all services owned by the team, their health statuses, and quick access to deployment and velocity data for the team. This is the landing page a team lead checks in the morning to understand "how's my domain doing."

## Quick Win — Deliverable In Under 1 Week

A Lambda function that runs on a 15-minute schedule, crawls the GitHub organization (repos + teams), lists ECS clusters and services plus Lambda functions, and writes the results to a DynamoDB table. A static Next.js page reads from DynamoDB via an API route and renders a searchable table. No health aggregation, no dependency detection, no manual registration — just automated discovery and display.

This gives immediate value: engineers can look up who owns a service and which team is responsible. Everything else builds on this foundation.
