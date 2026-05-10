# Velocity Metrics — Bounded Context Instructions

## Purpose

This context measures engineering delivery performance using the four DORA metrics. It exists to identify systemic bottlenecks, celebrate improvements, and give leadership objective data for investment decisions. It does NOT exist to evaluate individual developers. This constraint is architectural, not just policy — the data model physically cannot store individual-level metrics.

## Domain Model

### Entities

**MetricSnapshot** — a point-in-time calculation of all four DORA metrics for a team or the organization. Snapshots are computed on a schedule (daily for internal calculations, weekly for published reports).

MetricSnapshot attributes: snapshotId, entityId (teamId or "org:washmen"), entityType (team or organization), period (day, week, month), periodIdentifier (YYYY-MM-DD, YYYY-WW, YYYY-MM), deploymentFrequency, leadTimeForChanges, meanTimeToRecovery, changeFailureRate, sampleSize (number of data points contributing to this snapshot — small samples get a confidence warning), calculatedAt.

**MetricAnomaly** — a detected deviation from the rolling average for a specific metric and team. Anomalies are informational — they trigger a notification to the team lead, not an alarm.

MetricAnomaly attributes: anomalyId, teamId, metricName, currentValue, rollingAverage (8-week), standardDeviation, deviationMultiple, direction (improved or degraded), detectedAt, acknowledged (boolean, set by team lead via Slack action).

### Value Objects

**DORAClassification** — the performance level for each metric based on the published DORA benchmarks (2023 State of DevOps Report values).

Deployment Frequency: Elite = on-demand/multiple per day, High = weekly to monthly, Medium = monthly to every 6 months, Low = less than every 6 months.
Lead Time for Changes: Elite = less than 1 hour, High = 1 day to 1 week, Medium = 1 week to 1 month, Low = more than 1 month.
Mean Time to Recovery: Elite = less than 1 hour, High = less than 1 day, Medium = 1 day to 1 week, Low = more than 1 week.
Change Failure Rate: Elite = 0-5%, High = 5-10%, Medium = 10-15%, Low = more than 15%.

These thresholds are configurable in DynamoDB, not hard-coded, because DORA benchmarks are updated annually and the organization may want to set its own targets.

**MetricTrend** — a derived view showing the direction and rate of change for a metric over a specified window. Calculated from a sequence of snapshots: improving (metric moving toward a better DORA classification), stable (within 10% of rolling average), or declining (moving away).

## Metric Calculation Logic

### Deployment Frequency
Definition: Number of production deployments per team per day, averaged over the snapshot period.
Data source: `deployment-tracker.deployment.completed` events where environment = production and status = success.
Calculation: Count successful production deployments for all services owned by the team in the period. Divide by the number of calendar days in the period.
Edge case: If a team has zero production deployments in a period, the frequency is 0, classified as "Low." Do not exclude these periods — they are meaningful data.

### Lead Time for Changes
Definition: Time from first commit in a change set to production deployment, averaged over the snapshot period.
Data source: GitHub Pull Request events (merged at timestamp) cross-referenced with `deployment-tracker.deployment.completed` events.
Calculation: For each production deployment, identify the PRs included (from DeploymentDelta data). For each PR, calculate the time from the first commit pushed to the PR branch until the deployment that included the PR completed. Average across all PRs in the period.
Edge case: Direct commits to main without a PR are measured from commit timestamp to deployment timestamp. Hotfixes that bypass the normal PR flow should still be captured — they often have the shortest lead times.
Complexity: This is the hardest metric to calculate accurately. The PR-to-deployment mapping depends on the Deployment Tracker's DeploymentDelta data (SHA range comparison). If DeploymentDelta is unavailable for a deployment, exclude that deployment from the lead time calculation and note the sample size reduction.

### Mean Time to Recovery (MTTR)
Definition: Time from when a production incident starts to when it is resolved, averaged over the snapshot period.
Data source: Sentry issue resolution events and NewRelic incident close events.
Calculation: For each production incident (Sentry issue with level "error" or "fatal" that affects a production environment, or NewRelic incident with priority "critical" or "high"), measure the time from first occurrence to resolution. Average across all incidents in the period.
Deduplication: Sentry and NewRelic may both report the same incident. Use a correlation window of 15 minutes — if a Sentry issue and a NewRelic incident affect the same service within 15 minutes, treat them as one incident. Take the earlier start time and the later resolution time.
Edge case: If a team has zero incidents in a period, MTTR is undefined, not zero. Display as "No incidents" with a note that this is the ideal state but the metric cannot be calculated without data.

### Change Failure Rate
Definition: Percentage of production deployments that result in a service incident, degradation, or rollback within a configurable window (default: 1 hour post-deployment).
Data source: `deployment-tracker.deployment.completed` events cross-referenced with `deployment-tracker.deployment.rolled-back` events, Sentry issues, and NewRelic incidents.
Calculation: For each production deployment, check if any of the following occurred within the correlation window: a rollback event for the same service, a new Sentry issue (not a recurring one) for the same service, a NewRelic incident for the same service. If any did, the deployment is a "failure." Change failure rate = failing deployments / total deployments * 100.
Edge case: A deployment that is immediately rolled back and redeployed with a fix counts as one failure, not two. The rollback and the fix deployment are correlated by the SHA chain.

## Privacy Enforcement Layer

Every query that returns metric data passes through a privacy enforcement layer before reaching the API response. This layer enforces two rules:

