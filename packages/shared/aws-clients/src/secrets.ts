import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { type Result, success, failure, type DomainError, domainError } from '@wep/domain-types';
import { credentialStore } from './credential-store.js';

const secretsClient = new SecretsManagerClient({
  region: process.env['AWS_REGION'] ?? 'me-south-1',
  credentials: credentialStore.getProvider(),
});

const cache = new Map<string, { value: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function getSecret(
  secretId: string,
): Promise<Result<string, DomainError>> {
  const cached = cache.get(secretId);
  if (cached && cached.expiresAt > Date.now()) {
    return success(cached.value);
  }

  try {
    const response = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: secretId }),
    );

    const value = response.SecretString;
    if (!value) {
      return failure(domainError('SECRET_EMPTY', `Secret ${secretId} has no string value`));
    }

    cache.set(secretId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return success(value);
  } catch (error) {
    return failure(
      domainError('SECRET_FETCH_FAILED', `Failed to fetch secret ${secretId}`, {
        cause: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
