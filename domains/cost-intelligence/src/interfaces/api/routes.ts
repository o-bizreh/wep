import { Router, type Request, type Response } from 'express';
import { problemDetails } from '@wep/domain-types';
import {
  credentialStore,
  CostExplorerClient,
  GetCostAndUsageCommand,
} from '@wep/aws-clients';
import type { GetCostDashboardHandler } from '../../application/queries/get-cost-dashboard.js';
import type { CostRepository } from '../../domain/ports/cost-repository.js';

export interface CostRouteHandlers {
  getCostDashboard: GetCostDashboardHandler;
  costRepo: CostRepository;
}

// In-process TTL cache for the /overview endpoint. Cost Explorer is hard-capped
// at ~1 req/sec; without this, 3 concurrent users trigger throttling. Billing
// data updates a few times daily so a 15-minute TTL is safe.
let overviewCache: { value: unknown; expiresAt: number; inflight?: Promise<unknown> } | null = null;
const OVERVIEW_TTL_MS = 15 * 60_000;

// Cost Explorer is only available in us-east-1 regardless of deployment region.
const CE_REGION = 'us-east-1';

function isoMonth(offsetMonths = 0): string {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetMonths, 1);
  return d.toISOString().slice(0, 7); // "YYYY-MM"
}

function monthStart(ym: string): string { return `${ym}-01`; }

