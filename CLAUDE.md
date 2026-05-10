# Washmen Engineering Platform (WEP)

## Identity

This is a unified internal engineering platform for Washmen's product engineering organization. It is NOT a collection of separate tools — it is a single platform with distinct domain modules that share infrastructure, data models, and a common frontend shell.

The platform exists to answer operational questions instantly: who owns what, what's deployed where, how fast are we shipping, what's broken, and what does it cost. Every feature must drive a decision or action — no vanity dashboards.

## Architecture Philosophy

This platform follows Domain-Driven Design at the macro level and SOLID principles at the code level. Every architectural decision must pass this test: "Does this reduce cognitive load for Washmen engineers, or does it add it?"

### Non-Negotiable Principles

- SOLID: Every class, module, and function has a single reason to change. Depend on abstractions. Open for extension, closed for modification.
- KISS: If a junior engineer cannot understand a module's purpose in 60 seconds by reading its entry point, it is too complex. Refactor.
- DRY: Shared logic lives in shared packages. Domain logic lives in domain modules. The boundary between "shared" and "domain" is explicit and documented.
- Clean Code: No abbreviations in public APIs. No magic strings. No implicit dependencies. Every function name describes what it does, not how it does it.
- Atomic Design: Frontend components follow atoms → molecules → organisms → templates → pages. No component should know about the domain it serves — that's the page's job.
- Domain-Driven Design: Each tool category is a bounded context. Bounded contexts communicate through well-defined interfaces, never by reaching into each other's internals. The Service Catalog is the shared kernel — other contexts depend on its published interfaces.

### Technology Decisions

- **Runtime:** Node.js 20+ with TypeScript 5+ in strict mode. No `any` types. No type assertions unless documented with a justification comment.
- **Backend Framework:** Fastify for the API layer. It aligns with the team's Node.js expertise and outperforms Express for the structured API patterns this platform needs.
- **Frontend Framework:** Next.js 14+ with App Router. React Server Components where data fetching is needed. Client components only when interactivity requires it.
- **Infrastructure:** AWS-native. Lambda for event processors and background jobs. DynamoDB for operational data. EventBridge for event routing. S3 for static assets and data exports. CloudFront for the frontend.
- **Authentication:** IAM Identity Center via SAML/OIDC. No separate user database. No API keys for human users. Service-to-service auth uses IAM roles.
- **Messaging:** EventBridge as the backbone. SNS for fan-out to Slack. SQS for durable processing queues. No direct Lambda-to-Lambda invocations.
- **IaC:** CloudFormation with SAM for Lambda-heavy modules. Consistent tagging: `Platform:WEP`, `Module:<bounded-context>`, `Environment:<env>`, `CostCenter:DevOps`.
- **Monorepo:** Turborepo for build orchestration. pnpm workspaces for package management.

## Project Structure

```
washmen-engineering-platform/
├── CLAUDE.md                          ← You are here
├── docs/
│   ├── architecture/
│   │   ├── BOUNDED_CONTEXTS.md        ← Domain boundaries and interfaces
│   │   ├── DATA_MODEL.md             ← Shared and per-context data models
│   │   ├── EVENT_CATALOG.md          ← All events flowing through EventBridge
│   │   └── DECISIONS.md              ← Architecture Decision Records
│   └── domains/
│       ├── SERVICE_CATALOG.md         ← Phase 1: Service registry instructions
│       ├── DEPLOYMENT_TRACKER.md      ← Phase 1: Deployment dashboard instructions
│       ├── VELOCITY_METRICS.md        ← Phase 1: DORA metrics instructions
│       ├── PIPELINE_ANALYTICS.md      ← Phase 2: CI/CD analytics instructions
│       ├── COST_INTELLIGENCE.md       ← Phase 2: Cost attribution instructions
│       └── SELF_SERVICE.md            ← Phase 2: Developer portal instructions
├── packages/
│   ├── shared/
│   │   ├── domain-types/              ← Shared TypeScript types and interfaces
│   │   ├── aws-clients/               ← Configured AWS SDK clients
│   │   ├── github-client/             ← GitHub API wrapper
│   │   ├── event-bus/                 ← EventBridge publisher/subscriber abstractions
│   │   ├── slack-notifier/            ← Slack messaging with Block Kit formatting
│   │   └── auth/                      ← IAM Identity Center integration
│   └── ui/
│       ├── atoms/                     ← Buttons, badges, text, icons
│       ├── molecules/                 ← Search bars, stat cards, status indicators
│       ├── organisms/                 ← Data tables, filter panels, alert cards
│       └── templates/                 ← Page layouts, dashboard shells, detail views
├── domains/
│   ├── service-catalog/               ← Bounded Context: Service Registry
│   │   ├── CONTEXT.md                 ← Context-specific Claude instructions
│   │   ├── src/
│   │   │   ├── domain/                ← Entities, value objects, domain events
│   │   │   ├── application/           ← Use cases, command/query handlers
│   │   │   ├── infrastructure/        ← DynamoDB repos, GitHub crawlers, AWS scanners
│   │   │   └── interfaces/            ← API routes, event handlers
│   │   └── tests/
│   ├── deployment-tracker/            ← Bounded Context: Deployments
│   │   ├── CONTEXT.md
│   │   └── src/ (same internal structure)
│   ├── velocity-metrics/              ← Bounded Context: DORA Metrics
│   │   ├── CONTEXT.md
│   │   └── src/
│   ├── pipeline-analytics/            ← Bounded Context: CI/CD Analytics
│   │   ├── CONTEXT.md
│   │   └── src/
│   ├── cost-intelligence/             ← Bounded Context: Cost Attribution
│   │   ├── CONTEXT.md
│   │   └── src/
│   └── self-service/                  ← Bounded Context: Developer Portal
│       ├── CONTEXT.md
│       └── src/
├── apps/
│   ├── web/                           ← Next.js frontend application
│   │   ├── app/                       ← App Router pages
│   │   │   ├── (dashboard)/           ← Dashboard layout group
│   │   │   │   ├── catalog/           ← Service catalog pages
│   │   │   │   ├── deployments/       ← Deployment tracker pages
│   │   │   │   ├── velocity/          ← DORA metrics pages
│   │   │   │   ├── pipelines/         ← CI/CD analytics pages
│   │   │   │   ├── costs/             ← Cost intelligence pages
│   │   │   │   └── portal/            ← Self-service pages
│   │   │   └── api/                   ← API routes (BFF pattern)
│   │   └── components/                ← Page-specific component compositions
│   └── api/                           ← Fastify API application
│       ├── src/
│       │   ├── server.ts              ← Fastify instance, plugin registration
│       │   ├── plugins/               ← Auth, CORS, rate limiting, error handling
│       │   └── routes/                ← Route registrations delegating to domain handlers
│       └── tests/
└── infrastructure/
    ├── shared/                        ← VPC, DynamoDB tables, EventBridge bus
    ├── domains/                       ← Per-context Lambda functions, IAM roles
    └── apps/                          ← CloudFront, ALB, ECS for web/api
```

