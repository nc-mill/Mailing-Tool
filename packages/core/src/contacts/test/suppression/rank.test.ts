import { describe, expect, it } from 'vitest';
import { SUPPRESSION_RANK, SUPPRESSION_REASONS, isStricter, rankOf } from '../../suppression/rank';
import { REMOVABLE_BY_DEFAULT, canRemove, minimumAgeDays } from '../../suppression/removal';

describe('prioritní žebříček důvodů', () => {
  it('má přesně pořadí ze 4.10.4, nejpřísnější první', () => {
    expect(SUPPRESSION_RANK).toEqual([
      'gdpr_erasure',
      'complaint',
      'hard_bounce',
      'ses_suppressed',
      'global_unsubscribe',
      'one_click_unsubscribe',
      'soft_bounce_threshold',
      'invalid',
      'import',
      'manual',
    ]);
  });

  it('každý důvod z výčtu je v žebříčku a naopak', () => {
    expect([...SUPPRESSION_RANK].sort()).toEqual([...SUPPRESSION_REASONS].sort());
  });

  it('nižší index znamená přísnější důvod', () => {
    expect(rankOf('gdpr_erasure')).toBeLessThan(rankOf('complaint'));
    expect(rankOf('complaint')).toBeLessThan(rankOf('hard_bounce'));
    expect(rankOf('manual')).toBe(SUPPRESSION_RANK.length - 1);
  });

  it('isStricter je jednosměrné', () => {
    expect(isStricter('complaint', 'manual')).toBe(true);
    expect(isStricter('manual', 'complaint')).toBe(false);
    expect(isStricter('complaint', 'complaint')).toBe(false);
  });

  it('neznámý důvod je chyba, ne tichý průchod', () => {
    expect(() => rankOf('vymyslene' as never)).toThrow(/žebříčk/i);
  });
});

describe('matice odebrání', () => {
  it('KRITÉRIUM 61: stížnost neodebere nikdo, ani vlastník', () => {
    for (const role of ['owner', 'admin', 'editor'] as const) {
      expect(canRemove('complaint', role, 999)).toEqual({
        allowed: false,
        code: 'suppression_not_removable',
      });
    }
  });

  it('výmaz podle GDPR neodebere nikdo', () => {
    expect(canRemove('gdpr_erasure', 'owner', 999)).toEqual({
      allowed: false,
      code: 'suppression_not_removable',
    });
  });

  it('odhlášení neodebere nikdo ručně, odstraní se samo novým potvrzením', () => {
    expect(canRemove('global_unsubscribe', 'owner', 999)).toEqual({
      allowed: false,
      code: 'suppression_not_removable',
    });
    expect(canRemove('one_click_unsubscribe', 'owner', 999)).toEqual({
      allowed: false,
      code: 'suppression_not_removable',
    });
  });

  it('KRITÉRIUM 62: tvrdý odraz jde odebrat až po třiceti dnech', () => {
    expect(canRemove('hard_bounce', 'admin', 29)).toEqual({
      allowed: false,
      code: 'suppression_too_recent',
    });
    expect(canRemove('hard_bounce', 'admin', 30)).toEqual({ allowed: true });
  });

  it('tvrdý odraz nesmí odebrat editor', () => {
    expect(canRemove('hard_bounce', 'editor', 100)).toEqual({ allowed: false, code: 'forbidden' });
  });

  it.each(['soft_bounce_threshold', 'manual', 'import', 'invalid'] as const)(
    'důvod %s smí odebrat editor kdykoliv',
    (reason) => {
      expect(canRemove(reason, 'editor', 0)).toEqual({ allowed: true });
    },
  );

  it('výchozí odebratelnost odpovídá matici ze 4.10.1', () => {
    expect(REMOVABLE_BY_DEFAULT.complaint).toBe(false);
    expect(REMOVABLE_BY_DEFAULT.gdpr_erasure).toBe(false);
    expect(REMOVABLE_BY_DEFAULT.hard_bounce).toBe(false);
    expect(REMOVABLE_BY_DEFAULT.manual).toBe(true);
    expect(REMOVABLE_BY_DEFAULT.import).toBe(true);
  });

  it('minimální stáří má jen tvrdý odraz', () => {
    expect(minimumAgeDays('hard_bounce')).toBe(30);
    expect(minimumAgeDays('manual')).toBe(0);
  });
});
