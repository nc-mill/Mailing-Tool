import { describe, expect, it } from 'vitest';
import { deriveProviderStatus, canSendWith } from '../state-machine';

const healthy = {
  credentialsValid: true,
  snsConfirmed: true,
  domainVerified: true,
  enforcementStatus: 'HEALTHY' as const,
  sendingEnabled: true,
  disabled: false,
  dmarcOk: true,
  eventsFlowing: true,
};

describe('stavovy stroj provideru', () => {
  it('vse v poradku je ready', () => {
    expect(deriveProviderStatus(healthy)).toBe('ready');
  });

  it('neplatne credentials jsou unverified', () => {
    expect(deriveProviderStatus({ ...healthy, credentialsValid: false })).toBe('unverified');
  });

  it('platne credentials bez potvrzeneho SNS jsou verifying', () => {
    expect(deriveProviderStatus({ ...healthy, snsConfirmed: false })).toBe('verifying');
  });

  it('SHUTDOWN je blocked', () => {
    expect(deriveProviderStatus({ ...healthy, enforcementStatus: 'SHUTDOWN' })).toBe('blocked');
  });

  it('sendingEnabled false je blocked, i kdyz je enforcement HEALTHY', () => {
    expect(deriveProviderStatus({ ...healthy, sendingEnabled: false })).toBe('blocked');
  });

  it('PROBATION je degraded a odesilat lze s varovanim', () => {
    expect(deriveProviderStatus({ ...healthy, enforcementStatus: 'PROBATION' })).toBe('degraded');
    expect(canSendWith('degraded')).toBe(true);
  });

  it('chybejici DMARC je degraded, ne blocked', () => {
    expect(deriveProviderStatus({ ...healthy, dmarcOk: false })).toBe('degraded');
  });

  it('prestaly chodit udalosti: degraded', () => {
    expect(deriveProviderStatus({ ...healthy, eventsFlowing: false })).toBe('degraded');
  });

  it('rucne vypnuty provider je disabled a odeslat nejde', () => {
    expect(deriveProviderStatus({ ...healthy, disabled: true })).toBe('disabled');
    expect(canSendWith('disabled')).toBe(false);
  });

  it('neznamy stav se povazuje za nepouzitelny, ne za pouzitelny', () => {
    expect(canSendWith('something_new')).toBe(false);
  });
});
