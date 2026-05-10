# Architecture Decision Records

## ADR-001: Single Platform Over Separate Tools

### Decision
Build all engineering tools as bounded contexts within a single monorepo platform rather than as independent tools.

### Context
The 12 tool categories identified in the engineering platform initiative share significant overlap in data sources (GitHub, AWS, monitoring tools), authentication requirements (IAM Identity Center), notification channels (Slack), and the foundational concept of "service" as an entity. Building them separately would mean duplicating infrastructure, diverging data models, maintaining separate deployment pipelines, and forcing engineers to context-switch between multiple UIs.

### Consequences
- Positive: Shared infrastructure reduces operational overhead. Shared data model ensures consistency. Single frontend shell reduces cognitive load. One deployment pipeline to maintain.
- Negative: Monorepo complexity increases over time. A bug in shared packages can affect all contexts. Teams working on different contexts must coordinate on shared package changes.
- Mitigation: Strict bounded context boundaries. Shared packages are versioned independently. Each context has its own DynamoDB table and Lambda functions — a failure in one context does not cascade to others at the infrastructure level.

## ADR-002: DynamoDB Single-Table Design Per Context

### Decision
Use one DynamoDB table per bounded context with single-table design, rather than one table per entity or one table for the entire platform.

### Context
A single platform-wide table would create a scaling bottleneck and make it impossible to manage capacity independently per context. One table per entity would require transactions across tables for operations involving multiple entities within the same context, which DynamoDB handles poorly.

### Consequences
- Positive: Each context scales independently. Access patterns are optimized per context. No cross-context table dependencies.
- Negative: Single-table design requires careful key schema planning upfront. Query patterns must be known before table creation.
- Mitigation: The DATA_MODEL.md document defines all access patterns. New access patterns require a design review before implementation to ensure they fit the existing key schema or justify a new GSI.

## ADR-003: EventBridge Over Direct API Calls For Inter-Context Communication

### Decision
Bounded contexts communicate exclusively through EventBridge events, never through direct API calls.

### Context
Direct API calls between contexts would create tight coupling, synchronous dependencies, and cascading failure risk. If the Deployment Tracker calls the Service Catalog's API to look up service ownership, a Service Catalog outage breaks deployment tracking.

### Consequences
- Positive: Contexts are fully decoupled at runtime. A context can be down without affecting others. New consumers can subscribe to existing events without modifying publishers.
- Negative: Eventual consistency — a context may operate on stale data between event propagation. Debugging event chains requires correlation IDs and centralized logging.
- Mitigation: Each context maintains its own projection of data it needs from other contexts, updated via events. Correlation IDs are propagated across all related events. CloudWatch Logs Insights queries are pre-built for tracing event chains.

## ADR-004: Fastify Over Express For The API Layer

### Decision
Use Fastify as the HTTP framework for the platform API.

### Context
The team has extensive Express experience through Sails.js. However, this platform is not a Sails.js application — it is a structured API with well-defined schemas, strict validation, and performance requirements. Fastify's native schema validation (via Ajv), plugin system, and superior performance characteristics make it the better fit for this specific use case.

### Consequences
- Positive: Built-in request/response validation eliminates a class of bugs. Plugin system maps cleanly to bounded contexts. Significantly faster than Express for the structured API pattern this platform uses.
- Negative: Learning curve for developers accustomed to Express/Sails middleware patterns.
- Mitigation: The API layer is thin — it delegates immediately to application-layer use cases. Developers spend most of their time in domain and application code, not framework code. Fastify's plugin pattern is documented with examples in the API application's README.

## ADR-005: No Individual Developer Metrics — Architectural Enforcement

### Decision
The Velocity Metrics context enforces at the domain layer that no metric can be calculated, stored, or returned at granularity finer than team level.

### Context
DORA metrics exist to identify systemic bottlenecks and improve team processes. When used to evaluate individual developers, they become counterproductive — engineers optimize for the metric instead of for outcomes (e.g., splitting PRs artificially to boost deployment frequency). The research behind DORA explicitly warns against individual-level use.

### Consequences
- Positive: Engineering trust in the platform is preserved. Metrics drive process improvement rather than performance anxiety.
- Negative: It is technically impossible to answer "how productive is developer X" — this is intentional.
- Mitigation: If leadership requests individual metrics in the future, this ADR serves as the documented rationale for refusing. The architectural enforcement (validation at the application layer) means this cannot be circumvented by a database query — the data simply does not exist at that granularity.

## ADR-006: GitHub Webhooks Plus Scheduled Polling As Dual Data Ingestion

### Decision
Use GitHub webhooks for real-time events (deployments, PR activity) and scheduled Lambda polling for bulk data reconciliation (repository list, team membership, workflow runs).

### Context
Webhooks alone are unreliable — they can be missed during outages, rate-limited, or dropped. Polling alone is too slow for real-time deployment tracking. The combination provides both responsiveness and reliability.

### Consequences
- Positive: Real-time visibility for time-sensitive events. Self-healing through periodic reconciliation that catches anything webhooks missed.
- Negative: Potential for duplicate processing when both webhook and polling capture the same event.
- Mitigation: Every event processor is idempotent. Deduplication is handled by checking if the event's natural key (e.g., deployment SHA + environment) already exists before processing. DynamoDB conditional writes enforce this at the storage layer.

## ADR-007: Result Pattern Over Thrown Exceptions

### Decision
All domain operations return a Result type (Success or Failure) instead of throwing exceptions.

### Context
Thrown exceptions are invisible in TypeScript's type system — a function signature does not tell you what errors it can produce. This leads to unhandled error paths and defensive try-catch blocks that swallow errors. The Result pattern makes errors explicit in the type system, forcing callers to handle them.

### Consequences
- Positive: Every error path is visible in the code. TypeScript's exhaustive switch checking ensures all error types are handled. No surprising runtime exceptions from domain logic.
- Negative: More verbose than throw/catch for simple cases. Developers must learn the pattern.
- Mitigation: A shared Result type with utility methods (map, flatMap, unwrapOr) keeps the syntax manageable. Infrastructure adapters (DynamoDB, GitHub API) catch their own exceptions at the adapter boundary and translate them into Result failures — domain code never sees raw exceptions.
