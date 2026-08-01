import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CONFIRMATION_TOKEN_LENGTH,
  canResendConfirmation,
  classifyConfirmation,
  confirmationExpiresAt,
  generateConfirmationToken,
  hashConfirmationToken,
} from '../../lists/confirmation';

describe('generateConfirmationToken', () => {
  it('vydá 43 znaků base64url bez paddingu', () => {
    const { token } = generateConfirmationToken();
    expect(token).toHaveLength(CONFIRMATION_TOKEN_LENGTH);
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).not.toContain('=');
  });

  it('vrací hash, který odpovídá sha256 syrového tokenu', () => {
    const { token, tokenHash } = generateConfirmationToken();
    expect(tokenHash).toHaveLength(32);
    expect(tokenHash.equals(createHash('sha256').update(token, 'utf8').digest())).toBe(true);
  });

  it('tisíc tokenů je tisíc různých hodnot', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) seen.add(generateConfirmationToken().token);
    expect(seen.size).toBe(1000);
  });

  it('hashConfirmationToken je deterministický', () => {
    expect(hashConfirmationToken('abc').equals(hashConfirmationToken('abc'))).toBe(true);
    expect(hashConfirmationToken('abc').equals(hashConfirmationToken('abd'))).toBe(false);
  });
});

describe('confirmationExpiresAt', () => {
  it('přičte TTL v hodinách', () => {
    const now = new Date('2026-07-31T10:00:00.000Z');
    expect(confirmationExpiresAt(now, 168).toISOString()).toBe('2026-08-07T10:00:00.000Z');
    expect(confirmationExpiresAt(now, 1).toISOString()).toBe('2026-07-31T11:00:00.000Z');
  });
});

describe('classifyConfirmation', () => {
  const now = new Date('2026-07-31T10:00:00.000Z');

  it('neexistující řádek je unknown', () => {
    expect(classifyConfirmation(null, now)).toBe('unknown');
  });

  it('spotřebovaný token je consumed, i když ještě neprošel', () => {
    expect(
      classifyConfirmation(
        {
          expiresAt: new Date('2026-08-07T10:00:00Z'),
          consumedAt: new Date('2026-07-30T10:00:00Z'),
        },
        now,
      ),
    ).toBe('consumed');
  });

  it('spotřebování má přednost před expirací', () => {
    expect(
      classifyConfirmation(
        {
          expiresAt: new Date('2026-07-01T10:00:00Z'),
          consumedAt: new Date('2026-06-30T10:00:00Z'),
        },
        now,
      ),
    ).toBe('consumed');
  });

  it('prošlý nespotřebovaný token je expired', () => {
    expect(
      classifyConfirmation({ expiresAt: new Date('2026-07-31T09:59:59Z'), consumedAt: null }, now),
    ).toBe('expired');
  });

  it('platný token je valid', () => {
    expect(
      classifyConfirmation({ expiresAt: new Date('2026-07-31T10:00:01Z'), consumedAt: null }, now),
    ).toBe('valid');
  });
});

describe('canResendConfirmation', () => {
  const now = new Date('2026-07-31T10:00:00.000Z');

  it('první odeslání projde', () => {
    expect(
      canResendConfirmation({ lastSentAt: null, resendsIn24h: 0, maxResends: 3, now }),
    ).toEqual({ ok: true });
  });

  it('dřív než za 5 minut od posledního e-mailu neprojde', () => {
    const result = canResendConfirmation({
      lastSentAt: new Date('2026-07-31T09:58:00Z'),
      resendsIn24h: 1,
      maxResends: 3,
      now,
    });
    expect(result).toEqual({
      ok: false,
      code: 'confirmation_resend_too_soon',
      retryAfterMs: 180_000,
    });
  });

  it('přesně po 5 minutách projde', () => {
    expect(
      canResendConfirmation({
        lastSentAt: new Date('2026-07-31T09:55:00Z'),
        resendsIn24h: 1,
        maxResends: 3,
        now,
      }),
    ).toEqual({ ok: true });
  });

  it('po vyčerpání limitu za 24 hodin neprojde', () => {
    const result = canResendConfirmation({
      lastSentAt: new Date('2026-07-31T09:00:00Z'),
      resendsIn24h: 3,
      maxResends: 3,
      now,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('confirmation_resend_limit');
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('maxResends 0 zakáže i první opakování, ale ne první odeslání', () => {
    expect(
      canResendConfirmation({ lastSentAt: null, resendsIn24h: 0, maxResends: 0, now }),
    ).toEqual({ ok: true });
    expect(
      canResendConfirmation({
        lastSentAt: new Date('2026-07-31T09:00:00Z'),
        resendsIn24h: 0,
        maxResends: 0,
        now,
      }).ok,
    ).toBe(false);
  });
});
