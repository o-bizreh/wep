import type { Result, DomainError, PaginatedRequest, PaginatedResponse } from '@wep/domain-types';
import type { ServiceRequest, RequestStatus } from '../../domain/entities/service-request.js';
import type { PortalRepository } from '../../domain/ports/portal-repository.js';

export class GetRequestHistoryHandler {
  constructor(private readonly portalRepo: PortalRepository) {}

  async execute(
    filters: { requesterId?: string; teamId?: string; status?: RequestStatus },
    pagination: PaginatedRequest,
  ): Promise<Result<PaginatedResponse<ServiceRequest>, DomainError>> {
    return this.portalRepo.listRequests(filters, pagination);
  }
}

export class GetPendingApprovalsHandler {
  constructor(private readonly portalRepo: PortalRepository) {}

  async execute(approverId: string): Promise<Result<ServiceRequest[], DomainError>> {
    return this.portalRepo.getPendingApprovals(approverId);
  }
}
