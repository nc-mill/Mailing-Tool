import { describe, expect, it } from 'vitest';
import { TOKEN_CHARS } from './codec';
import { buildTrackingKeyring } from './keyring';
import { mintIdentityToken } from './mint';
import { verifyTrackingToken } from './verify';

const ring = buildTrackingKeyring({
  secretKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
  secretKeyPrevious: '',
});
const now = new Date('2026-07-25T16:00:00Z');
const base = {
  workspaceId: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071',
  contactId: '0192f3a0-1c2d-7e43-8d4e-5f60718293a4',
  campaignId: '0192f3a0-1c2d-7e44-9e5f-60718293a4b5',
};

describe('mintIdentityToken', () => {
  it('vydaný token má 106 znaků a ověří se vlastním keyringem', () => {
    const { token } = mintIdentityToken({
      ...base,
      ttlSeconds: 900,
      keyring: ring,
      currentKeyId: 1,
      now,
    });
    expect(token).toHaveLength(TOKEN_CHARS.i);
    expect(TOKEN_CHARS.i).toBe(106);
    expect(verifyTrackingToken(token, ['i'], { keyring: ring, now }).ok).toBe(true);
  });

  it('expirace je now plus TTL v celých sekundách, výchozí TTL je 15 minut', () => {
    const { expiresAt } = mintIdentityToken({
      ...base,
      ttlSeconds: 900,
      keyring: ring,
      currentKeyId: 1,
      now,
    });
    expect(expiresAt).toBe(Math.floor(now.getTime() / 1000) + 900);
  });

  it('token po uplynutí TTL skončí kódem token_expired, ne signature_invalid', () => {
    const { token } = mintIdentityToken({
      ...base,
      ttlSeconds: 900,
      keyring: ring,
      currentKeyId: 1,
      now,
    });
    const later = new Date(now.getTime() + 901_000);
    expect(verifyTrackingToken(token, ['i'], { keyring: ring, now: later })).toEqual({
      ok: false,
      code: 'token_expired',
    });
  });

  it('dvě volání dají různý nonce, tedy různý token', () => {
    const a = mintIdentityToken({ ...base, ttlSeconds: 900, keyring: ring, currentKeyId: 1, now });
    const b = mintIdentityToken({ ...base, ttlSeconds: 900, keyring: ring, currentKeyId: 1, now });
    expect(a.token).not.toBe(b.token);
    expect(Buffer.from(a.nonce).equals(Buffer.from(b.nonce))).toBe(false);
  });

  it('nonce má přesně 8 bajtů', () => {
    const { nonce } = mintIdentityToken({
      ...base,
      ttlSeconds: 900,
      keyring: ring,
      currentKeyId: 1,
      now,
    });
    expect(nonce).toHaveLength(8);
  });

  it('dekódovaný payload má 60 bajtů a nenese žádný vstup v textové podobě', () => {
    const { token } = mintIdentityToken({
      ...base,
      ttlSeconds: 900,
      keyring: ring,
      currentKeyId: 1,
      now,
    });
    const raw = Buffer.from(token.slice(2), 'base64url');
    const payload = raw.subarray(2, raw.length - 16);
    expect(payload).toHaveLength(60);

    // Hledá se textová podoba vstupů, ne jednotlivé bajty. Kontrola na znak '@'
    // by byla nesmyslná: 0x40 je běžný bajt UUID (verze 7 dá `...-7e40-...`),
    // takže by padala vždycky, a správná implementace by úkolem neprošla.
    for (const value of [base.workspaceId, base.contactId, base.campaignId]) {
      expect(payload.includes(Buffer.from(value, 'ascii'))).toBe(false);
      expect(payload.includes(Buffer.from(value.replace(/-/g, ''), 'ascii'))).toBe(false);
    }
  });

  it('změna bitu v contact_id zneplatní podpis', () => {
    const { token } = mintIdentityToken({
      ...base,
      ttlSeconds: 900,
      keyring: ring,
      currentKeyId: 1,
      now,
    });
    const raw = Buffer.from(token.slice(2), 'base64url');
    raw.writeUInt8(raw.readUInt8(2 + 16) ^ 0x01, 2 + 16); // první bajt contact_id
    const tampered = `t1${raw.toString('base64url')}`;
    expect(verifyTrackingToken(tampered, ['i'], { keyring: ring, now })).toEqual({
      ok: false,
      code: 'token_signature_invalid',
    });
  });

  it('10 000 náhodných round-tripů projde', () => {
    for (let i = 0; i < 10_000; i += 1) {
      const { token } = mintIdentityToken({
        ...base,
        ttlSeconds: 900,
        keyring: ring,
        currentKeyId: 1,
        now,
      });
      expect(verifyTrackingToken(token, ['i'], { keyring: ring, now }).ok).toBe(true);
    }
  });
});
