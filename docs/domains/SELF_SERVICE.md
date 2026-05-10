# Self-Service Portal — Bounded Context Instructions

## Purpose

This context reduces DevOps team toil by enabling developers to self-serve common operations. Every request that currently requires a Jira ticket to the DevOps team and a round-trip of 1-3 days should instead be available on-demand (for low-risk operations) or within hours (for operations requiring approval). The measure of success is simple: how many hours per week does the DevOps team spend on tasks that developers could have done themselves?

## Domain Model

### Entities

**Operation** — a template for a self-service action. Operations are configured, not coded — adding a new operation should not require a code deployment.

Operation attributes: operationId, name, description, category (access, infrastructure, development, configuration), tier (self-serve, peer-approved, devops-approved), parameters (list of parameter definitions: name, type, validation rules, description, options for select types), executor (which automation runs when the operation is approved: lambda-arn, github-workflow, or manual-with-instructions), requiredPermissions (who can submit this request: any-engineer, team-member-of-service-owner, domain-lead, devops), estimatedDuration (how long the operation takes to execute), isEnabled (boolean, for gradual rollout).

**ServiceRequest** — an instance of an engineer requesting an operation.

ServiceRequest attributes: requestId, operationType (references Operation), requesterId, requesterName, requesterTeamId, serviceId (optional — some operations are service-scoped, others are not), parameters (the filled-in parameter values), tier, status (submitted, pending-approval, approved, executing, completed, failed, rejected, cancelled), submittedAt, approvedAt, approvedBy, executedAt, completedAt, failedAt, failureReason, executionLog (audit trail of what the automation did), metadata (extensible for operation-specific data).

**ApprovalRule** — defines who can approve requests of a given tier for a given scope.

ApprovalRule attributes: ruleId, tier, scope (global, domain, team, service), scopeId (the specific domain, team, or service this rule applies to), approverRole (team-lead, domain-lead, devops-engineer), approverIds (explicit list if needed, e.g., only Omar and Ali for devops-approved), autoApproveConditions (optional — conditions under which the request is auto-approved, e.g., during business hours, for non-production environments).

### Value Objects

**ParameterDefinition** — a typed parameter that the requester must fill in when submitting a request.

Supported types: string (with optional regex validation), select (from a predefined list or a dynamic list from an API call), boolean, serviceSelector (dropdown populated from Service Catalog), environmentSelector, teamSelector.

Every parameter has: name, label (display name), type, required (boolean), defaultValue (optional), helpText (explains what this parameter does and what value to provide), validationRules (type-specific constraints).

**ExecutionResult** — the outcome of executing an approved operation.

Fields: status (success or failure), outputs (map of output name to value, e.g., "repositoryUrl" → "https://github.com/washmen/new-service"), logs (timestamped entries of what the automation did), duration, rollbackAvailable (boolean — can this operation be undone?).

## Operations Catalog — Initial Set

### Tier 1: Self-Serve (No Approval Required)

**View Service Logs**
Description: Grant temporary read access to CloudWatch log groups for a service the requester's team owns.
Parameters: serviceId (serviceSelector), environment (environmentSelector), duration (select: 1h, 4h, 8h, 24h).
Executor: Lambda that creates a temporary IAM policy granting CloudWatch Logs read access, attaches it to the requester's IAM Identity Center role, and schedules a cleanup Lambda to remove it after the duration expires.
Guard: Requester must be a member of the service's owner team. Production logs require peer-approved tier — override this operation's tier for production.

**Scaffold New Service**
Description: Create a new repository from a template with CI/CD pipeline, standard linting config (wm-codeguard), and boilerplate.
Parameters: serviceName (string, validated against naming conventions), template (select: lambda-typescript, ecs-api-typescript, react-app, react-native), ownerTeam (teamSelector), description (string).
Executor: Lambda that calls GitHub API to create repository from template, adds the team with admin access, configures branch protection rules, registers the service in the Service Catalog, and sets up the initial GitHub Actions workflow.
Guard: None — any engineer can scaffold a new service.

**Request Feature Flag Access**
Description: Grant access to create and manage feature flags for a service the requester's team owns.
Parameters: serviceId (serviceSelector), flagName (string), description (string).
Executor: Lambda that creates the flag in the feature flag system with the requester as the owner.
Guard: Requester must be a member of the service's owner team.

### Tier 2: Peer-Approved (Team Lead Approval)

