import { randomUUID } from 'node:crypto';
import {
  type Result,
  success,
  failure,
  domainError,
  CatalogErrorCode,
  EventSource,
  type DomainError,
  type ServiceRegisteredPayload,
  type DomainEvent,
} from '@wep/domain-types';
import { type Service, type CreateServiceInput, createService, generateServiceId } from '../../domain/entities/service.js';
import type { ServiceRepository } from '../../domain/ports/service-repository.js';
import type { EventPublisher } from '@wep/event-bus';

export interface RegisterServiceCommand {
  serviceName: string;
  repositoryUrl: string;
  runtimeType: CreateServiceInput['runtimeType'];
  ownerTeam: CreateServiceInput['ownerTeam'];
  environments?: CreateServiceInput['environments'];
  awsResources?: CreateServiceInput['awsResources'];
  discoveryMethod: 'automated' | 'manual';
  metadata?: Record<string, string>;
}

export class RegisterServiceHandler {
  constructor(
    private readonly serviceRepo: ServiceRepository,
    private readonly eventPublisher: EventPublisher,
  ) {}

  async execute(
    command: RegisterServiceCommand,
  ): Promise<Result<Service, DomainError<CatalogErrorCode>>> {
    const serviceId = generateServiceId(command.repositoryUrl, command.runtimeType);

    const existingResult = await this.serviceRepo.findById(serviceId);
    if (!existingResult.ok) return existingResult;

    if (existingResult.value) {
      const updated: Service = {
        ...existingResult.value,
        serviceName: command.serviceName,
        ownerTeam: command.ownerTeam,
        environments: command.environments ?? existingResult.value.environments,
        awsResources: command.awsResources ?? existingResult.value.awsResources,
        metadata: { ...existingResult.value.metadata, ...command.metadata },
        lastSyncedAt: new Date().toISOString(),
      };

      const saveResult = await this.serviceRepo.save(updated);
      if (!saveResult.ok) return saveResult;

      await this.eventPublisher.publish<import('@wep/domain-types').ServiceUpdatedPayload>(
        EventSource.SERVICE_CATALOG,
        'service.updated',
        {
          eventId: randomUUID(),
          entityId: updated.serviceId,
          entityType: 'service',
          timestamp: new Date().toISOString(),
          version: 1,
          data: {
            service: {
              serviceId: updated.serviceId,
              serviceName: updated.serviceName,
              repositoryUrl: updated.repositoryUrl,
              ownerTeamId: updated.ownerTeam.teamId,
              ownerTeamName: updated.ownerTeam.teamName,
              runtimeType: updated.runtimeType,
              environment: updated.environments[0] ?? 'development',
            },
            changedFields: ['serviceName', 'ownerTeam', 'environments', 'metadata'],
            previousValues: {},
          },
        },
      );

      return success(updated);
    }

    const createResult = createService(command);
    if (!createResult.ok) return createResult;

    const service = createResult.value;
    const saveResult = await this.serviceRepo.save(service);
    if (!saveResult.ok) return saveResult;

    const event: DomainEvent<ServiceRegisteredPayload> = {
      eventId: randomUUID(),
      entityId: service.serviceId,
      entityType: 'service',
      timestamp: new Date().toISOString(),
      version: 1,
      data: {
        service: {
          serviceId: service.serviceId,
          serviceName: service.serviceName,
          repositoryUrl: service.repositoryUrl,
          ownerTeamId: service.ownerTeam.teamId,
          ownerTeamName: service.ownerTeam.teamName,
          runtimeType: service.runtimeType,
          environment: service.environments[0] ?? 'development',
        },
        discoveryMethod: service.discoveryMethod,
        initialHealthStatus: service.healthStatus.status,
      },
    };

    await this.eventPublisher.publish(EventSource.SERVICE_CATALOG, 'service.registered', event);

    return success(service);
  }
}
