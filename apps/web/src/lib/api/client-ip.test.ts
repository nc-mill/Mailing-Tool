import { describe, it, expect } from 'vitest';
import { clientIpFrom } from './client-ip';

describe('clientIpFrom', () => {
  it('při TRUST_PROXY=0 ignoruje X-Forwarded-For', () => {
    expect(clientIpFrom({ xff: '1.2.3.4, 5.6.7.8', remote: '10.0.0.1', trustProxy: 0 })).toBe(
      '10.0.0.1',
    );
  });

  it('při TRUST_PROXY=1 bere první adresu zprava', () => {
    expect(clientIpFrom({ xff: '1.2.3.4, 5.6.7.8', remote: '10.0.0.1', trustProxy: 1 })).toBe(
      '5.6.7.8',
    );
  });

  it('při TRUST_PROXY=2 bere druhou adresu zprava', () => {
    expect(clientIpFrom({ xff: '1.2.3.4, 5.6.7.8', remote: '10.0.0.1', trustProxy: 2 })).toBe(
      '1.2.3.4',
    );
  });

  it('nikdy nebere naivně první hodnotu, kterou nastaví útočník', () => {
    expect(clientIpFrom({ xff: '9.9.9.9, 1.2.3.4', remote: '10.0.0.1', trustProxy: 1 })).toBe(
      '1.2.3.4',
    );
  });

  it('při kratším XFF než TRUST_PROXY spadne zpět na adresu spojení', () => {
    expect(clientIpFrom({ xff: '1.2.3.4', remote: '10.0.0.1', trustProxy: 3 })).toBe('10.0.0.1');
  });

  it('bez XFF vrací adresu spojení', () => {
    expect(clientIpFrom({ xff: null, remote: '10.0.0.1', trustProxy: 2 })).toBe('10.0.0.1');
  });
});
