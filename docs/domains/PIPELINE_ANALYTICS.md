# Pipeline Analytics — Bounded Context Instructions

## Purpose

This context answers: "Which pipelines are slowest?", "What's our GitHub Actions spend?", "What are the most common failure reasons?", and "Where should we invest in pipeline optimization?" It transforms raw GitHub Actions data into actionable insights about CI/CD health and cost.

## Domain Model

### Entities

**PipelineRun** — a single execution of a GitHub Actions workflow. This is the atomic unit of analysis.

PipelineRun attributes: runId (GitHub's workflow run ID), workflowId, workflowName, repositoryUrl, serviceId (mapped via Service Catalog), branch, triggerEvent (push, pull_request, schedule, workflow_dispatch), status (success, failure, cancelled, skipped), startedAt, completedAt, durationSeconds, queueTimeSeconds (time from trigger to first job start), billableMinutes, costEstimate (billableMinutes * per-minute rate for the runner type), jobs (list of job summaries: name, status, duration, runner type), failureCategory (null if success).

**FailureClassification** — a categorized reason for a pipeline failure. Assigned automatically by pattern matching against job logs.

Categories: test-failure (test assertion or test suite error), build-error (compilation, transpilation, or bundling failure), dependency-error (npm install, package resolution failure), infrastructure-error (runner timeout, disk space, network failure), lint-error (ESLint, Prettier, or type checking failure), docker-error (Docker build, push, or pull failure), deployment-error (deployment step failure), unknown (no pattern matched — flagged for manual categorization to improve pattern library).

**PipelineCostSummary** — aggregated cost data for a team or the organization over a billing period.

PipelineCostSummary attributes: entityId (teamId or "org:washmen"), entityType, billingPeriod (YYYY-MM), totalBillableMinutes, totalCostEstimate, breakdownByWorkflow (map of workflowId to cost), breakdownByRunnerType (map of runner label to cost), topCostWorkflows (sorted list of the 5 most expensive workflows).

### Value Objects

**FailurePattern** — a regex pattern with metadata used to classify failures. Stored in DynamoDB for easy updates without code deployment.

FailurePattern attributes: patternId, category (maps to FailureClassification category), regex (the pattern to match against job log output), priority (higher priority patterns are checked first — prevents overly broad patterns from swallowing specific ones), exampleMatch (a sanitized example of what this pattern matches, for documentation).

Default patterns to seed:
- test-failure: `(FAIL|✗|✘)\s+.*test`, `Expected.*to (equal|be|match|contain)`, `AssertionError`, `jest.*failed`
- build-error: `error TS\d+`, `Module not found`, `SyntaxError`, `Build failed`
- dependency-error: `npm ERR!`, `ERESOLVE`, `Could not resolve dependency`, `ETARGET`, `node-gyp`
- infrastructure-error: `The runner has received a shutdown signal`, `Job exceeded maximum execution time`, `No space left on device`, `ETIMEDOUT`
- lint-error: `eslint.*error`, `prettier.*--check`, `Type error:`
- docker-error: `docker build.*failed`, `manifest unknown`, `COPY failed`, `permission denied.*docker`
- deployment-error: `deployment.*failed`, `rollback triggered`, `health check.*unhealthy`

**RunnerCostRate** — the per-minute cost for each GitHub Actions runner type. GitHub's pricing as of the platform build date, stored in configuration for updates.

Linux runners: standard (2-core) = $0.008/min, large (4-core) = $0.016/min, xlarge = $0.032/min, 2xlarge = $0.064/min.
macOS runners: $0.08/min (3-core or 12-core varies — use GitHub billing API for actuals when available).

These are reference rates. The actual cost calculation should prefer GitHub's billing API data when available and fall back to these rates only when billing data is delayed.

## Infrastructure Adapters

### GitHub Actions Poller

A scheduled Lambda running every 15 minutes that queries the GitHub Actions API for recent workflow runs.

Process:
1. For each repository in the Service Catalog, list workflow runs completed since the last poll (using the `created` filter parameter). Store the last poll timestamp in DynamoDB to avoid reprocessing.
2. For each completed run, fetch job details to get per-job duration, status, and runner type.
3. For failed runs, fetch the job logs (download URL from the jobs API). The logs are large — stream them and apply failure patterns without loading the entire log into memory. Stop scanning after the first match.
4. Calculate cost estimate from billable minutes and runner type.
5. Write PipelineRun records to DynamoDB.

Rate limiting: The GitHub API allows 5000 requests per hour. With many repositories, this budget can be consumed quickly. Prioritize: (1) fetch run list for all repos (cheap — one call per repo), (2) fetch job details for failed runs (needed for classification), (3) fetch job details for successful runs (nice to have for duration analysis), (4) fetch logs for failed runs (expensive — one call per job).

If approaching the rate limit, defer log fetching to the next poll cycle. Set a flag on the PipelineRun record indicating "failure-unclassified" and process it next cycle.

### GitHub Billing Adapter

A daily Lambda that queries GitHub's billing API for Actions usage data. This provides the actual billed minutes and cost, which may differ from the estimated cost (due to free tier minutes, included minutes in the plan, and macOS multipliers).

The billing API returns organization-level data. The adapter distributes costs to teams by matching workflow runs to repositories to services to teams via the Service Catalog mapping.

## Application Layer (Use Cases)

### IngestWorkflowRun
Input: Raw GitHub Actions workflow run data.
Process: Map the repository to a serviceId via Service Catalog. Enrich with job details. Classify failure if applicable. Calculate cost estimate. Store as PipelineRun.
Idempotency: Keyed on runId. If a run already exists, update it (runs can transition from in-progress to completed between polls).

### ClassifyFailure
Input: PipelineRun with status = failure, job logs.
Process: Iterate through FailurePatterns sorted by priority. Apply each regex to the log output. First match wins. If no pattern matches, classify as "unknown" and increment a counter. When the "unknown" counter for a specific workflow exceeds a threshold (10 in a week), emit an alert suggesting a new pattern be added.
Output: Updated PipelineRun with failureCategory.

### GetPipelineHealth
Input: filters (teamId, serviceId, workflowId, dateRange), aggregation (daily, weekly, monthly).
Output: Success rate, average duration, average queue time, failure category breakdown, cost over the specified period and aggregation. Includes comparison to the previous equivalent period (e.g., this week vs last week).

### GetFailureAnalysis
Input: filters (teamId, serviceId, dateRange).
Output: Failure category distribution (pie chart data), top failing workflows (ranked by failure count), trending failures (categories increasing in frequency), and for each top failure: the most recent example run with a direct link to the GitHub Actions log.

### GetCostBreakdown
Input: teamId (optional — org-wide if omitted), billingPeriod.
Output: Total cost, cost by workflow, cost by runner type, cost trend over the last 6 months, top 5 most expensive workflows with optimization suggestions (e.g., "This workflow runs on xlarge but averages 60% CPU — consider large runners").

### IdentifyOptimizations
Input: none (runs on weekly schedule).
Process: Analyze all PipelineRuns from the past 30 days. Identify:
- Workflows with average duration > 15 minutes (candidates for parallelization or caching)
- Workflows with average queue time > 5 minutes (may benefit from self-hosted runners)
- Workflows using large/xlarge runners but with low CPU utilization (right-sizing opportunity)
- Workflows with > 20% failure rate (reliability investment needed)
- Duplicate workflows across repositories that could be consolidated into reusable workflows
Output: List of optimization recommendations with estimated time and cost savings.

## API Surface

All endpoints are prefixed with `/api/v1/pipelines/`.

- `GET /health` — overall pipeline health metrics with filters
- `GET /failures` — failure analysis with category breakdown
- `GET /failures/patterns` — list of failure classification patterns (for DevOps to manage)
- `POST /failures/patterns` — add a new failure pattern
- `GET /costs` — cost breakdown with team and workflow drilldown
- `GET /costs/trends` — cost trend data for chart rendering
- `GET /workflows/:workflowId` — detailed stats for a specific workflow
- `GET /optimizations` — current optimization recommendations
- `GET /runs` — paginated list of pipeline runs with filters

## Frontend Pages

### Pipeline Health Dashboard (/pipelines)
Top row: four KPI cards — overall success rate, average duration, average queue time, month-to-date cost. Each card shows a trend arrow (up/down) compared to previous period.

Middle: failure category breakdown as a donut chart on the left, top failing workflows as a ranked list on the right. Each workflow in the list shows: name, repository, failure count, dominant failure category, and a direct link to the most recent failure in GitHub.

Bottom: duration trend line chart showing average pipeline duration over the last 30 days, with an overlay of the 7-day moving average to smooth noise.

### Cost Analytics Page (/pipelines/costs)
A treemap visualization where the area of each block represents cost. First level: teams. Second level: workflows within each team. Clicking a block drills down. Color intensity represents cost trend (darker = increasing). A sidebar shows the top 5 optimization recommendations with estimated savings.

Monthly cost trend as a stacked bar chart, with each bar segmented by team. This makes it immediately visible which team is driving cost growth.

### Optimization Recommendations Page (/pipelines/optimizations)
A card-based layout where each card is an actionable recommendation. Card contents: the problem ("Workflow X takes 22 minutes on average"), the recommendation ("Add dependency caching — estimated to save 8 minutes per run"), the estimated impact ("Save ~$45/month and 6 hours of developer wait time"), and a link to the relevant workflow file in GitHub for the engineer to act on.

Cards are sorted by estimated impact (highest first). Each card has a "Dismiss" button (with a reason selector: "Already addressed", "Not applicable", "Will address later") so the list stays actionable over time.

## Quick Win — Deliverable In Under 1 Week

A Lambda function that queries the GitHub Actions API for all workflow runs in the past 30 days across all repositories, aggregates success rate, average duration, and total billable minutes per repository, and posts a weekly summary to Slack. The summary includes: total spend, top 3 slowest workflows, top 3 most-failing workflows, and a note on total developer-hours spent waiting on CI. No dashboard, no failure classification — just the numbers that make the problem visible.
