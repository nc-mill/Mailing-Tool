import { SESv2Client } from '@aws-sdk/client-sesv2';
import { SNSClient } from '@aws-sdk/client-sns';
import type { SesConfig } from '../types';

export type AwsClients = { ses: SESv2Client; sns: SNSClient };

/**
 * Timeout 5 s (AWS_API_TIMEOUT_MS). Kdyz volani selze, pouzije se posledni znama
 * hodnota a prida se varovani. Selhani NEBLOKUJE bezici kampan, ale BLOKUJE spusteni
 * nove (preflight kontrola 3).
 */
export function createAwsClients(config: SesConfig, timeoutMs: number): AwsClients {
  const credentials = {
    accessKeyId: config.access_key_id,
    secretAccessKey: config.secret_access_key,
  };
  const requestHandler = { requestTimeout: timeoutMs, connectionTimeout: timeoutMs };
  return {
    ses: new SESv2Client({ region: config.region, credentials, requestHandler }),
    sns: new SNSClient({ region: config.region, credentials, requestHandler }),
  };
}