1. Minimum aggregation: If the query would return data for a group smaller than 3 members, the query is rejected with a specific error: "Metric granularity too fine — minimum team size for standalone metrics is 3 members." The error includes a suggestion to view the parent domain's metrics instead.

2. No individual attribution: The domain model does not store which developer authored which commit or PR in the context of metrics. The Deployment Tracker may store actor information for audit purposes, but the Velocity Metrics context strips individual identity during ingestion. When consuming deployment events, it records only the serviceId and teamId, never the actor.

This is enforced at the application layer (use case handlers), not at the API layer. Even if someone bypasses the API and queries DynamoDB directly, the data does not exist at individual granularity.

## Application Layer (Use Cases)

### CalculateTeamSnapshot
Input: teamId, period (day, week, month), periodIdentifier.
Process: Query all relevant events for the team's services within the period. Calculate all four DORA metrics. Determine DORA classification for each. Store the snapshot.
Schedule: Daily snapshots are calculated at 02:00 UTC. Weekly snapshots on Monday at 03:00 UTC. Monthly snapshots on the 1st at 04:00 UTC. Stagger by team to avoid DynamoDB hot partitions.
Side effects: If this is a weekly snapshot, compare against the previous 8 weekly snapshots for anomaly detection. If any metric deviates by more than 2 standard deviations, create a MetricAnomaly and publish `velocity-metrics.anomaly.detected`.

### CalculateOrgSnapshot
Input: period, periodIdentifier.
Process: Aggregate all team snapshots for the period. Org-wide metrics are weighted averages: each team's metric is weighted by their deployment count (for deployment frequency and change failure rate) or their PR count (for lead time) or their incident count (for MTTR). This prevents a team with 1 deployment from skewing the org average.
Dependency: Requires all team snapshots for the period to be calculated first.

### GetTeamMetrics
Input: teamId, period (optional, default: current week), includeHistory (boolean, default: true).
Output: Current snapshot plus historical snapshots for trend visualization. Each metric includes the raw value, DORA classification, and trend direction.
Privacy check: Verify team has 3+ members. If not, return the parent domain's metrics with a note explaining the rollup.

### GetOrgDashboard
Input: period (optional, default: current week).
Output: Organization-wide snapshot plus per-domain breakdown plus per-team breakdown (for teams meeting the minimum size threshold). Includes trend sparklines for each metric over the last 12 weeks.

### DetectAnomalies
Input: teamId, latestSnapshot.
Process: Compare each metric against the team's 8-week rolling average. If the deviation exceeds 2 standard deviations in either direction, create an anomaly record. Improvements are anomalies too — they are worth celebrating and understanding.
Side effects: Publishes `velocity-metrics.anomaly.detected`. The anomaly event triggers a Slack DM to the team lead (not a public channel post) with the metric name, current value, average, and direction. The DM includes a "Got it" button that acknowledges the anomaly.

## API Surface

All endpoints are prefixed with `/api/v1/velocity/`.

- `GET /org` — organization-wide DORA metrics with domain breakdown
- `GET /teams/:teamId` — team DORA metrics with history
- `GET /teams/:teamId/trends` — trend data for sparkline rendering
- `GET /teams` — all teams' current metrics (respects privacy enforcement)
- `GET /anomalies` — recent anomalies across all teams
- `POST /anomalies/:anomalyId/acknowledge` — team lead acknowledges anomaly

## Frontend Pages

### Organization Velocity Dashboard (/velocity)
Four large metric cards at the top showing org-wide DORA metrics with DORA classification badges (elite/high/medium/low with appropriate colors). Below: a grid of team cards, each showing the team's four metrics as small sparklines with their current classification. Teams are grouped by domain.

The design must feel like a health dashboard, not a leaderboard. No sorting by "best" team. No highlighting of "worst" performers. The grouping by domain reinforces that these are systemic metrics, not competitive rankings.

### Team Velocity Detail (/velocity/teams/:teamId)
Deep dive into a single team's metrics. Each metric gets a dedicated section with: current value and classification, 12-week trend chart, breakdown of contributing data (e.g., for deployment frequency: list of deployments per week; for lead time: distribution histogram of PR-to-deploy times). Each section includes contextual guidance: "Teams in the 'high' classification typically..." to help teams self-assess.

Anomaly history: a timeline of detected anomalies with acknowledgment status. Each anomaly links to the period's data for investigation.

### Weekly Digest (Slack, not web)
Every Monday at 09:00 local time, a Slack message is posted to the engineering channel with the organization-wide metrics for the previous week, notable improvements, and any unacknowledged anomalies. The message uses Block Kit for formatting and includes a link to the full dashboard.

The tone of the digest is celebratory for improvements, matter-of-fact for neutral trends, and constructive for degradations. It never singles out a team negatively. If a team's metrics degraded, the digest mentions it as "Team X experienced increased change failure rate — the team lead has been notified" without implying blame.

## Quick Win — Deliverable In Under 1 Week

A Lambda function that runs on a weekly schedule, queries the GitHub API for merged PRs and the Deployment Tracker DynamoDB table for production deployments (or GitHub Actions workflow runs if the Deployment Tracker is not yet built). It calculates deployment frequency and lead time for changes per repository (not per team — team mapping requires the Service Catalog). Results are posted to a `#engineering-velocity` Slack channel as a formatted Block Kit message.

This gives immediate value: a weekly pulse on shipping speed, delivered where engineers already look (Slack), with zero dashboard overhead.
