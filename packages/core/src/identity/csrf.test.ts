import { describe, it, expect } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';
import { ApiError } from '../errors/api-error';
import { csrfTokenFor, assertCsrfToken, assertOrigin, CSRF_HEADER } from './csrf';

const secret = randomBytes(32);

describe('double submit token', () => {
  it('token je base64url(HMAC-SHA256(csrf_secret, "csrf"))', () => {
    const expected = createHmac('sha256', secret).update('csrf', 'ascii').digest('base64url');
    expect(csrfTokenFor(secret)).toBe(expected);
  });

  it('hlavička se jmenuje X-CSRF-Token', () => {
    expect(CSRF_HEADER).toBe('X-CSRF-Token');
  });

  it('správný token projde', () => {
    expect(() => assertCsrfToken(secret, csrfTokenFor(secret))).not.toThrow();
  });

  it('chybějící token končí 403 csrf_token_invalid', () => {
    try {
      assertCsrfToken(secret, undefined);
      expect.unreachable('mělo hodit');
    } catch (e) {
      const err = e as ApiError;
      expect(err.code).toBe('csrf_token_invalid');
      expect(err.status).toBe(403);
    }
  });

  it('token jiné session neprojde', () => {
    expect(() => assertCsrfToken(secret, csrfTokenFor(randomBytes(32)))).toThrow(ApiError);
  });

  it('token jiné délky neprojde a nespadne na výjimce timingSafeEqual', () => {
    expect(() => assertCsrfToken(secret, 'kratky')).toThrow(ApiError);
  });
});

describe('kontrola Origin', () => {
  const appUrl = 'https://mail.example.cz';

  it('GET se nekontroluje', () => {
    expect(() => assertOrigin('GET', null, appUrl)).not.toThrow();
    expect(() => assertOrigin('HEAD', null, appUrl)).not.toThrow();
    expect(() => assertOrigin('OPTIONS', null, appUrl)).not.toThrow();
  });

  it('shodný Origin projde', () => {
    expect(() => assertOrigin('POST', 'https://mail.example.cz', appUrl)).not.toThrow();
  });

  it('chybějící Origin u non-GET končí 403', () => {
    try {
      assertOrigin('POST', null, appUrl);
      expect.unreachable('mělo hodit');
    } catch (e) {
      expect((e as ApiError).code).toBe('origin_not_allowed');
    }
  });

  it('cizí Origin končí 403', () => {
    expect(() => assertOrigin('POST', 'https://zly.example.com', appUrl)).toThrow(ApiError);
  });

  it('shodný host s jiným schématem neprojde', () => {
    expect(() => assertOrigin('POST', 'http://mail.example.cz', appUrl)).toThrow(ApiError);
  });

  it('shodný host s jiným portem neprojde', () => {
    expect(() => assertOrigin('POST', 'https://mail.example.cz:8443', appUrl)).toThrow(ApiError);
  });
});
