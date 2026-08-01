import { describe, expect, it } from 'vitest';
import { MAILABLE_STATUS, evaluateMailability, isMailable } from '../mailable';

const base = {
  status: 'active' as const,
  deletedAt: null,
  processingRestricted: false,
  suppression: null,
  subscription: null,
};

describe('evaluateMailability', () => {
  it('hodnota subscribed neexistuje a nikdy neexistovala', () => {
    expect(MAILABLE_STATUS).toBe('active');
    expect([
      'active',
      'unconfirmed',
      'unsubscribed',
      'bounced',
      'complained',
      'deleted',
    ]).not.toContain('subscribed');
  });

  it('vrstva 1: suppression vyloučí kontakt, i když je status active', () => {
    expect(evaluateMailability({ ...base, suppression: { reason: 'hard_bounce' } })).toEqual({
      mailable: false,
      blockedBy: 'suppression',
    });
  });

  it('vrstva 2: měkce smazaný kontakt je vyloučený', () => {
    expect(evaluateMailability({ ...base, deletedAt: new Date() })).toEqual({
      mailable: false,
      blockedBy: 'deleted',
    });
  });

  it('vrstva 2: omezené zpracování je tvrdé vyloučení bez výjimky', () => {
    expect(evaluateMailability({ ...base, processingRestricted: true })).toEqual({
      mailable: false,
      blockedBy: 'processing_restricted',
    });
  });

  it('vrstva 3: u kampaně na seznam rozhoduje stav přihlášení, ne stav kontaktu', () => {
    expect(
      evaluateMailability({
        ...base,
        status: 'active',
        subscription: { status: 'pending', snoozeUntil: null },
      }),
    ).toEqual({ mailable: false, blockedBy: 'subscription' });
  });

  it('vrstva 3: potvrzené přihlášení stačí', () => {
    expect(
      evaluateMailability({ ...base, subscription: { status: 'confirmed', snoozeUntil: null } }),
    ).toEqual({ mailable: true });
  });

  it('vrstva 3: pozastavení do budoucna vylučuje', () => {
    const future = new Date(Date.now() + 86400000);
    expect(
      evaluateMailability({ ...base, subscription: { status: 'confirmed', snoozeUntil: future } }),
    ).toEqual({ mailable: false, blockedBy: 'snoozed' });
  });

  it('vrstva 3: prošlé pozastavení nevylučuje', () => {
    const past = new Date(Date.now() - 86400000);
    expect(
      evaluateMailability({ ...base, subscription: { status: 'confirmed', snoozeUntil: past } }),
    ).toEqual({ mailable: true });
  });

  it.each(['unconfirmed', 'unsubscribed', 'bounced', 'complained', 'deleted'] as const)(
    'vrstva 4: stav %s bez seznamu vylučuje',
    (status) => {
      expect(evaluateMailability({ ...base, status })).toMatchObject({ mailable: false });
    },
  );

  it('vrstva 4: active bez seznamu prochází', () => {
    expect(evaluateMailability(base)).toEqual({ mailable: true });
  });

  it('pořadí vrstev: suppression přebije vše ostatní', () => {
    expect(
      evaluateMailability({
        ...base,
        status: 'active',
        suppression: { reason: 'complaint' },
        subscription: { status: 'confirmed', snoozeUntil: null },
      }),
    ).toEqual({ mailable: false, blockedBy: 'suppression' });
  });

  it('isMailable je jen zkratka nad toutéž bránou', () => {
    expect(isMailable(base)).toBe(true);
    expect(isMailable({ ...base, processingRestricted: true })).toBe(false);
  });
});
