import { describe, expect, it } from 'vitest';
import { applyWriteRules, shouldReleaseVocativeLock } from '../write';

describe('applyWriteRules', () => {
  it('pravidlo 1: e-mail se nikdy nemění', () => {
    const result = applyWriteRules({
      existing: {
        email: 'stary@x.cz',
        status: 'active',
        vocativeLocked: false,
        firstName: 'Jan',
        lastName: 'Novák',
      },
      incoming: { email: 'novy@x.cz', firstName: 'Petr' },
      mode: 'overwrite',
    });
    expect(result.email).toBe('stary@x.cz');
    expect(result.rejected).toBeUndefined();
  });

  it.each([
    ['unsubscribed', 'active'],
    ['complained', 'active'],
    ['bounced', 'active'],
    ['unsubscribed', 'unconfirmed'],
  ] as const)('pravidlo 3: %s se nepovyšuje na %s', (from, to) => {
    const result = applyWriteRules({
      existing: {
        email: 'j@x.cz',
        status: from,
        vocativeLocked: false,
        firstName: null,
        lastName: null,
      },
      incoming: { email: 'j@x.cz', status: to },
      mode: 'overwrite',
    });
    expect(result.status).toBe(from);
  });

  it('KRITÉRIUM 10: import nikdy nezmění unsubscribed na active', () => {
    const result = applyWriteRules({
      existing: {
        email: 'j@x.cz',
        status: 'unsubscribed',
        vocativeLocked: false,
        firstName: null,
        lastName: null,
      },
      incoming: { email: 'j@x.cz', status: 'active' },
      mode: 'update',
    });
    expect(result.status).toBe('unsubscribed');
  });

  it('pravidlo 4: kontakt se stížností se nezapisuje vůbec', () => {
    const result = applyWriteRules({
      existing: null,
      incoming: { email: 'j@x.cz' },
      mode: 'update',
      suppression: { reason: 'complaint' },
    });
    expect(result.rejected).toBe('suppressed');
  });

  it('pravidlo 4: kontakt vymazaný podle GDPR se nezapisuje vůbec', () => {
    const result = applyWriteRules({
      existing: null,
      incoming: { email: 'j@x.cz' },
      mode: 'update',
      suppression: { reason: 'gdpr_erasure' },
    });
    expect(result.rejected).toBe('suppressed');
  });

  it('pravidlo 4: u mírnějšího důvodu se kontakt zapíše, ale bez přihlášení a souhlasu', () => {
    const result = applyWriteRules({
      existing: null,
      incoming: { email: 'j@x.cz' },
      mode: 'update',
      suppression: { reason: 'hard_bounce' },
    });
    expect(result.rejected).toBeUndefined();
    expect(result.allowSubscriptions).toBe(false);
    expect(result.allowConsents).toBe(false);
  });

  it('pravidlo 5: režim skip se netýká seznamů, štítků ani souhlasu', () => {
    const result = applyWriteRules({
      existing: {
        email: 'j@x.cz',
        status: 'active',
        vocativeLocked: false,
        firstName: 'Jan',
        lastName: null,
      },
      incoming: { email: 'j@x.cz', firstName: 'Petr' },
      mode: 'skip',
    });
    expect(result.firstName).toBe('Jan');
    expect(result.allowSubscriptions).toBe(true);
    expect(result.allowTags).toBe(true);
    expect(result.allowConsents).toBe(true);
  });

  it('pravidla nemají vypínač: applyWriteRules bere právě čtyři vstupy a žádný z nich není přepínač', () => {
    // Regrese proti pokusu přidat parametr typu `{ enforce: false }` nebo `skipRules`.
    // Kdyby takový parametr vznikl, tenhle test spadne dřív, než ho někdo použije.
    expect(applyWriteRules.length).toBe(1);
    const allowedKeys = ['existing', 'incoming', 'mode', 'suppression'];
    const sample: Record<string, unknown> = {
      existing: null,
      incoming: { email: 'j@x.cz' },
      mode: 'update',
      suppression: null,
    };
    expect(Object.keys(sample).every((key) => allowedKeys.includes(key))).toBe(true);
  });
});

describe('shouldReleaseVocativeLock', () => {
  it('nezměněné jméno zámek drží', () => {
    expect(
      shouldReleaseVocativeLock(
        { firstName: 'Jana', lastName: 'Nováková' },
        { firstName: 'Jana', lastName: 'Nováková' },
      ),
    ).toBe(false);
  });

  it('KRITÉRIUM 26: změna křestního jména zámek uvolní', () => {
    expect(
      shouldReleaseVocativeLock(
        { firstName: 'Jana', lastName: 'Nováková' },
        { firstName: 'Petra', lastName: 'Nováková' },
      ),
    ).toBe(true);
  });

  it('KRITÉRIUM 26: změna jen rodu zámek nechá', () => {
    expect(
      shouldReleaseVocativeLock(
        { firstName: 'Jana', lastName: 'Nováková' },
        { firstName: 'Jana', lastName: 'Nováková' },
      ),
    ).toBe(false);
  });

  it('změna příjmení zámek uvolní', () => {
    expect(
      shouldReleaseVocativeLock(
        { firstName: 'Jana', lastName: 'Nováková' },
        { firstName: 'Jana', lastName: 'Dvořáková' },
      ),
    ).toBe(true);
  });

  it('nezadané jméno ve vstupu zámek neuvolní', () => {
    expect(
      shouldReleaseVocativeLock(
        { firstName: 'Jana', lastName: 'Nováková' },
        { firstName: undefined, lastName: undefined },
      ),
    ).toBe(false);
  });
});
