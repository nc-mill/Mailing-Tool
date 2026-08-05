import { describe, expect, it } from 'vitest';
import type { Keyring } from '@mlain/contracts/keyring';
import { issueTrialVerificationToken, verifyTrialVerificationToken } from '../trial-token';
import { resolveTrialMode } from '../api/trial-service';

/** Dvě pokolení klíče, aby šlo ověřit, že rotace nezneplatní rozeslané odkazy. */
const keyring: Keyring = new Map([
  [1, new Uint8Array(32).fill(7)],
  [2, new Uint8Array(32).fill(9)],
]);

const WORKSPACE = '3f2a1c9e-4b7d-4e51-9a8f-2c6b0d1e5a44';
const OTHER_WORKSPACE = '11111111-2222-4333-8444-555555555555';

describe('token na ověření adresy ve zkušebním režimu', () => {
  it('vydaný token projde a vrátí projekt i adresu', () => {
    const token = issueTrialVerificationToken(keyring, {
      workspaceId: WORKSPACE,
      email: 'Overena@Firma.cz',
    });
    const result = verifyTrialVerificationToken(keyring, token);
    expect(result).toMatchObject({ ok: true, workspaceId: WORKSPACE, email: 'overena@firma.cz' });
  });

  it('token podepsaný starším pokolením projde i po rotaci klíče', () => {
    const older: Keyring = new Map([[1, new Uint8Array(32).fill(7)]]);
    const token = issueTrialVerificationToken(older, {
      workspaceId: WORKSPACE,
      email: 'overena@firma.cz',
    });
    expect(verifyTrialVerificationToken(keyring, token).ok).toBe(true);
  });

  it('token podepsaný cizím klíčem neprojde', () => {
    const foreign: Keyring = new Map([[1, new Uint8Array(32).fill(42)]]);
    const token = issueTrialVerificationToken(foreign, {
      workspaceId: WORKSPACE,
      email: 'overena@firma.cz',
    });
    expect(verifyTrialVerificationToken(keyring, token)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('změna adresy v tokenu ho zneplatní, projekt se nezmění', () => {
    const token = issueTrialVerificationToken(keyring, {
      workspaceId: WORKSPACE,
      email: 'overena@firma.cz',
    });
    const parts = token.split('.');
    parts[2] = Buffer.from('utocnik@jinde.cz', 'utf8').toString('base64url');
    expect(verifyTrialVerificationToken(keyring, parts.join('.'))).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('token z jiného projektu se pozná podle podpisu, ne až podle porovnání', () => {
    const token = issueTrialVerificationToken(keyring, {
      workspaceId: OTHER_WORKSPACE,
      email: 'overena@firma.cz',
    });
    const parsed = verifyTrialVerificationToken(keyring, token);
    expect(parsed).toMatchObject({ ok: true, workspaceId: OTHER_WORKSPACE });
  });

  it('po sedmi dnech je token prošlý', () => {
    const issuedAt = new Date('2026-08-01T10:00:00.000Z');
    const token = issueTrialVerificationToken(keyring, {
      workspaceId: WORKSPACE,
      email: 'overena@firma.cz',
      now: issuedAt,
    });
    expect(
      verifyTrialVerificationToken(keyring, token, { now: new Date('2026-08-08T10:00:01.000Z') }),
    ).toEqual({ ok: false, reason: 'expired' });
    expect(
      verifyTrialVerificationToken(keyring, token, { now: new Date('2026-08-07T23:00:00.000Z') })
        .ok,
    ).toBe(true);
  });

  it('poškozený tvar se nikdy nepokouší dešifrovat', () => {
    expect(verifyTrialVerificationToken(keyring, 'nesmysl')).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(verifyTrialVerificationToken(keyring, 'v2.a.b.c.d')).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });
});

describe('platný zkušební režim', () => {
  it('bez ověřené domény je zapnutý, i když se uživatel nevyjádřil', () => {
    expect(resolveTrialMode({}, { hasVerifiedDomain: false })).toBe(true);
  });

  it('s ověřenou doménou je vypnutý, dokud si ho uživatel nezapne', () => {
    expect(resolveTrialMode({}, { hasVerifiedDomain: true })).toBe(false);
    expect(resolveTrialMode({ trial_mode: true }, { hasVerifiedDomain: true })).toBe(true);
  });

  it('vyjádření uživatele přebíjí stav domény v obou směrech', () => {
    expect(resolveTrialMode({ trial_mode: false }, { hasVerifiedDomain: false })).toBe(false);
  });

  /**
   * Přesně stav tohohle projektu: doména ověřená, a účet přitom u Amazonu
   * v testovacím režimu. Bez tohohle pravidla by se režim vypnul, materializace
   * by vyrobila zprávy pro celé publikum a Amazon by je odmítal jednu po druhé.
   */
  it('testovací režim u Amazonu zapne zkušební režim i u ověřené domény', () => {
    expect(resolveTrialMode({}, { hasVerifiedDomain: true, providerSandbox: true })).toBe(true);
  });

  it('produkční přístup u Amazonu nechá rozhodnout doménu', () => {
    expect(resolveTrialMode({}, { hasVerifiedDomain: true, providerSandbox: false })).toBe(false);
  });

  /** Nevědomost režim nezapíná: tvrdit omezení, které jsme nepřečetli, je táž chyba. */
  it('nenačtený stav účtu se nepovažuje za testovací režim', () => {
    expect(resolveTrialMode({}, { hasVerifiedDomain: true, providerSandbox: undefined })).toBe(
      false,
    );
  });
});
