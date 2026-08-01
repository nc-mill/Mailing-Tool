import { describe, expect, it } from 'vitest';
import { createPortRegistry, type AudiencePort } from '../ports';

describe('registr portu', () => {
  it('nezaregistrovany port hlasi jmenovitou chybu, ne undefined is not a function', () => {
    const reg = createPortRegistry();
    expect(() => reg.audience()).toThrowError(/audience port není zaregistrovaný/);
  });

  it('zaregistrovany port se vrati', () => {
    const reg = createPortRegistry();
    const fake: AudiencePort = {
      compileToSql: async () => ({ sql: 'SELECT a.id AS contact_id FROM contacts a', params: [] }),
      countGates: async () => ({
        raw: 0,
        eligible: 0,
        excluded_suppressed: 0,
        excluded_unsubscribed: 0,
        excluded_unconfirmed: 0,
        excluded_snoozed: 0,
        excluded_processing_restricted: 0,
        excluded_invalid_email: 0,
        excluded_deleted: 0,
        excluded_sample: 0,
        duplicates_removed: 0,
      }),
    };
    reg.register('audience', fake);
    expect(reg.audience()).toBe(fake);
  });
});