**Request Database Read Access**
Description: Grant temporary read-only access to a service's database.
Parameters: serviceId (serviceSelector), environment (environmentSelector), duration (select: 1h, 4h, 8h, 24h), reason (string).
Executor: Lambda that creates a temporary database user with read-only permissions, provides connection details to the requester via a time-limited Secrets Manager secret, and schedules cleanup.
Guard: Requester must be a member of the service's owner team. Approval required from team lead.

**Update Secret Value**
Description: Update a secret in AWS Secrets Manager for a service the requester's team owns.
Parameters: serviceId (serviceSelector), environment (environmentSelector), secretName (select: dynamically populated from Secrets Manager secrets tagged with the service ID), newValue (string, masked in UI and logs).
Executor: Lambda that updates the secret value and triggers a rolling restart of the service if the service type supports it (ECS force new deployment, Lambda publish new version).
Guard: Approval required from team lead. Production secrets require devops-approved tier.

**Grant Cross-Team API Access**
Description: Request access for your service to call another team's API or consume their SQS queue.
Parameters: sourceServiceId (serviceSelector), targetServiceId (serviceSelector), accessType (select: api-read, api-write, queue-consume, queue-publish), reason (string).
Executor: Lambda that updates IAM policies and/or security groups to allow the cross-service communication. Registers the dependency in the Service Catalog.
Guard: Approval required from the target service's team lead (not the requester's).

### Tier 3: DevOps-Approved

**Provision New Environment**
Description: Create a new environment (staging, preview, etc.) for a service with all required AWS resources.
Parameters: serviceId (serviceSelector), environmentName (string), baseEnvironment (select: copy config from staging, production, or start fresh), resources (multi-select: ecs-service, lambda-functions, dynamodb-tables, sqs-queues, s3-buckets).
Executor: CloudFormation stack creation using the service's existing template with environment-specific parameter overrides.
Guard: DevOps approval required. This operation creates AWS resources with cost implications.

**Modify IAM Permissions**
Description: Request changes to IAM policies for a service or team.
Parameters: serviceId (serviceSelector), policyChange (string: description of what access is needed and why), environment (environmentSelector).
Executor: Manual — this generates a Jira ticket for the DevOps team with pre-filled details, rather than automating IAM policy changes directly. IAM changes are too sensitive for full automation without mature policy-as-code infrastructure.
Guard: DevOps approval required. Omar or Ali must review.

