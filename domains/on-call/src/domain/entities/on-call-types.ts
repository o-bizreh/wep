export type IncidentSeverity = 'P1' | 'P2' | 'P3' | 'P4';
export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved';

export interface OnCallRotation {
  teamId: string;
  teamName: string;
  weekStart: string;       // ISO date YYYY-MM-DD (Monday)
  primary: string;         // username
  secondary: string | null;
  updatedAt: string;
}

export interface IncidentTimelineEvent {
  timestamp: string;
  actor: string;
  message: string;
  status?: IncidentStatus;
}

export interface Incident {
  incidentId: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  linkedServiceId: string | null;
  linkedServiceName: string | null;
  linkedRunbookId: string | null;
  assignedTeamId: string | null;
  assignedTeamName: string | null;
  commanderId: string | null;     // username of incident commander
  startedAt: string;
  resolvedAt: string | null;
  timeline: IncidentTimelineEvent[];
  postmortemDraft: string | null;
  affectedEnvironments: string[];
  customerImpact: boolean;
}
