# Automated Schema Registry & Breaking Change Detection (Research)

## Overview
An automated schema registry acts as a central hub for API contracts (REST, GraphQL, gRPC) and prevents regressions by automatically blocking Pull Requests that introduce breaking changes (e.g., removing a required payload field or changing a response structure) to downstream consumers.

## The Ideal CI/CD Workflow
1. **Schema Generation**: Applications auto-generate their API schema (OpenAPI/Swagger) at build time from code.
2. **Registry Push (Merge to Main)**: On a successful merge to `main`, the CI pipeline parses the code, generates the `swagger.json`, and pushes it to the Engineering Platform's Schema Registry API.
3. **Diff Validation (Pull Request)**: When a developer opens a new PR, a CI check runs which generates the *proposed* schema and sends it to the Engineering Platform for comparison. If a breaking change is detected against the live schema, the PR is automatically blocked.

## Current Constraints & The SailsJS Challenge
Currently, the backend architecture relies heavily on **SailsJS**, which is largely convention-over-configuration and heavily tied to dynamic Blueprint APIs. 

**Challenges:**
- SailsJS does not natively force strong typing or generate OpenAPI/Swagger documentation out-of-the-box in the same way frameworks like NestJS, FastAPI, or Go (with Swaggo) do.
- Because schemas are not strongly typed or explicitly declared at compile-time, running a static AST diff during CI/CD becomes extremely difficult.

## Potential Future Workarounds for SailsJS
If we revisit this in the future, we have a few options to bridge the gap:
1. **Third-Party Hooks**: Explore community packages like `sails-hook-swagger` or `sails-hook-openapi` which attempt to automatically map Sails models and routes into swagger documentation, although they require manual annotation for custom controller actions.
2. **Opt-In Schema Driven Development**: Gradually introduce a workflow where teams maintain an `api.yaml` manually for their critical endpoints. The breaking-change checks would only run against these manually maintained files.
3. **Consumer-Driven Contract Testing (Pact)**: Instead of the *producer* generating a massive Swagger spec, downstream *consumers* write tests declaring exactly what fields they expect from the producer (Pact testing). If the producer changes the API and breaks those tests in CI, the PR fails.

## Conclusion
Until the backend architecture shifts towards frameworks with native schema generation (or we adopt heavy manual API annotations in Sails), implementing an automated Schema Registry will carry heavy operational overhead. We will revisit this when the backend API documentation strategy matures.