**Production Resource Scaling**
Description: Change the capacity of production resources (ECS desired count, Lambda concurrency, DynamoDB capacity).
Parameters: serviceId (serviceSelector), resourceArn (select: dynamically populated from the service's AWS resources in the catalog), currentConfiguration (pre-filled from live resource state), requestedConfiguration (string), reason (string).
Executor: Lambda that applies the configuration change via the appropriate AWS API, monitors for 15 minutes, and auto-reverts if health checks fail.
Guard: DevOps approval required. The auto-revert provides a safety net.

## Infrastructure Adapters

### IAM Identity Center Adapter
Connects to AWS IAM Identity Center (SSO) to resolve user identity from the authenticated session, determine group memberships (which map to teams), and manage temporary permission grants.

The adapter translates IAM Identity Center user IDs to platform user identities and caches the mapping. Group-to-team mapping is configured in DynamoDB (IAM Identity Center group name → platform teamId).

### GitHub Automation Adapter
Creates repositories from templates, configures teams and permissions, sets up branch protection rules, and triggers workflow dispatches. Uses a GitHub App installation token (not a personal access token) for elevated permissions.

The GitHub App must have the following permissions: Administration (read/write), Contents (read/write), Metadata (read), Members (read), Workflows (read/write).

### AWS Resource Provisioning Adapter
Executes approved operations that create, modify, or delete AWS resources. Each operation type has a dedicated execution function with its own scoped IAM role — the adapter never uses a single broad role.

IAM role strategy: One IAM role per operation type. The role grants only the specific permissions that operation needs. For example, the "View Service Logs" operation has a role that can only create and attach CloudWatch Logs read policies. The "Scaffold New Service" operation has a role that can only call GitHub API and register services in DynamoDB.

### Notification Adapter
Sends approval request notifications to approvers via Slack DM. Uses Block Kit with action buttons: "Approve" and "Reject" (with a reason modal on reject). Approval actions are routed back to the platform via Slack's interactive message API.

The approval Slack message includes: requester name, operation name, parameters (with sensitive values masked), service name, environment, and the estimated impact. This gives the approver enough context to decide without leaving Slack.

## Application Layer (Use Cases)

### SubmitRequest
Input: operationType, parameters, requesterId (from auth context).
Validation: Operation must exist and be enabled. Requester must satisfy the operation's requiredPermissions. All required parameters must be provided and pass validation rules. If the operation is service-scoped, the service must exist in the catalog.
Process: Create ServiceRequest with status "submitted." If tier is self-serve, immediately transition to "approved" and trigger execution. If tier requires approval, transition to "pending-approval" and notify the appropriate approver(s).
Side effects: Publishes `self-service.request.submitted`. If auto-approved, also publishes `self-service.request.approved` and triggers ExecuteRequest.

### ApproveRequest
Input: requestId, approverId (from auth context).
Validation: Request must be in "pending-approval" status. Approver must satisfy the ApprovalRule for this request's tier and scope.
Process: Update status to "approved." Trigger ExecuteRequest.
Side effects: Publishes `self-service.request.approved`. Notifies the requester via Slack DM.

### RejectRequest
Input: requestId, rejectedBy (from auth context), reason.
Validation: Request must be in "pending-approval" status.
Process: Update status to "rejected" with reason.
Side effects: Publishes `self-service.request.rejected`. Notifies the requester via Slack DM with the rejection reason.

### ExecuteRequest
Input: requestId.
Process: Load the Operation definition. Invoke the executor (Lambda, GitHub workflow, or generate manual instructions). Stream execution logs to the ServiceRequest's executionLog. On completion, update status to "completed" with outputs. On failure, update status to "failed" with failure reason and trigger a notification to the DevOps channel.
Timeout: Each operation has a maximum execution time (default: 5 minutes). If the executor does not complete within the timeout, mark the request as "failed" with reason "execution-timeout" and alert DevOps.
Side effects: Publishes `self-service.request.executed`.

### GetRequestHistory
Input: requesterId (or teamId for team leads, or no filter for DevOps), status filter, date range, pagination.
Output: Paginated list of ServiceRequests with current status. Team leads see their team's requests. DevOps sees all requests.

### GetOperationCatalog
Input: requesterId (to filter operations the user can access).
Output: List of available Operations grouped by category, with the user's permission level for each (can submit, can approve, no access). Tier 3 operations that the user cannot submit are still shown (grayed out) so they know the capability exists.

## API Surface

All endpoints are prefixed with `/api/v1/portal/`.

- `GET /operations` — available operations catalog
- `GET /operations/:operationId` — operation detail with parameter definitions
- `POST /requests` — submit a new request
- `GET /requests` — list requests with filters
- `GET /requests/:requestId` — request detail with execution log
- `POST /requests/:requestId/approve` — approve a pending request
- `POST /requests/:requestId/reject` — reject a pending request
- `POST /requests/:requestId/cancel` — cancel a submitted or pending request
- `GET /approvals/pending` — list pending approvals for the current user
- `POST /webhook/slack` — Slack interactive message callback for approve/reject buttons

## Frontend Pages

### Portal Home (/portal)
A clean grid of operation cards grouped by category (Access, Infrastructure, Development, Configuration). Each card shows the operation name, description, tier badge (self-serve in green, peer-approved in yellow, devops-approved in orange), and a "Request" button. Cards the user cannot access are grayed out with a tooltip explaining what permission is needed.

A "My Requests" section below shows the user's recent requests with status badges. Pending approvals (for team leads and DevOps) are highlighted separately.

### Request Form Page (/portal/request/:operationId)
A dynamic form generated from the operation's parameter definitions. Service selectors show a searchable dropdown populated from the Service Catalog. Environment selectors show only environments the selected service exists in. Sensitive fields (like secret values) use masked input. A preview section shows what will happen before the user submits.

After submission, the page transitions to a status view showing real-time execution progress (for self-serve operations) or a "Pending approval from [approver name]" message with an estimated response time.

### Approvals Page (/portal/approvals)
A list of pending approval requests for the current user (team leads and DevOps). Each item shows the requester, operation, parameters, and quick-action buttons (Approve, Reject). Clicking on a request expands the full detail view. Approvals are also available via Slack for convenience — the web page is for bulk review.

### Audit Log Page (/portal/audit)
A searchable, filterable log of all self-service actions. Columns: timestamp, requester, operation, service, environment, status, approver (if applicable), duration. Filterable by all columns. Exportable to CSV for compliance reviews.

## Quick Win — Deliverable In Under 1 Week

A Slack bot command (`/wep-access`) that accepts a service name and duration, validates the requester's team membership against the Service Catalog, and grants temporary CloudWatch Logs read access. No web UI, no approval workflow, no operation catalog — just the single most-requested self-service action (log access) delivered through the channel engineers already use.

This gives immediate value: engineers stop filing Jira tickets for log access. DevOps stops granting manual IAM permissions. The time savings are measurable from day one.
