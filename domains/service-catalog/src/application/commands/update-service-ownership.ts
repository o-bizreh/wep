import { randomUUID } from 'node:crypto';
import {
  type Result,
  failure,
  domainError,
  CatalogErrorCode,
  EventSource,
  type DomainError,
  type TeamReference,
} from '@wep/domain-types';
import { type Service, updateServiceOwnership } from '../../domain/entities/service.js';
import type { ServiceRepository } from '../../domain/ports/service-repository.js';
import type { TeamRepository } from '../../domain/ports/team-repository.js';
import type { EventPublisher } from '@wep/event-bus';

export class UpdateServiceOwnershipHandler {
  constructor(
    private readonly serviceRepo: ServiceRepository,
    private readonly teamRepo: TeamRepository,
    private readonly eventPublisher: EventPublisher,
  ) {}

  async execute(
    serviceId: string,
    newOwnerTeamId: string,
  ): Promise<Result<Service, DomainError<CatalogErrorCode>>> {
    const serviceResult = await this.serviceRepo.findById(serviceId);
    if (!serviceResult.ok) return serviceResult;
    if (!serviceResult.value) {
      return failure(domainError(CatalogErrorCode.SERVICE_NOT_FOUND, `Service ${serviceId} not found`));
    }

    const teamResult = await this.teamRepo.findById(newOwnerTeamId);
    if (!teamResult.ok) return teamResult;
    if (!teamResult.value) {
      return failure(domainError(CatalogErrorCode.TEAM_NOT_FOUND, `Team ${newOwnerTeamId} not found`));
    }

    const team = teamResult.value;
    const newOwnerRef: TeamReference = {
      teamId: team.teamId,
      teamName: team.teamName,
      domain: team.domain,
      memberCount: team.members.length,
      slackChannelId: team.slackChannelId,
    };

    const updateResult = updateServiceOwnership(serviceResult.value, newOwnerRef);
    if (!updateResult.ok) return updateResult;

    const saveResult = await this.serviceRepo.save(updateResult.value);
    if (!saveResult.ok) return saveResult;

    const now = new Date().toISOString();
    await this.eventPublisher.publish(EventSource.SERVICE_CATALOG, 'service.updated', {
      eventId: randomUUID(),
      entityId: serviceId,
      entityType: 'service',
      timestamp: now,
      version: 1,
      data: {
        service: {
          serviceId: updateResult.value.serviceId,
          serviceName: updateResult.value.serviceName,
          repositoryUrl: updateResult.value.repositoryUrl,
          ownerTeamId: newOwnerRef.teamId,
          ownerTeamName: newOwnerRef.teamName,
          runtimeType: updateResult.value.runtimeType,
          environment: updateResult.value.environments[0] ?? 'development',
        },
        changedFields: ['ownerTeamId'],
        previousValues: { ownerTeamId: serviceResult.value.ownerTeam.teamId },
      },
    });

    return updateResult;
  }
}
