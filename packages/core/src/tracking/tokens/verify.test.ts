import { describe, expect, it } from 'vitest';
import { buildTrackingKeyring } from './keyring';
import { verifyTrackingToken } from './verify';

const TEST_SECRET_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const ring = buildTrackingKeyring({ secretKey: TEST_SECRET_KEY, secretKeyPrevious: '' });

const OPEN = 't1bwEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2Bxgmpk3YDUjmcTwPYu1Q9cpqmSPs4g';
const CLICK =
  't1YwEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2BxggGS86AcLX5CnD1OX2BxgpNqZN2Aa8TprBxqhsgbR6l5AMMNpw';
const now = new Date('2026-07-25T16:00:00Z');

describe('verifyTrackingToken', () => {
  it('ověří open token z vektoru části 1 a vrátí rozparsovaná pole', () => {
    const result = verifyTrackingToken(OPEN, ['o'], { keyring: ring, now });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.keyId).toBe(1);
    expect(result.fields).toEqual({
      type: 'o',
      workspaceId: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071',
      messageId: '0192f3a0-1c2d-7e41-8b2c-3d4e5f607182',
      messageCreatedAt: 1784995200,
    });
  });

  it('open token na click endpointu skončí kódem token_type_mismatch', () => {
    const result = verifyTrackingToken(OPEN, ['c'], { keyring: ring, now });
    expect(result).toEqual({ ok: false, code: 'token_type_mismatch' });
  });

  it('token bez prefixu t1 je token_malformed', () => {
    const result = verifyTrackingToken(OPEN.slice(2), ['o'], { keyring: ring, now });
    expect(result).toEqual({ ok: false, code: 'token_malformed' });
  });

  it('změna bitu uvnitř MAC vede na token_signature_invalid, ne na malformed', () => {
    // Bit se překlápí v BAJTU, ne v posledním znaku. Poslední znak base64url
    // u payloadu typu `c` nese jen čtyři významné bity, takže jeho změna
    // nechá nenulové zbytkové bity, neprojde kanonickou kontrolou z kroku 2
    // a skončí jako token_malformed. Ověřeno spuštěním: očekávat u ní podpis
    // by znamenalo test, na kterém padne správná implementace.
    const raw = Buffer.from(CLICK.slice(2), 'base64url');
    raw.writeUInt8(raw.readUInt8(raw.length - 3) ^ 0x01, raw.length - 3);
    const tampered = `t1${raw.toString('base64url')}`;
    const result = verifyTrackingToken(tampered, ['c'], { keyring: ring, now });
    expect(result).toEqual({ ok: false, code: 'token_signature_invalid' });
  });

  it('změna posledního znaku je naopak token_malformed, protože nesedí zbytkové bity', () => {
    const flipped = `${CLICK.slice(0, -1)}${CLICK.endsWith('w') ? 'x' : 'w'}`;
    const result = verifyTrackingToken(flipped, ['c'], { keyring: ring, now });
    expect(result).toEqual({ ok: false, code: 'token_malformed' });
  });

  it('base64 se standardní abecedou je token_malformed', () => {
    const result = verifyTrackingToken('t1bw+B/kvOg', ['o'], { keyring: ring, now });
    expect(result).toEqual({ ok: false, code: 'token_malformed' });
  });

  it('base64url s paddingem je token_malformed', () => {
    const result = verifyTrackingToken(`${OPEN}=`, ['o'], { keyring: ring, now });
    expect(result).toEqual({ ok: false, code: 'token_malformed' });
  });

  it('payload zkrácený o bajt je token_malformed', () => {
    const raw = Buffer.from(OPEN.slice(2), 'base64url');
    const short = `t1${raw.subarray(0, raw.length - 1).toString('base64url')}`;
    const result = verifyTrackingToken(short, ['o'], { keyring: ring, now });
    expect(result).toEqual({ ok: false, code: 'token_malformed' });
  });

  it('neznámý key_id je token_unknown_key a nikdy se u něj nepočítá MAC', () => {
    const raw = Buffer.from(OPEN.slice(2), 'base64url');
    raw[1] = 9;
    const result = verifyTrackingToken(`t1${raw.toString('base64url')}`, ['o'], {
      keyring: ring,
      now,
    });
    expect(result).toEqual({ ok: false, code: 'token_unknown_key' });
  });

  it('message_created_at se nikdy nekontroluje proti expiraci', () => {
    const farFuture = new Date('2099-01-01T00:00:00Z');
    expect(verifyTrackingToken(OPEN, ['o'], { keyring: ring, now: farFuture }).ok).toBe(true);
  });
});
