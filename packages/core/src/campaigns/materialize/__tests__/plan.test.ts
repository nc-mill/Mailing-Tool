import { describe, expect, it } from 'vitest';
import { decideAfterFailedClaim } from '../plan';

describe('co udela job, kdyz prechod do queueing nevrati radek', () => {
  it.each(['queueing', 'sending'] as const)('stav %s: pokracuje od kurzoru', (status) => {
    expect(decideAfterFailedClaim(status)).toEqual({ action: 'continue' });
  });

  it('paused: skonci, materializaci znovu posle az resume', () => {
    expect(decideAfterFailedClaim('paused')).toEqual({ action: 'stop', level: 'info' });
  });

  it.each(['cancelled', 'failed', 'sent', 'partially_sent'] as const)(
    'stav %s: no-op, je to opozdeny duplikat jobu',
    (status) => {
      expect(decideAfterFailedClaim(status)).toEqual({ action: 'noop' });
    },
  );

  it.each(['draft', 'scheduled', 'schedule_missed'] as const)(
    'stav %s: skonci a zaloguje warn, nekdo kampan vratil zpatky',
    (status) => {
      expect(decideAfterFailedClaim(status)).toEqual({ action: 'stop', level: 'warn' });
    },
  );

  it('nikdy nevrati action continue pro stav mimo odesilaci dvojici', () => {
    const nonContinue = [
      'paused',
      'cancelled',
      'failed',
      'sent',
      'partially_sent',
      'draft',
    ] as const;
    for (const s of nonContinue) expect(decideAfterFailedClaim(s).action).not.toBe('continue');
  });
});
