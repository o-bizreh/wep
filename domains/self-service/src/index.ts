export { createPortalRouter, type PortalRouteHandlers } from './interfaces/api/routes.js';
export { SubmitRequestHandler } from './application/commands/submit-request.js';
export { ApproveRequestHandler, RejectRequestHandler } from './application/commands/approve-request.js';
export { GetOperationCatalogHandler } from './application/queries/get-operations.js';
export { GetRequestHistoryHandler, GetPendingApprovalsHandler } from './application/queries/get-requests.js';
export { DynamoDBPortalRepository } from './infrastructure/dynamodb/portal-repository.js';
export type { Operation } from './domain/entities/operation.js';
export type { ServiceRequest } from './domain/entities/service-request.js';
export type { ApprovalRule } from './domain/entities/approval-rule.js';
export type { JitResource } from './domain/entities/jit-resource.js';
export type { JitSession, JitSessionStatus } from './domain/entities/jit-session.js';
export { GrantJitAccessHandler } from './application/commands/grant-jit-access.js';
export { GrantAwsConsoleAccessHandler } from './application/commands/grant-aws-console-access.js';
export { RevokeJitSessionHandler } from './application/commands/revoke-jit-session.js';
export { DeleteExpiredJitRolesHandler } from './application/commands/delete-expired-jit-roles.js';

// Act-overhaul services
export { CredentialDispatcher, type IssuedCredentials } from './application/services/credential-dispatcher.js';
export { AwsActionCredentialIssuer, type AwsActionCredentials } from './application/services/aws-action-credential-issuer.js';
export { PostgresCredentialIssuer, type DbCredentials } from './application/services/postgres-credential-issuer.js';
export { RedshiftCredentialIssuer } from './application/services/redshift-credential-issuer.js';
export { AutoApprovalEvaluator, type AutoApprovalDecision } from './application/services/auto-approval-evaluator.js';
export { RequesterContextService, type RequesterContext, type RequesterContextResolver } from './application/services/requester-context-service.js';
export { ResourceTagResolver } from './application/services/resource-tag-resolver.js';
export type { WepUserProfile } from './domain/entities/user-profile.js';
export type { AutoApprovalRule, AutoApprovalConfig } from './domain/value-objects/auto-approval-rule.js';
export type { OperationKind, AwsActionConfig, DbCredentialsConfig } from './domain/entities/operation.js';
export type { RequestApprovalMode, RequestAuditEvent, RequestAuditEventType } from './domain/entities/service-request.js';
