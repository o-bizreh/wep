import { randomUUID } from 'node:crypto';
import { type Result, success, EventSource, type DomainError } from '@wep/domain-types';
import type { ServiceCostRecord } from '../../domain/entities/service-cost-record.js';
import { determineSeverity, type CostAnomaly } from '../../domain/entities/cost-anomaly.js';
import type { CostRepository } from '../../domain/ports/cost-repository.js';
import type { EventPublisher } from '@wep/event-bus';

export class IngestDailyCostHandler {
  constructor(
    private readonly costRepo: CostRepository,
    private readonly eventPublisher: EventPublisher,
  ) {}

  async execute(records: ServiceCostRecord[]): Promise<Result<void, DomainError>> {
    for (const record of records) {
      const saveResult = await this.costRepo.saveDailyCost(record);
      if (!saveResult.ok) return saveResult;

      await this.checkForAnomaly(record);
    }
    return success(undefined);
  }

  private async checkForAnomaly(record: ServiceCostRecord): Promise<void> {
    const endDate = record.date;
    const startDate = new Date(new Date(endDate).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const historyResult = await this.costRepo.getDailyCostRange(record.serviceId, startDate, endDate);
    if (!historyResult.ok || historyResult.value.length < 7) return;

    const costs = historyResult.value.map((r) => r.totalCost);
    const avg = costs.reduce((s, c) => s + c, 0) / costs.length;

    if (avg === 0) return;

    const deviation = ((record.totalCost - avg) / avg) * 100;
    if (Math.abs(deviation) < 20) return;

    const anomaly: CostAnomaly = {
      anomalyId: randomUUID(),
      serviceId: record.serviceId,
      date: record.date,
      expectedCost: Math.round(avg * 100) / 100,
      actualCost: record.totalCost,
      deviationPercentage: Math.round(deviation * 10) / 10,
      severity: determineSeverity(Math.abs(deviation)),
      possibleCauses: deviation > 0 ? ['Increased usage or new resources'] : ['Reduced usage or resource cleanup'],
      correlatedDeployments: [],
      status: 'detected',
      resolvedBy: null,
      resolution: null,
    };

    await this.costRepo.saveAnomaly(anomaly);

    await this.eventPublisher.publish('wep.cost-intelligence', 'anomaly.detected', {
      eventId: randomUUID(),
      entityId: record.serviceId,
      entityType: 'service',
      timestamp: new Date().toISOString(),
      version: 1,
      data: {
        serviceId: record.serviceId,
        date: record.date,
        actualCost: record.totalCost,
        expectedCost: avg,
        deviationPercentage: deviation,
        possibleCauses: anomaly.possibleCauses,
      },
    });
  }
}
