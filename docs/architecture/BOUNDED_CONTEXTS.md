# Bounded Contexts & Integration Map

## Context Overview

This platform consists of six bounded contexts organized in two phases. Phase 1 contexts are foundational — they produce the data that Phase 2 contexts consume. Never build a Phase 2 context before its Phase 1 dependencies are stable.

## Context Dependency Graph

```
SERVICE CATALOG (Phase 1 — the shared kernel)
    ├──→ DEPLOYMENT TRACKER (Phase 1 — consumes ServiceReference)
    │        └──→ VELOCITY METRICS (Phase 1 — consumes DeploymentEvent)
    │        └──→ PIPELINE ANALYTICS (Phase 2 — consumes PipelineRun)
    ├──→ COST INTELLIGENCE (Phase 2 — consumes ServiceReference + resource tags)
    └──→ SELF SERVICE (Phase 2 — consumes ServiceReference + OwnerTeam)
```

The arrow means "depends on published interfaces of." No reverse dependencies are permitted.

## Context 1: Service Catalog

### Owns
- The canonical definition of a Service entity (name, owner, repository, runtime, dependencies, health status)
- The canonical definition of a Team entity (name, members, domain, communication channels)
- The dependency graph between services
- The mapping from AWS resources (ECS services, Lambda functions, EC2 instances) to logical services

### Publishes
- `service-catalog.service.registered` — when a new service is discovered or manually added
- `service-catalog.service.updated` — when service metadata changes (owner, dependencies, health)
- `service-catalog.service.deregistered` — when a service is removed
- `service-catalog.team.updated` — when team composition or ownership changes
- `service-catalog.dependency.changed` — when the dependency graph changes

### Published Interface (ServiceReference)
Other contexts import this type, not the full Service entity:
```
ServiceReference {
  serviceId: string (deterministic hash of repository + runtime)
  serviceName: string
  repositoryUrl: string
  ownerTeamId: string
  ownerTeamName: string
  runtimeType: "ecs" | "lambda" | "ec2" | "step-function" | "static"
  environment: "production" | "staging" | "development"
}
```

### Data Sources
- GitHub Organization API: repositories, teams, CODEOWNERS files
- AWS ECS: cluster/service descriptions, task definitions
- AWS Lambda: function configurations, tags
- AWS CloudFormation: stack resources and outputs
- package.json: dependency declarations across repos

### Sync Strategy
A scheduled Lambda runs every 15 minutes and performs a full reconciliation crawl. It compares discovered state against the stored registry and emits change events for any differences. Manual registration via API is supported for edge cases that automated discovery cannot handle (external services, third-party dependencies).

## Context 2: Deployment Tracker

