import { Router } from 'express';
import type { OnCallRepository } from '../../infrastructure/dynamodb/on-call-repository.js';
import { getMondayISO } from '../../infrastructure/dynamodb/on-call-repository.js';
import type { IncidentSeverity, IncidentStatus } from '../../domain/entities/on-call-types.js';

export function createOnCallRouter(repo: OnCallRepository): Router {
  const router = Router();

  // ── Who's on call now ──────────────────────────────────────────────────────
  router.get('/who', async (_req, res) => {
    const rotations = await repo.getAllCurrentRotations();
    res.json({ week: getMondayISO(), oncall: rotations });
  });

  // ── Rotations ──────────────────────────────────────────────────────────────
  router.get('/schedules/:teamId', async (req, res) => {
    const { teamId } = req.params as { teamId: string };
    const rotations = await repo.getTeamRotations(teamId);
    res.json(rotations);
  });

  router.put('/schedules/:teamId/weeks/:weekStart', async (req, res) => {
    const { teamId, weekStart } = req.params as { teamId: string; weekStart: string };
    const { teamName, primary, secondary } = req.body as { teamName: string; primary: string; secondary?: string };
    if (!primary) { res.status(400).json({ error: 'primary required' }); return; }
    const rotation = {
      teamId, teamName: teamName ?? teamId, weekStart,
      primary, secondary: secondary ?? null,
      updatedAt: new Date().toISOString(),
    };
    await repo.saveRotation(rotation);
    res.json(rotation);
  });

  router.delete('/schedules/:teamId/weeks/:weekStart', async (req, res) => {
    const { teamId, weekStart } = req.params as { teamId: string; weekStart: string };
    await repo.deleteRotation(teamId, weekStart);
    res.status(204).end();
  });

  // ── Incidents ──────────────────────────────────────────────────────────────
  router.get('/incidents', async (req, res) => {
    const { status } = req.query as { status?: string };
    const incidents = await repo.listIncidents(status);
    res.json(incidents);
  });

  router.post('/incidents', async (req, res) => {
    const { title, severity, linkedServiceId, linkedServiceName, linkedRunbookId,
            assignedTeamId, assignedTeamName, commanderId, affectedEnvironments, customerImpact } = req.body as {
      title: string; severity: IncidentSeverity;
      linkedServiceId?: string; linkedServiceName?: string; linkedRunbookId?: string;
      assignedTeamId?: string; assignedTeamName?: string; commanderId?: string;
      affectedEnvironments?: string[]; customerImpact?: boolean;
    };
    if (!title || !severity) { res.status(400).json({ error: 'title and severity required' }); return; }
    const incident = await repo.createIncident({
      title, severity, status: 'investigating',
      linkedServiceId: linkedServiceId ?? null,
      linkedServiceName: linkedServiceName ?? null,
      linkedRunbookId: linkedRunbookId ?? null,
      assignedTeamId: assignedTeamId ?? null,
      assignedTeamName: assignedTeamName ?? null,
      commanderId: commanderId ?? null,
      affectedEnvironments: affectedEnvironments ?? [],
      customerImpact: customerImpact ?? false,
    });
    res.status(201).json(incident);
  });

  router.get('/incidents/:id', async (req, res) => {
    const incident = await repo.getIncident(req.params['id'] as string);
    if (!incident) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(incident);
  });

  router.patch('/incidents/:id', async (req, res) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated = await repo.updateIncident(req.params['id'] as string, req.body as any);
    if (!updated) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(updated);
  });

  router.post('/incidents/:id/timeline', async (req, res) => {
    const { actor, message, status } = req.body as { actor: string; message: string; status?: IncidentStatus };
    if (!message) { res.status(400).json({ error: 'message required' }); return; }
    const updated = await repo.addTimelineEvent(req.params['id'] as string, { actor: actor ?? 'unknown', message, status });
    if (!updated) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(updated);
  });

  return router;
}
