import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, ScanCommand, DeleteCommand } from '@wep/aws-clients';
import type { OnCallRotation, Incident } from '../../domain/entities/on-call-types.js';
import { randomUUID } from 'crypto';

export class OnCallRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  // ── Rotations ──────────────────────────────────────────────────────────────

  async saveRotation(rotation: OnCallRotation): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        PK: `ROTATION#${rotation.teamId}`,
        SK: `WEEK#${rotation.weekStart}`,
        GSI1PK: 'ROTATION',
        GSI1SK: `${rotation.weekStart}#${rotation.teamId}`,
        ...rotation,
      },
    }));
  }

  async getRotation(teamId: string, weekStart: string): Promise<OnCallRotation | null> {
    const result = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: { PK: `ROTATION#${teamId}`, SK: `WEEK#${weekStart}` },
    }));
    return (result.Item as OnCallRotation) ?? null;
  }

  async getTeamRotations(teamId: string): Promise<OnCallRotation[]> {
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `ROTATION#${teamId}`, ':prefix': 'WEEK#' },
      ScanIndexForward: false,
      Limit: 12,
    }));
    return (result.Items ?? []) as OnCallRotation[];
  }

  async getAllCurrentRotations(): Promise<OnCallRotation[]> {
    const weekStart = getMondayISO();
    const result = await this.client.send(new ScanCommand({
      TableName: this.tableName,
      FilterExpression: 'SK = :sk',
      ExpressionAttributeValues: { ':sk': `WEEK#${weekStart}` },
    }));
    return (result.Items ?? []) as OnCallRotation[];
  }

  async deleteRotation(teamId: string, weekStart: string): Promise<void> {
    await this.client.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { PK: `ROTATION#${teamId}`, SK: `WEEK#${weekStart}` },
    }));
  }

  // ── Incidents ──────────────────────────────────────────────────────────────

  async saveIncident(incident: Incident): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        PK: `INCIDENT#${incident.incidentId}`,
        SK: 'METADATA',
        GSI1PK: `SEVERITY#${incident.severity}`,
        GSI1SK: `STATUS#${incident.status}#${incident.startedAt}`,
        ...incident,
      },
    }));
  }

  async createIncident(data: Omit<Incident, 'incidentId' | 'startedAt' | 'resolvedAt' | 'timeline' | 'postmortemDraft'>): Promise<Incident> {
    const incident: Incident = {
      ...data,
      incidentId: randomUUID(),
      startedAt: new Date().toISOString(),
      resolvedAt: null,
      timeline: [{ timestamp: new Date().toISOString(), actor: data.commanderId ?? 'system', message: 'Incident opened', status: 'investigating' }],
      postmortemDraft: null,
    };
    await this.saveIncident(incident);
    return incident;
  }

  async getIncident(incidentId: string): Promise<Incident | null> {
    const result = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: { PK: `INCIDENT#${incidentId}`, SK: 'METADATA' },
    }));
    return (result.Item as Incident) ?? null;
  }

  async listIncidents(status?: string): Promise<Incident[]> {
    const items: Incident[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const result = await this.client.send(new ScanCommand({
        TableName: this.tableName,
        FilterExpression: status
          ? 'begins_with(PK, :prefix) AND #st = :status'
          : 'begins_with(PK, :prefix)',
        ExpressionAttributeNames: status ? { '#st': 'status' } : undefined,
        ExpressionAttributeValues: status
          ? { ':prefix': 'INCIDENT#', ':status': status }
          : { ':prefix': 'INCIDENT#' },
        ExclusiveStartKey: lastKey,
      }));
      items.push(...(result.Items ?? []) as Incident[]);
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    return items.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }

  async addTimelineEvent(incidentId: string, event: { actor: string; message: string; status?: import('../../domain/entities/on-call-types.js').IncidentStatus }): Promise<Incident | null> {
    const incident = await this.getIncident(incidentId);
    if (!incident) return null;
    const newEvent = { timestamp: new Date().toISOString(), ...event };
    const updated: Incident = {
      ...incident,
      status: event.status ?? incident.status,
      resolvedAt: event.status === 'resolved' ? new Date().toISOString() : incident.resolvedAt,
      timeline: [...incident.timeline, newEvent],
    };
    await this.saveIncident(updated);
    return updated;
  }

  async updateIncident(incidentId: string, updates: Partial<Pick<Incident, 'title' | 'severity' | 'linkedServiceId' | 'linkedServiceName' | 'linkedRunbookId' | 'assignedTeamId' | 'assignedTeamName' | 'commanderId' | 'postmortemDraft' | 'affectedEnvironments' | 'customerImpact'>>): Promise<Incident | null> {
    const incident = await this.getIncident(incidentId);
    if (!incident) return null;
    const updated = { ...incident, ...updates };
    await this.saveIncident(updated);
    return updated;
  }
}

export function getMondayISO(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}