function monthEnd(ym: string): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const end = new Date(y, m, 1); // first day of next month
  return end.toISOString().slice(0, 10);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createCostRouter(handlers: CostRouteHandlers): Router {
  const router = Router();

  // GET /costs/overview — live AWS Cost Explorer data, cached 15 min
  router.get('/overview', async (_req: Request, res: Response) => {
    const now = Date.now();
    if (overviewCache && overviewCache.expiresAt > now) {
      res.json(overviewCache.value);
      return;
    }
    if (overviewCache?.inflight) {
      try { res.json(await overviewCache.inflight); }
      catch (e) { res.status(502).json(problemDetails(502, 'Cost Explorer Error', e instanceof Error ? e.message : String(e))); }
      return;
    }

    const fetcher = (async () => {
      const credentials = credentialStore.getProvider();
      const ce = new CostExplorerClient({ region: CE_REGION, credentials });

      const now        = new Date();
      const thisMonth  = isoMonth(0);
      const lastMonth  = isoMonth(-1);
      const today      = todayStr();

      // Same-period comparison: April 1–15 vs March 1–15 (not full March).
      //
      // Edge case: on the 1st of the month, [thisMonth-01, today) collapses to
      // an empty range and Cost Explorer rejects it with
      // "Start date (and hour) should be before end date (and hour)".
      // We advance End by one day in that case so the range is valid; the
      // returned data will be empty, which is what we want for "today" anyway.
      const dayOfMonth      = now.getDate();
      const daysInLastMonth = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
      const lastMonthDay    = Math.min(dayOfMonth, daysInLastMonth);
      const pad             = (n: number) => String(n).padStart(2, '0');
      const addDay = (yyyyMmDd: string): string => {
        const d = new Date(yyyyMmDd + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + 1);
        return d.toISOString().slice(0, 10);
      };
      const thisStart = `${thisMonth}-01`;
      let thisEnd     = today; // exclusive — through yesterday
      if (thisEnd <= thisStart) thisEnd = addDay(thisStart);
      const lastStart = `${lastMonth}-01`;
      let lastEnd     = `${lastMonth}-${pad(lastMonthDay)}`; // same day-of-month, exclusive
      if (lastEnd <= lastStart) lastEnd = addDay(lastStart);

      // Fetch this month + last month in two separate calls (same-period ranges)
      const [thisByServiceRes, lastByServiceRes, dailyRes] = await Promise.allSettled([
        ce.send(new GetCostAndUsageCommand({
          TimePeriod: { Start: thisStart, End: thisEnd },
          Granularity: 'MONTHLY',
          GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
          Metrics: ['UnblendedCost'],
        })),
        ce.send(new GetCostAndUsageCommand({
          TimePeriod: { Start: lastStart, End: lastEnd },
          Granularity: 'MONTHLY',
          GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
          Metrics: ['UnblendedCost'],
        })),
        ce.send(new GetCostAndUsageCommand({
          TimePeriod: { Start: thisStart, End: thisEnd },
          Granularity: 'DAILY',
          Metrics: ['UnblendedCost'],
        })),
      ]);

      if (thisByServiceRes.status === 'rejected') {
        const reason = thisByServiceRes.reason;
        throw reason instanceof Error ? reason : new Error(String(reason));
      }

      function sumGroups(groups: Array<{ Metrics?: Record<string, { Amount?: string }> }> | undefined): number {
        return (groups ?? []).reduce((s, g) => s + parseFloat(g.Metrics?.['UnblendedCost']?.Amount ?? '0'), 0);
      }

      const thisPeriodGroups = thisByServiceRes.value.ResultsByTime?.[0]?.Groups ?? [];
      const lastPeriodGroups = lastByServiceRes.status === 'fulfilled'
        ? (lastByServiceRes.value.ResultsByTime?.[0]?.Groups ?? [])
        : [];

      const thisTotal = sumGroups(thisPeriodGroups);
      const lastTotal = sumGroups(lastPeriodGroups);
      const changePercent = lastTotal > 0 ? Math.round(((thisTotal - lastTotal) / lastTotal) * 1000) / 10 : 0;

      // Build per-service breakdown (this month vs last month, top 15)
      const lastByService: Record<string, number> = {};
      for (const g of lastPeriodGroups) {
        const svc = g.Keys?.[0] ?? 'Other';
        lastByService[svc] = parseFloat(g.Metrics?.['UnblendedCost']?.Amount ?? '0');
      }

      const byService = thisPeriodGroups
        .map((g) => {
          const svc = g.Keys?.[0] ?? 'Other';
          const cost = parseFloat(g.Metrics?.['UnblendedCost']?.Amount ?? '0');
          const prev = lastByService[svc] ?? 0;
          return {
            service: svc,
            cost: Math.round(cost * 100) / 100,
            lastMonthCost: Math.round(prev * 100) / 100,
            changePercent: prev > 0 ? Math.round(((cost - prev) / prev) * 1000) / 10 : 0,
          };
        })
        .filter((s) => s.cost > 0)
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 15);

      // Daily trend for this month
      const dailyTrend: Array<{ date: string; cost: number }> = [];
      if (dailyRes.status === 'fulfilled') {
        for (const p of dailyRes.value.ResultsByTime ?? []) {
          const date = p.TimePeriod?.Start ?? '';
          const cost = parseFloat(p.Total?.['UnblendedCost']?.Amount ?? '0');
          dailyTrend.push({ date, cost: Math.round(cost * 100) / 100 });
        }
      }

      const currency = thisPeriodGroups[0]?.Metrics?.['UnblendedCost']?.Unit ?? 'USD';

      return {
        noCredentials: false,
        currentMonth: {
          total: Math.round(thisTotal * 100) / 100,
          currency,
          period: thisMonth,
        },
        lastMonth: {
          total: Math.round(lastTotal * 100) / 100,
          period: lastMonth,
        },
        changePercent,
        byService,
        dailyTrend,
      };
    })().then(
      (value) => { overviewCache = { value, expiresAt: Date.now() + OVERVIEW_TTL_MS }; return value; },
      (err) => {
        // Wipe the inflight marker so the next caller retries fresh.
        overviewCache = null;
        throw err;
      },
    );

    overviewCache = { value: overviewCache?.value, expiresAt: overviewCache?.expiresAt ?? 0, inflight: fetcher };

    try {
      res.json(await fetcher);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[costs/overview]', msg);
      // UnrecognizedClientException / InvalidClientTokenId → no valid credentials.
      // Don't cache this — the user might add creds shortly.
      if (msg.includes('credentials') || msg.includes('token') || msg.includes('UnrecognizedClient') || msg.includes('InvalidClientToken')) {
        res.json({ noCredentials: true });
        return;
      }
      res.status(502).json(problemDetails(502, 'Cost Explorer Error', msg));
    }
  });

  // Legacy DynamoDB-backed endpoints (kept for future ingestion pipeline)
  router.get('/teams/:teamId', async (req: Request, res: Response) => {
    const month = (req.query['month'] as string) ?? new Date().toISOString().slice(0, 7);
    const result = await handlers.getCostDashboard.execute(String(req.params['teamId']), month);
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Error', result.error.message)); return; }
    res.json(result.value);
  });

  router.get('/services/:serviceId/daily', async (req: Request, res: Response) => {
    const serviceId = String(req.params['serviceId']);
    const endDate = req.query['endDate'] ? String(req.query['endDate']) : new Date().toISOString().slice(0, 10);
    const startDate = req.query['startDate'] ? String(req.query['startDate']) : new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const result = await handlers.costRepo.getDailyCostRange(serviceId, startDate, endDate);
    if (!result.ok) { res.status(500).json(problemDetails(500, 'Error', result.error.message)); return; }
    res.json(result.value);
  });

  return router;
}
