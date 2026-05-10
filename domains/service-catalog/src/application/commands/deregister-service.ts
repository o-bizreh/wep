import { randomUUID } from 'node:crypto';
import {
  type Result,
  success,
  failure,
  domainError,
  CatalogErrorCode,
  EventSource,
  type DomainError,
} from '@wep/domain-types';
import { deregisterService } from '../../domain/entities/service.js';
import type { ServiceRepository } from '../../domain/ports/service-repository.js';
import type { EventPublisher } from '@wep/event-bus';

export class DeregisterServiceHandler {
  constructor(
    private readonly serviceRepo: ServiceRepository,
    private readonly eventPublisher: EventPublisher,
  ) {}

  async execute(
    serviceId: string,
    reason: 'manual' | 'repository-archived' | 'resource-deleted',
  ): Promise<Result<void, DomainError<CatalogErrorCode>>> {
    const serviceResult = await this.serviceRepo.findById(serviceId);
    if (!serviceResult.ok) return serviceResult;
    if (!serviceResult.value) {
      return failure(domainError(CatalogErrorCode.SERVICE_NOT_FOUND, `Service ${serviceId} not found`));
    }

    const deregistered = deregisterService(serviceResult.value);
    const saveResult = await this.serviceRepo.save(deregistered);
    if (!saveResult.ok) return saveResult;

    await this.eventPublisher.publish(EventSource.SERVICE_CATALOG, 'service.deregistered', {
      eventId: randomUUID(),
      entityId: serviceId,
      entityType: 'service',
      timestamp: new Date().toISOString(),
      version: 1,
      data: { serviceId, reason },
    });

    return success(undefined);
  }
}
