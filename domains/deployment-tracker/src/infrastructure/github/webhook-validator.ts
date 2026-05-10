import { createHmac, timingSafeEqual } from 'node:crypto';
import { type Result, success, failure, domainError, DeploymentErrorCode, type DomainError } from '@wep/domain-types';

export function validateWebhookSignature(
  payload: string,
  signature: string | undefined,
  secret: string,
): Result<void, DomainError<DeploymentErrorCode>> {
  if (!signature) {
    return failure(
      domainError(DeploymentErrorCode.WEBHOOK_VALIDATION_FAILED, 'Missing X-Hub-Signature-256 header'),
    );
  }

  const expectedSignature = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
    return failure(
      domainError(DeploymentErrorCode.WEBHOOK_VALIDATION_FAILED, 'Invalid webhook signature'),
    );
  }

  return success(undefined);
}