## Shared Data Patterns

### The Service Entity Is The Shared Kernel

The concept of a "Service" is the connective tissue of this platform. Every bounded context references services but defines its own view of what it needs from a service.

The Service Catalog owns the canonical Service entity. Other contexts consume a published ServiceReference that contains only: serviceId, serviceName, ownerTeamId, repositoryUrl, and runtimeType. No context should depend on the full Service entity — only on ServiceReference.

### Event-Driven Communication

Bounded contexts do not call each other's APIs directly. They communicate through domain events on EventBridge.

When the Service Catalog registers a new service, it publishes `service-catalog.service.registered`. When the Deployment Tracker records a deployment, it publishes `deployment-tracker.deployment.completed`. The Velocity Metrics context subscribes to deployment events to calculate DORA metrics. The Cost Intelligence context subscribes to service registration events to set up cost tagging.

Every event follows the schema: `{ source: string, detailType: string, detail: { entityId: string, entityType: string, timestamp: string, data: context-specific } }`.

### DynamoDB Table Strategy

One DynamoDB table per bounded context, using single-table design within each context. The shared table naming convention is `wep-<context>-<environment>`. Each table uses a composite key pattern with `PK` and `SK` string attributes, plus a `GSI1PK`/`GSI1SK` for access pattern flexibility.

Never share tables across contexts. If two contexts need the same data, one publishes events and the other maintains its own projection.

## Testing Philosophy

- Unit tests for domain logic. No mocking of domain objects. If you need to mock a domain object, the design is wrong.
- Integration tests for infrastructure adapters (DynamoDB, GitHub API, AWS SDK). Use localstack for AWS services.
- Contract tests for inter-context communication. If Context A publishes an event, Context A owns a test that validates the event schema. Context B owns a test that validates it can consume that schema.
- No end-to-end tests in CI. They are slow, flaky, and provide diminishing returns when unit and integration coverage is strong.

## Error Handling Philosophy

- Domain errors are explicit types, not thrown exceptions. Use a Result pattern: every operation returns `Success<T>` or `Failure<E>` where E is a typed error enum.
- Infrastructure errors are caught at the adapter boundary and translated into domain failures.
- API errors follow RFC 7807 Problem Details format. Every error response includes a `type` URI, `title`, `status`, `detail`, and `instance`.
- Never swallow errors. Never log and continue. If an operation fails, the caller decides what to do — not the callee.

## Performance Boundaries

- API responses under 200ms at P95 for read operations.
- Background sync jobs (GitHub crawl, AWS scan) run on 15-minute EventBridge schedules. They must complete within Lambda's 15-minute timeout with room to spare.
- Frontend pages must achieve Lighthouse Performance score above 90. Use React Server Components aggressively to minimize client-side JavaScript.
- DynamoDB operations use consistent reads only when staleness would cause incorrect decisions. Eventually consistent reads are the default.

## Security Boundaries

- No secrets in environment variables for Lambda. Use Secrets Manager with caching.
- GitHub tokens are organization-level with minimum required scopes. They rotate automatically via Secrets Manager rotation.
- Every API endpoint validates input using Zod schemas. No request body reaches domain logic without validation.
- CORS is restricted to the platform's CloudFront domain. No wildcard origins.

## What Not To Build

- Do not build a custom authentication system. IAM Identity Center handles this.
- Do not build a notification system from scratch. Use the existing Slack alert aggregation infrastructure Omar has already built. Extend it with new message types.
- Do not build a custom CI/CD system. GitHub Actions is the CI/CD platform. This platform observes and analyzes — it does not orchestrate deployments.
- Do not build a custom monitoring system. Sentry, NewRelic, and CloudWatch are the monitoring systems. This platform aggregates their data — it does not replace them.
- Do not build a custom secrets management solution. AWS Secrets Manager and Parameter Store handle this. The self-service portal provides a UI for requesting access — it does not store secrets.
