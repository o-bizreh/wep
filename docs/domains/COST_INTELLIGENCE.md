# Cost Intelligence — Bounded Context Instructions

## Purpose

This context answers: "How much does each service cost?", "Which team is spending the most?", "Are we over-provisioned?", and "Where can we save money without impacting performance?" It transforms raw AWS and GCP billing data into per-service and per-team cost attribution with actionable optimization recommendations.

## Domain Model

### Entities

**ServiceCostRecord** — daily cost attribution for a single service. The atomic unit of cost tracking.

ServiceCostRecord attributes: serviceId, date (YYYY-MM-DD), totalCost, breakdownByResourceType (map of resource type to cost: ecs, lambda, dynamodb, s3, cloudfront, sqs, etc.), breakdownByUsageType (map of usage category to cost: compute, storage, data-transfer, requests), topResources (list of the 5 most expensive individual resources with ARN and cost), utilizationMetrics (CPU average, memory average, invocation count — context for whether the cost is justified).

**TeamCostSummary** — monthly aggregated cost for a team, computed from constituent ServiceCostRecords.

TeamCostSummary attributes: teamId, month (YYYY-MM), totalCost, serviceBreakdown (map of serviceId to cost), resourceTypeBreakdown, monthOverMonthChange (percentage), costPerDeployment (total cost divided by deployment count from Deployment Tracker — measures efficiency).

**CostAnomaly** — a detected deviation from expected cost patterns.

CostAnomaly attributes: anomalyId, serviceId, date, expectedCost (based on 30-day trend), actualCost, deviationPercentage, severity (low: 20-50% deviation, medium: 50-100%, high: >100%), possibleCauses (list of hypotheses), correlatedDeployments (list of deploymentIds within 24 hours, from Deployment Tracker events), status (detected, investigating, resolved, expected), resolvedBy, resolution.

**OptimizationRecommendation** — an identified opportunity to reduce cost without impacting performance.

OptimizationRecommendation attributes: recommendationId, serviceId, type (right-size-ecs, right-size-lambda, reserved-instance, unused-resource, over-provisioned-dynamodb, stale-s3, idle-nat-gateway), currentConfiguration, recommendedConfiguration, estimatedMonthlySaving, confidence (high: strong utilization data, medium: partial data, low: inferred), evidence (the metrics supporting the recommendation), status (open, accepted, dismissed, implemented), implementedAt, actualSaving (filled after implementation for ROI tracking).

### Value Objects

**CostTrend** — a derived view of cost trajectory for a service or team.

Direction: increasing (>10% month-over-month growth), stable (within 10%), decreasing (>10% reduction).
Projection: estimated cost for the current month based on daily run rate.
Anomalous: boolean, true if the trend deviates from the 3-month rolling pattern.

**UnattributedCost** — cost that cannot be mapped to any service because the underlying AWS resources lack the `wep:service-id` tag. Tracked separately and surfaced prominently to create pressure for complete tagging.

## Infrastructure Adapters

### AWS Cost Explorer Adapter

