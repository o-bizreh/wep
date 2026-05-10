import { Router, type Request, type Response, type NextFunction } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';

const SLACK_TIMESTAMP_TOLERANCE_SECONDS = 60 * 5;

/**
 * Slack interactions endpoint.
 *
 * v1 only handles `act:view_request` (a no-op since the View Request button
 * is a link, not an interaction) but the route exists so we can later add
 * inline approve / deny buttons without touching infrastructure.
 *
 * IMPORTANT: must verify the X-Slack-Signature header against the raw request
 * body. Express must be configured with `bodyParser.raw({ type: 'application/x-www-form-urlencoded' })`
 * for this route specifically — JSON parsing breaks signature verification.
 */
export function createSlackInteractionsRouter(): Router {
  const router = Router();

  router.post('/', verifySignature, async (req: Request, res: Response) => {
    // Slack sends payload as a URL-encoded form field named "payload".
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody?.toString('utf8') ?? '';
    const params = new URLSearchParams(rawBody);
    const payloadStr = params.get('payload');
    if (!payloadStr) {
      res.status(400).send('Missing payload');
      return;
    }
    let payload: { actions?: Array<{ action_id?: string }> };
    try {
      payload = JSON.parse(payloadStr) as typeof payload;
    } catch {
      res.status(400).send('Invalid payload JSON');
      return;
    }

    const actionId = payload.actions?.[0]?.action_id ?? '';
    switch (actionId) {
      case 'act:view_request':
        // Link button — Slack also opens the URL client-side. Just acknowledge.
        res.status(200).send();
        return;
      default:
        // Future: 'act:approve_inline' / 'act:deny_inline'.
        res.status(200).send();
        return;
    }
  });

  return router;
}

/**
 * Verify Slack request signature using HMAC-SHA256 over `v0:{timestamp}:{rawBody}`.
 * Rejects requests older than 5 minutes (replay protection).
 */
function verifySignature(req: Request, res: Response, next: NextFunction): void {
  const signingSecret = process.env['SLACK_SIGNING_SECRET'];
  if (!signingSecret) {
    res.status(503).send('Slack interactions disabled — SLACK_SIGNING_SECRET not configured');
    return;
  }

  const timestamp = req.header('x-slack-request-timestamp');
  const sigHeader = req.header('x-slack-signature');
  if (!timestamp || !sigHeader) {
    res.status(401).send('Missing Slack signature headers');
    return;
  }

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) {
    res.status(401).send('Invalid timestamp');
    return;
  }
  if (Math.abs(Math.floor(Date.now() / 1000) - tsNum) > SLACK_TIMESTAMP_TOLERANCE_SECONDS) {
    res.status(401).send('Stale request');
    return;
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    res.status(401).send('Missing raw body');
    return;
  }

  const baseString = `v0:${timestamp}:${rawBody.toString('utf8')}`;
  const expected = `v0=${createHmac('sha256', signingSecret).update(baseString).digest('hex')}`;
  // timingSafeEqual requires equal-length buffers
  const a = Buffer.from(expected);
  const b = Buffer.from(sigHeader);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).send('Bad signature');
    return;
  }
  next();
}
