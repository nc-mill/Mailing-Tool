import type { ProviderStatus } from './types';

export type ProviderSignals = {
  credentialsValid: boolean;
  snsConfirmed: boolean;
  domainVerified: boolean;
  enforcementStatus: 'HEALTHY' | 'PROBATION' | 'SHUTDOWN' | (string & {});
  sendingEnabled: boolean;
  disabled: boolean;
  dmarcOk: boolean;
  eventsFlowing: boolean;
};

export function deriveProviderStatus(s: ProviderSignals): ProviderStatus {
  if (s.disabled) return 'disabled';
  if (!s.credentialsValid) return 'unverified';
  if (s.enforcementStatus === 'SHUTDOWN' || !s.sendingEnabled) return 'blocked';
  if (!s.snsConfirmed || !s.domainVerified) return 'verifying';
  if (s.enforcementStatus === 'PROBATION' || !s.dmarcOk || !s.eventsFlowing) return 'degraded';
  return 'ready';
}

/**
 * Neznamy stav se povazuje za NEPOUZITELNY. Je to jediny bezpecny default: kdyby se
 * neznamy stav bral jako pouzitelny, prvni nova hodnota v budoucim vydani by pustila
 * odesilani z uctu, o kterem nic nevime.
 */
export function canSendWith(status: ProviderStatus): boolean {
  return status === 'ready' || status === 'degraded';
}