### Owns
- The deployment event log (who deployed what, where, when, what SHA, what changed)
- Environment state snapshots (what version of each service is running in each environment right now)
- Deployment diffs (what's different between staging and production for a given service)

### Publishes
- `deployment-tracker.deployment.started` — when a deployment begins
- `deployment-tracker.deployment.completed` — includes status (success/failure), duration, SHA range
- `deployment-tracker.deployment.rolled-back` — when a rollback is detected
- `deployment-tracker.environment.drift-detected` — when staging/production diverge beyond threshold

### Consumes
- `service-catalog.service.registered` — to know which services to track
- GitHub Deployment Events webhook — primary deployment signal
- GitHub Actions workflow run completions — secondary signal for workflows that don't use GitHub Deployments API
- ECS deployment events via CloudWatch Events — for direct ECS deployments
- Lambda version publications via CloudTrail — for Lambda deployments

### Key Invariant
Every deployment record must be linked to a ServiceReference. If a deployment event arrives for an unknown service, the tracker creates a provisional record and emits `deployment-tracker.unknown-service-deployed` so the Service Catalog can investigate.

## Context 3: Velocity Metrics

### Owns
- DORA metric calculations (Deployment Frequency, Lead Time for Changes, Mean Time to Recovery, Change Failure Rate)
- Trend data and historical aggregations at team granularity
- Metric snapshots for weekly/monthly reporting

### Publishes
- `velocity-metrics.snapshot.generated` — weekly metric snapshots for Slack digests
- `velocity-metrics.anomaly.detected` — when a metric deviates significantly from the rolling average (this is NOT for blaming — it's for identifying systemic issues like a flaky test suite slowing everyone down)

### Consumes
- `deployment-tracker.deployment.completed` — for deployment frequency and change failure rate
- GitHub Pull Request events (webhook) — for lead time calculation (PR opened → merged → deployed)
- Sentry issue resolution events — for mean time to recovery
- NewRelic incident close events — for mean time to recovery (cross-referenced with Sentry)

### Critical Constraint: No Individual Metrics
This context NEVER calculates, stores, or exposes metrics at the individual developer level. The minimum granularity is team. If a team has fewer than 3 members, their metrics are rolled up into their parent domain metrics to prevent de-anonymization. This is not a soft guideline — it is a hard architectural constraint enforced at the domain layer. Any query or API that could return individual-level data must be rejected at the application layer before it reaches the database.

## Context 4: Pipeline Analytics (Phase 2)

### Owns
- GitHub Actions workflow run history with cost attribution
- Pipeline failure categorization (flaky test, build error, infra failure, timeout)
- Pipeline performance trends (duration, queue time, success rate)
- Cost-per-pipeline and cost-per-team calculations using GitHub Actions billing data

### Consumes
- `service-catalog.service.registered` — to map workflows to services and teams
- GitHub Actions API (polling) — workflow runs, job details, billing data
- GitHub Actions webhook events — real-time run status updates

### Key Design Decision
Pipeline failures are categorized by automated pattern matching against failure logs, not by manual triage. The categorization model starts with simple regex patterns (test assertion failures, npm install timeouts, Docker build errors) and can be extended over time. Do not build an ML classifier — the regex approach covers the Pareto-dominant failure modes and is debuggable.

## Context 5: Cost Intelligence (Phase 2)

### Owns
- Per-service and per-team AWS cost attribution
- Cost trend analysis and anomaly detection
- Resource utilization efficiency scores (cost vs actual CPU/memory usage)
- Optimization recommendations (right-sizing, reserved instance opportunities)

### Consumes
- `service-catalog.service.registered` — to map AWS resources to services via tags
- AWS Cost Explorer API (daily pull) — cost and usage data
- AWS CloudWatch metrics (polling) — CPU/memory utilization for ECS and EC2
- AWS Lambda metrics — invocation count, duration, memory usage vs allocated

### Tagging Dependency
This context is only as good as the tagging strategy. It depends on the Service Catalog maintaining accurate resource-to-service mappings and enforcing the tag `wep:service-id` on all AWS resources. If a resource is untagged, it appears under "Unattributed" in cost reports — this is by design and creates healthy pressure to tag everything.

## Context 6: Self-Service Portal (Phase 2)

### Owns
- The catalog of available self-service operations
- Request/approval workflows for privileged operations
- Audit log of all self-service actions
- Service scaffolding templates (new repo, new Lambda, new ECS service)

### Consumes
- `service-catalog.service.registered` — to scope operations to services the user owns
- `service-catalog.team.updated` — to determine user permissions based on team membership
- IAM Identity Center — for authentication and group-based authorization
- GitHub API — for repository creation, team membership management
- AWS SDK — for resource provisioning (scoped IAM roles per operation)

### Security Model
Every self-service operation falls into one of three tiers:
1. **Self-serve (no approval):** Log access, read-only environment inspection, service scaffolding within own team
2. **Peer-approved (team lead signs off):** Secret access requests, database read access, feature flag changes
3. **DevOps-approved (Omar or Ali signs off):** Production resource provisioning, IAM policy changes, cross-account access

The tier classification is defined per operation type in configuration, not hard-coded. New operations can be added with their tier without code changes.

## Anti-Corruption Layers

When a bounded context consumes data from an external system (GitHub, AWS, Sentry, NewRelic), it must do so through an anti-corruption layer that translates external models into domain models. The external system's data structures, naming conventions, and quirks must never leak into the domain layer.

For example, the Deployment Tracker's GitHub adapter translates GitHub's workflow run object into the domain's DeploymentEvent entity. If GitHub changes their API response shape, only the adapter changes — the domain remains stable.

Every adapter lives in the `infrastructure/` directory of its context and implements a port interface defined in the `domain/` directory.
