import type { Result, DomainError, PaginatedRequest, PaginatedResponse } from '@wep/domain-types';
import type { Operation } from '../entities/operation.js';
import type { ServiceRequest, RequestStatus } from '../entities/service-request.js';
import type { ApprovalRule } from '../entities/approval-rule.js';
import type { JitResource } from '../entities/jit-resource.js';
import type { JitSession } from '../entities/jit-session.js';
import type { WepUserProfile } from '../entities/user-profile.js';

export interface PortalRepository {
  getOperation(operationId: string): Promise<Result<Operation | null, DomainError>>;
  listOperations(): Promise<Result<Operation[], DomainError>>;
  saveOperation(operation: Operation): Promise<Result<void, DomainError>>;
  deleteOperation(operationId: string): Promise<Result<void, DomainError>>;

  saveRequest(request: ServiceRequest): Promise<Result<void, DomainError>>;
  getRequest(requestId: string): Promise<Result<ServiceRequest | null, DomainError>>;
  listRequests(filters: { requesterId?: string; teamId?: string; status?: RequestStatus }, pagination: PaginatedRequest): Promise<Result<PaginatedResponse<ServiceRequest>, DomainError>>;
  getPendingApprovals(approverId: string): Promise<Result<ServiceRequest[], DomainError>>;

  listAllRequests(pagination: PaginatedRequest): Promise<Result<PaginatedResponse<ServiceRequest>, DomainError>>;

  getApprovalRules(tier: string, scopeId?: string): Promise<Result<ApprovalRule[], DomainError>>;
  saveApprovalRule(rule: ApprovalRule): Promise<Result<void, DomainError>>;

  // ── JIT Resources ─────────────────────────────────────────────────────────────
  listJitResources(): Promise<Result<JitResource[], DomainError>>;
  getJitResource(resourceId: string): Promise<Result<JitResource | null, DomainError>>;
  saveJitResource(resource: JitResource): Promise<Result<void, DomainError>>;
  deleteJitResource(resourceId: string): Promise<Result<void, DomainError>>;

  // ── JIT Sessions ──────────────────────────────────────────────────────────────
  saveJitSession(session: JitSession): Promise<Result<void, DomainError>>;
  getJitSession(sessionId: string): Promise<Result<JitSession | null, DomainError>>;
  listJitSessionsByRequester(requesterId: string): Promise<Result<JitSession[], DomainError>>;
  /** Returns all active sessions whose expiresAt <= now — used by the revocation loop */
  listExpiredActiveSessions(): Promise<Result<JitSession[], DomainError>>;

  // ── User Profiles ─────────────────────────────────────────────────────────────
  getUserProfile(email: string): Promise<Result<WepUserProfile | null, DomainError>>;
  saveUserProfile(profile: WepUserProfile): Promise<Result<void, DomainError>>;
}
