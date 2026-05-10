import {
  type Result,
  failure,
  domainError,
  CatalogErrorCode,
  type DomainError,
} from '@wep/domain-types';
import type { Service } from '../../domain/entities/service.js';
import type { ServiceRepository } from '../../domain/ports/service-repository.js';

export class GetServiceHandler {
  constructor(private readonly serviceRepo: ServiceRepository) {}

  async execute(serviceId: string): Promise<Result<Service, DomainError<CatalogErrorCode>>> {
    const result = await this.serviceRepo.findById(serviceId);
    if (!result.ok) return result;
    if (!result.value) {
      return failure(domainError(CatalogErrorCode.SERVICE_NOT_FOUND, `Service ${serviceId} not found`));
    }
    return { ok: true, value: result.value };
  }
}