A daily Lambda (runs at 06:00 UTC, after AWS finalizes the previous day's data) that queries the AWS Cost Explorer API.

Query strategy:
1. GetCostAndUsage grouped by tag `wep:service-id` and UsageType for the previous day. This gives per-service cost with usage type breakdown in a single API call.
2. For resources without the `wep:service-id` tag, query grouped by SERVICE (AWS service like AmazonECS, AWSLambda) to get unattributed cost by AWS service type. This helps identify which untagged resources are most expensive.
3. GetCostForecast for the current month to project end-of-month spend.

Cost Explorer API pricing: Each GetCostAndUsage call costs $0.01. With 3 calls per day, this adapter costs ~$0.90/month. Negligible.

Multi-account: If Washmen uses AWS Organizations, query from the management account to get consolidated billing data. If accounts are not in an Organization, the adapter must assume a role in each account and aggregate. The account list is stored in DynamoDB configuration, not hard-coded.

### CloudWatch Utilization Adapter

A scheduled Lambda (every 6 hours) that collects utilization metrics for cost optimization analysis.

Metrics to collect:
- ECS services: CPUUtilization (average, max), MemoryUtilization (average, max) over the last 24 hours.
- Lambda functions: Invocations (sum), Duration (average, P99), ConcurrentExecutions (max), Errors (sum) over the last 24 hours.
- DynamoDB tables: ConsumedReadCapacityUnits, ConsumedWriteCapacityUnits vs ProvisionedReadCapacityUnits, ProvisionedWriteCapacityUnits over the last 24 hours.
- RDS instances (if applicable): CPUUtilization, DatabaseConnections, FreeableMemory.

For each metric, compute a utilization percentage (actual vs provisioned/allocated). Store in the ServiceCostRecord's utilizationMetrics field for the optimization engine.

### GCP Billing Adapter

If Washmen uses GCP services (Firebase, etc.), a daily Lambda queries the GCP Billing Export from BigQuery (if configured) or the Cloud Billing API.

GCP cost attribution is typically done via labels (equivalent to AWS tags). The adapter maps GCP labels to service IDs using the same `wep:service-id` convention.

This adapter may not be needed initially if GCP spend is minimal. Implement only when GCP costs are significant enough to warrant tracking. Start with a manual entry for total GCP spend and break it down when the data justifies the effort.

## Application Layer (Use Cases)

### IngestDailyCost
Input: Raw Cost Explorer data for a specific date.
Process: For each `wep:service-id` tag value, create or update a ServiceCostRecord. For untagged resources, aggregate into the UnattributedCost record. Calculate day-over-day change for anomaly detection.
Side effects: If the daily cost for any service deviates by more than 50% from its 30-day average, create a CostAnomaly and publish `cost-intelligence.anomaly.detected`.

### CalculateTeamSummary
Input: teamId, month.
Process: Aggregate all ServiceCostRecords for services owned by the team (via Service Catalog mapping) for the given month. Calculate breakdowns, trends, and cost-per-deployment.
Schedule: Runs daily for the current month (updates the running total). Runs once on the 2nd of each month to finalize the previous month.

### DetectAnomalies
Input: ServiceCostRecord for today.
Process: Compare today's cost against the 30-day rolling average and standard deviation. If deviation exceeds thresholds (20% for low, 50% for medium, 100% for high), create an anomaly. Cross-reference with Deployment Tracker events to identify if a recent deployment correlates.
Hypothesis generation: If a deployment correlates, the hypothesis is "deployment-related cost change." If CPU/memory utilization spiked, the hypothesis is "traffic increase." If a new resource type appeared in the cost breakdown, the hypothesis is "new resource provisioned." If none of these, the hypothesis is "requires investigation."

### GenerateOptimizations
Input: none (runs weekly).
Process: For each service, analyze the last 30 days of cost and utilization data.

Right-sizing rules:
- ECS: If average CPU utilization is below 20% for 30 days, recommend reducing the task CPU allocation by 50%. If average memory utilization is below 30%, recommend reducing memory allocation.
- Lambda: If average memory utilization (billed duration * memory allocated vs actual memory used) is below 50%, recommend reducing memory allocation. If average duration is below 100ms and memory is above 512MB, flag for potential over-allocation.
- DynamoDB: If consumed capacity is consistently below 30% of provisioned capacity, recommend switching to on-demand mode or reducing provisioned capacity.

Unused resource detection:
- Lambda functions with zero invocations in 30 days.
- ECS services with zero running tasks for 7+ days.
- S3 buckets with no GetObject requests in 90 days (excluding backup buckets tagged as such).
- Elastic IPs not attached to running instances.
- NAT Gateways with zero processed bytes in 7 days.

Each recommendation includes estimated savings calculated from the current cost and the projected cost under the recommended configuration.

### GetCostDashboard
Input: scope (org, team, service), period (current month, last month, custom range).
Output: Total cost, breakdown by resource type, breakdown by service or team, trend line, projected end-of-month cost, unattributed cost percentage, top anomalies, top optimization opportunities.

## API Surface

All endpoints are prefixed with `/api/v1/costs/`.

- `GET /overview` — org-wide cost summary with team breakdown
- `GET /teams/:teamId` — team cost detail with service breakdown
- `GET /services/:serviceId` — service cost detail with resource breakdown
- `GET /services/:serviceId/daily` — daily cost timeseries for a service
- `GET /unattributed` — unattributed cost breakdown by AWS service type
- `GET /anomalies` — cost anomalies with status filters
- `PATCH /anomalies/:anomalyId` — update anomaly status (investigating, resolved, expected)
- `GET /optimizations` — active optimization recommendations
- `PATCH /optimizations/:recommendationId` — update recommendation status
- `GET /forecast` — end-of-month cost projection

## Frontend Pages

### Cost Overview Dashboard (/costs)
Top row: total monthly spend with projection, month-over-month change percentage, unattributed cost percentage (with a warning color if above 10%), total identified savings from optimization recommendations.

Center: stacked area chart showing daily cost over the last 90 days, stacked by team. This makes cost growth visible and attributable.

Bottom left: team cost table with columns for team name, current month cost, previous month cost, change percentage, top service. Bottom right: active anomalies and top optimization recommendations.

### Team Cost Detail (/costs/teams/:teamId)
Service-level cost breakdown as a treemap or horizontal bar chart. Each service shows total cost, cost trend, and utilization efficiency score (a derived metric: if a service is well-utilized, its "efficiency" is high even if its cost is high). This prevents the reflexive "biggest cost = biggest problem" interpretation — a heavily-used production service should cost more.

Below: daily cost trend per service as a multi-line chart. Anomalies are marked as dots on the trendline. Clicking an anomaly shows the detail panel with hypotheses and correlated deployments.

### Optimization Hub (/costs/optimizations)
A Kanban-style board with columns: New, Investigating, Accepted, Implemented. Each card shows the recommendation type, service, estimated saving, and confidence level. Cards can be dragged between columns. When moved to "Implemented," a date is recorded and the system starts tracking actual vs estimated savings.

A summary bar at the top shows: total identified savings, total accepted savings, total implemented savings, and the actual savings realized (comparing post-implementation costs to the pre-recommendation baseline).

## Quick Win — Deliverable In Under 1 Week

A Lambda function that runs daily, queries AWS Cost Explorer for the previous day's cost grouped by the `wep:service-id` tag, and posts a daily cost summary to a `#aws-costs` Slack channel. The summary includes: total daily spend, top 5 most expensive services, any services with cost spikes (>50% above their 7-day average), and the unattributed cost total with a call to action to tag resources.

This gives immediate value: daily cost visibility in Slack, with just enough detail to catch problems. The unattributed cost callout creates organic pressure for tagging without requiring enforcement tooling.
