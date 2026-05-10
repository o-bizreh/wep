import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { credentialStore } from './credential-store.js';

export function createEventBridgeClient(config?: {
  region?: string;
  endpoint?: string;
}): EventBridgeClient {
  return new EventBridgeClient({
    region: config?.region ?? process.env['AWS_REGION'] ?? 'me-south-1',
    credentials: credentialStore.getProvider(),
    ...(config?.endpoint ? { endpoint: config.endpoint } : {}),
  });
}

export function getBusName(env?: string): string {
  const environment = env ?? process.env['WEP_ENVIRONMENT'] ?? 'development';
  return `wep-platform-${environment}`;
}
