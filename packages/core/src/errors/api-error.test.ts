import { describe, it, expect } from 'vitest';
import { ApiError, notFound, forbidden, insufficientScope, validationFailed } from './api-error';
import { resolveDetail } from './detail-catalog';
import { ERROR_CODES } from './registry';

describe('ApiError', () => {
  it('doplní status a title z registru kódů', () => {
    const err = new ApiError('not_found');
    expect(err.status).toBe(404);
    expect(err.title).toBe('Not found');
    expect(err.code).toBe('not_found');
  });

  it('odmítne kód, který v registru není', () => {
    expect(() => new ApiError('kod_ktery_neexistuje' as never)).toThrow(/neregistrovaný/i);
  });

  it('nese params a retryAfter', () => {
    const err = new ApiError('rate_limited', { retryAfter: 37, params: { limit: 300 } });
    expect(err.retryAfter).toBe(37);
    expect(err.params).toEqual({ limit: 300 });
  });

  it('errors je povolené jen u validation_failed', () => {
    expect(
      () => new ApiError('not_found', { errors: [{ path: 'email', code: 'x', message: 'y' }] }),
    ).toThrow(/validation_failed/);
  });

  it('4xx s findings musí obsahovat aspoň jeden nález se severity error', () => {
    expect(
      () =>
        new ApiError('conflict', {
          findings: [{ code: 'a', severity: 'warning', message: 'jen varování' }],
        }),
    ).toThrow(/severity/i);
  });

  it('findings s aspoň jednou chybou projdou', () => {
    const err = new ApiError('conflict', {
      findings: [
        { code: 'a', severity: 'error', message: 'blokuje' },
        { code: 'b', severity: 'warning', message: 'jen varuje' },
      ],
    });
    expect(err.findings).toHaveLength(2);
  });

  it('zkratky vracejí správné kódy', () => {
    expect(notFound().code).toBe('not_found');
    expect(forbidden().code).toBe('forbidden');
    expect(insufficientScope().code).toBe('insufficient_scope');
    expect(validationFailed([{ path: 'email', code: 'invalid_email', message: 'x' }]).status).toBe(
      422,
    );
  });
});

describe('detail catalog', () => {
  it('vrátí český text pro známý kód', () => {
    expect(resolveDetail('not_found', 'cs')).toBe('Požadovaný záznam neexistuje.');
  });

  it('spadne zpět na en, když katalog pro jazyk neexistuje', () => {
    expect(resolveDetail('method_not_allowed', 'zz')).toBe(
      resolveDetail('method_not_allowed', 'en'),
    );
  });

  it('en-GB se mapuje na katalog en', () => {
    expect(resolveDetail('forbidden', 'en-GB')).toBe(resolveDetail('forbidden', 'en'));
  });

  it('má text pro každý kód z registru', () => {
    const missing = Object.keys(ERROR_CODES).filter((c) => resolveDetail(c, 'en') === c);
    expect(missing).toEqual([]);
  });
});
