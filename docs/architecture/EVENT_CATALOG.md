# Event Catalog

## EventBridge Bus

All platform events flow through a dedicated EventBridge bus named `wep-platform-<env>`. Do not use the default bus — it is shared with other AWS workloads and creates noise.

## Event Envelope

Every event published to the bus follows this envelope structure:

```
Source: "wep.<context-name>"
DetailType: "<entity>.<action>"
Detail: {
  eventId: string (UUIDv4, generated at publish time)
  entityId: string (the primary identifier of the affected entity)
  entityType: string (the type of entity: service, deployment, team, etc.)
  timestamp: string (ISO 8601, UTC)
  version: integer (schema version, starting at 1)
  correlationId: string (optional, for tracing related events across contexts)
  data: object (context-specific payload)
}
```

When publishing an event, the publisher generates the eventId and timestamp. The correlationId is propagated from the triggering event if one exists — this enables end-to-end tracing of event chains (e.g., a GitHub push triggers a deployment event, which triggers a DORA metric recalculation).

## Event Registry

### Service Catalog Events (Source: wep.service-catalog)

**service.registered**
Emitted when a new service is added to the registry, either by automated discovery or manual registration.
Data payload: Full ServiceReference plus discoveryMethod (automated or manual) and initialHealthStatus.
Consumers: Deployment Tracker (starts tracking), Cost Intelligence (sets up tagging), Self-Service (adds to operation scope).

**service.updated**
Emitted when service metadata changes — owner, dependencies, runtime type, or health status.
Data payload: ServiceReference with changedFields array indicating which fields changed, plus previousValues map.
Consumers: All contexts that hold a cached ServiceReference.

**service.deregistered**
Emitted when a service is removed from the registry. Soft delete only — the service is marked inactive.
Data payload: serviceId, reason (manual, repository-archived, resource-deleted).
Consumers: All contexts. They should mark related data as belonging to an inactive service but not delete it.

**team.updated**
Emitted when team composition, ownership, or metadata changes.
Data payload: TeamReference with changedFields array.
Consumers: Velocity Metrics (may need to reaggregate), Self-Service (permission changes).

**dependency.changed**
Emitted when the dependency graph changes for any service.
Data payload: serviceId, added (array of new dependency serviceIds), removed (array of removed dependency serviceIds).
Consumers: Any context that renders or reasons about the dependency graph.

### Deployment Tracker Events (Source: wep.deployment-tracker)

**deployment.started**
Emitted when a deployment begins. May arrive from GitHub webhook or ECS event.
Data payload: deploymentId, serviceId, environment, sha, actor, triggerSource (github-actions, ecs-direct, manual).

**deployment.completed**
Emitted when a deployment finishes, regardless of outcome.
Data payload: deploymentId, serviceId, environment, sha, actor, status (success, failure, cancelled), durationSeconds, previousSha, changedFiles (count only, not file list).
Consumers: Velocity Metrics (deployment frequency, change failure rate), Pipeline Analytics (maps to workflow run).

**deployment.rolled-back**
Emitted when a rollback is detected — either explicit rollback action or deployment of a previous SHA.
Data payload: deploymentId, serviceId, environment, rolledBackSha, rolledBackToSha, rollbackReason (manual, automated, health-check-failure).
Consumers: Velocity Metrics (contributes to change failure rate and MTTR).

**environment.drift-detected**
Emitted when the delta between staging and production for a service exceeds a configurable threshold (default: staging is more than 5 deployments ahead of production).
Data payload: serviceId, stagingSha, productionSha, commitsBehind, daysBehind.
Consumers: Slack notification via existing alert aggregation system.

**unknown-service-deployed**
Emitted when a deployment event references a service not in the Service Catalog.
Data payload: rawIdentifier (the ECS service name, Lambda function name, or repository slug), environment, deploymentDetails.
Consumers: Service Catalog (triggers investigation and potential auto-registration).

### Velocity Metrics Events (Source: wep.velocity-metrics)

**snapshot.generated**
Emitted weekly when the scheduled metric calculation completes.
Data payload: snapshotPeriod (week identifier), metrics (map of teamId to DORA metric values), orgWideMetrics.
Consumers: Slack notifier (posts weekly digest to engineering channel).

**anomaly.detected**
Emitted when a DORA metric for a team deviates by more than 2 standard deviations from its 8-week rolling average.
Data payload: teamId, metricName, currentValue, rollingAverage, standardDeviations, direction (improved or degraded).
Consumers: Slack notifier (DMs the team lead, not the whole channel — anomalies are coaching opportunities, not public callouts).

### Pipeline Analytics Events (Source: wep.pipeline-analytics)

**pipeline.failure-spike**
Emitted when a workflow's failure rate in the last 24 hours exceeds double its 30-day average.
Data payload: workflowId, workflowName, repositoryUrl, failureRate24h, failureRate30d, dominantFailureCategory.
Consumers: Slack notifier.

**cost.threshold-exceeded**
Emitted when a team's monthly GitHub Actions spend exceeds a configurable threshold.
Data payload: teamId, monthToDateCost, threshold, projectedMonthlyCost.
Consumers: Slack notifier (posts to the team's channel and DevOps channel).

### Cost Intelligence Events (Source: wep.cost-intelligence)

**anomaly.detected**
Emitted when a service's daily cost deviates significantly from its 30-day trend.
Data payload: serviceId, date, actualCost, expectedCost, deviationPercentage, possibleCauses (list of hypotheses based on correlated CloudWatch metrics).
Consumers: Slack notifier, Deployment Tracker (checks if a recent deployment correlates).

**optimization.identified**
Emitted when the system identifies a concrete cost optimization opportunity.
Data payload: serviceId, optimizationType (right-size, reserved-instance, unused-resource, over-provisioned), estimatedMonthlySaving, currentConfiguration, recommendedConfiguration.
Consumers: Self-Service (can create a one-click action to apply the recommendation for low-risk optimizations).

### Self-Service Events (Source: wep.self-service)

**request.submitted**
Emitted when a developer submits a self-service request.
Data payload: requestId, requesterId, operationType, serviceId (if applicable), tier (self-serve, peer-approved, devops-approved).

**request.approved**
Emitted when a request is approved.
Data payload: requestId, approverId, approvalTimestamp.

**request.executed**
Emitted when the approved operation is executed.
Data payload: requestId, executionResult (success or failure), executionDetails, auditTrail.

**request.rejected**
Emitted when a request is rejected.
Data payload: requestId, rejectedBy, rejectionReason.

## Event Versioning

When an event schema changes, increment the version field. Consumers must handle both the current and previous version for a minimum of 30 days after a schema change is deployed. After 30 days, the old version can be dropped.

Breaking changes (removing fields, changing field types) require a new DetailType rather than a version bump. Non-breaking changes (adding optional fields) use version increments.

## Dead Letter Queue

Every EventBridge rule has a DLQ (SQS queue) configured. Failed deliveries land in the DLQ with a retention period of 14 days. A CloudWatch alarm fires when the DLQ depth exceeds 0, routing to the DevOps Slack channel via the existing alert aggregation system.

The DLQ consumer Lambda attempts reprocessing with exponential backoff (1 min, 5 min, 30 min). After 3 failures, it publishes a `wep.platform.event-processing-failed` event with the original event payload and error details for manual investigation.
