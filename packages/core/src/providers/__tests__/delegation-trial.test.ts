import { describe, expect, it } from 'vitest';
import {
  createDelegationToken,
  verifyDelegationToken,
  DELEGATION_PUBLIC_FIELDS,
} from '../delegation';
import { canSendInTrial, trialAudienceNotice, addTrialAddress } from '../trial-mode';

describe('delegační odkaz', () => {
  it('token je 32 bajtů a ukládá se jako otisk, nikdy v plaintextu', () => {
    const t = createDelegationToken();
    expect(Buffer.from(t.token, 'base64url').length).toBe(32);
    expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.hash).not.toContain(t.token);
  });

  it('platí 14 dní', () => {
    const t = createDelegationToken({ now: new Date('2026-08-01T00:00:00.000Z') });
    expect(t.expiresAt.toISOString()).toBe('2026-08-15T00:00:00.000Z');
  });

  it('vypršelý token neprojde', () => {
    const t = createDelegationToken({ now: new Date('2026-08-01T00:00:00.000Z') });
    expect(
      verifyDelegationToken(t.token, {
        hash: t.hash,
        expiresAt: t.expiresAt,
        now: new Date('2026-08-20T00:00:00.000Z'),
      }),
    ).toBe(false);
  });

  it('platný token uvnitř okna projde', () => {
    const t = createDelegationToken({ now: new Date('2026-08-01T00:00:00.000Z') });
    expect(
      verifyDelegationToken(t.token, {
        hash: t.hash,
        expiresAt: t.expiresAt,
        now: new Date('2026-08-10T00:00:00.000Z'),
      }),
    ).toBe(true);
  });

  it('špatný token neprojde, i kdyby okno ještě platilo', () => {
    const t = createDelegationToken({ now: new Date('2026-08-01T00:00:00.000Z') });
    expect(
      verifyDelegationToken('spatny-token', {
        hash: t.hash,
        expiresAt: t.expiresAt,
        now: new Date('2026-08-02T00:00:00.000Z'),
      }),
    ).toBe(false);
  });

  it('stránka ukazuje jen záznamy a stav, nic z nástroje', () => {
    expect(DELEGATION_PUBLIC_FIELDS).toEqual([
      'domain',
      'company_name',
      'records',
      'checks',
      'checked_at',
    ]);
    expect(DELEGATION_PUBLIC_FIELDS).not.toContain('contacts');
    expect(DELEGATION_PUBLIC_FIELDS).not.toContain('campaigns');
  });
});

describe('zkušební režim', () => {
  const settings = {
    trial_mode: true,
    trial_verified: [{ email: 'jana@firma.cz', verified_at: '2026-08-01T00:00:00.000Z' }],
  };

  it('ověřená adresa projde, neověřená ne', () => {
    expect(canSendInTrial('jana@firma.cz', settings)).toBe(true);
    expect(canSendInTrial('kdokoliv@jinde.cz', settings)).toBe(false);
  });

  it('adresa se porovnává bez ohledu na velikost písmen', () => {
    expect(canSendInTrial('JANA@FIRMA.CZ', settings)).toBe(true);
  });

  it('nepotvrzená adresa neprojde, i když je v seznamu', () => {
    expect(
      canSendInTrial('nova@firma.cz', {
        trial_mode: true,
        trial_verified: [{ email: 'nova@firma.cz', verified_at: null }],
      }),
    ).toBe(false);
  });

  it('pruh na publiku řekne konkrétní číslo, ne obecné varování', () => {
    expect(trialAudienceNotice({ audienceSize: 12_480, verifiedCount: 2 })).toMatchObject({
      audience: 12_480,
      willReceive: 2,
    });
  });

  it('jedenáctá adresa se odmítá, limit je deset', () => {
    const full = {
      trial_mode: true,
      trial_verified: Array.from({ length: 10 }, (_, i) => ({
        email: `a${i}@x.cz`,
        verified_at: null,
      })),
    };
    expect(() => addTrialAddress(full, 'jedenacta@x.cz')).toThrowError(/nejvýše 10/);
  });

  it('opakované přidání téže adresy seznam nezdvojí', () => {
    const next = addTrialAddress(settings, 'jana@firma.cz');
    expect(next.trial_verified).toHaveLength(1);
  });

  it('vypnutý zkušební režim nikoho neomezuje', () => {
    expect(canSendInTrial('kdokoliv@jinde.cz', { trial_mode: false, trial_verified: [] })).toBe(
      true,
    );
  });
});
