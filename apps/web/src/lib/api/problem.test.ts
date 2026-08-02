import { describe, it, expect } from 'vitest';
import { HTTPException } from 'hono/http-exception';
import { ApiError } from '@mlain/core/errors/api-error';
import { toProblem, PROBLEM_CONTENT_TYPE } from './problem';
import { resolveRequestId } from './request-id';

const REQ = {
  path: '/api/v1/contacts',
  requestId: '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071',
  acceptLanguage: 'cs',
};

describe('toProblem', () => {
  it('vyrobí úplnou obálku podle 4.2', () => {
    const { body, status, headers } = toProblem(new ApiError('not_found'), REQ);
    expect(status).toBe(404);
    expect(headers['Content-Type']).toBe(PROBLEM_CONTENT_TYPE);
    expect(body).toEqual({
      type: 'https://docs.mlain.dev/errors/not_found',
      title: 'Not found',
      status: 404,
      detail: 'Požadovaný záznam neexistuje.',
      instance: '/api/v1/contacts',
      code: 'not_found',
      request_id: REQ.requestId,
    });
  });

  it('title je vždy anglicky bez ohledu na Accept-Language', () => {
    const { body } = toProblem(new ApiError('forbidden'), { ...REQ, acceptLanguage: 'cs' });
    expect(body.title).toBe('Forbidden');
  });

  it('detail respektuje Accept-Language', () => {
    const { body } = toProblem(new ApiError('forbidden'), {
      ...REQ,
      acceptLanguage: 'en-GB,en;q=0.9',
    });
    expect(body.detail).toBe('Your role does not allow this action.');
  });

  it('přenese params a retry_after do těla i do hlavičky', () => {
    const { body, headers } = toProblem(
      new ApiError('rate_limited', { retryAfter: 37, params: { limit: 300 } }),
      REQ,
    );
    expect(body.retry_after).toBe(37);
    expect(body.params).toEqual({ limit: 300 });
    expect(headers['Retry-After']).toBe('37');
  });

  it('přenese errors u validation_failed', () => {
    const { body } = toProblem(
      new ApiError('validation_failed', {
        errors: [
          { path: 'email', code: 'invalid_email', message: 'Není platná e-mailová adresa.' },
        ],
      }),
      REQ,
    );
    expect(body.errors).toHaveLength(1);
    expect(body.errors![0]!.path).toBe('email');
  });

  // Rozbité tělo je chyba klienta. Dokud padalo na internal_error, dostal
  // volající 5xx („zkus to znovu") na něco, co si musí opravit sám, a v logu
  // z toho byl incident. Text od frameworku může nést kus těla, ven nesmí.
  it('nečitelné tělo požadavku je 422 od klienta, ne 500 od serveru', () => {
    const { body, status } = toProblem(
      new HTTPException(400, { message: 'Malformed JSON in request body' }),
      REQ,
    );
    expect(status).toBe(422);
    expect(body.code).toBe('validation_failed');
    expect(body.errors?.[0]?.path).toBe('body');
    expect(JSON.stringify(body)).not.toContain('Malformed JSON');
  });

  it('chybu frameworku od 500 výš nechává jako internal_error', () => {
    const { body, status } = toProblem(
      new HTTPException(500, { message: 'nitro frameworku' }),
      REQ,
    );
    expect(status).toBe(500);
    expect(body.code).toBe('internal_error');
    expect(JSON.stringify(body)).not.toContain('nitro frameworku');
  });

  it('neznámou chybu přeloží na internal_error a nikdy nevyzradí příčinu', () => {
    const { body, status } = toProblem(
      new Error('select * from users where password_hash = $1'),
      REQ,
    );
    expect(status).toBe(500);
    expect(body.code).toBe('internal_error');
    expect(JSON.stringify(body)).not.toContain('password_hash');
    expect(JSON.stringify(body)).not.toContain('select');
  });
});

describe('resolveRequestId', () => {
  it('převezme platnou hodnotu z hlavičky', () => {
    expect(resolveRequestId('abc.def-123')).toBe('abc.def-123');
  });

  it('odmítne příliš krátkou hodnotu a vygeneruje UUIDv7', () => {
    const id = resolveRequestId('short');
    expect(id).not.toBe('short');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('odmítne hodnotu s nepovoleným znakem', () => {
    expect(resolveRequestId('abc def gh')).not.toBe('abc def gh');
  });

  it('bez hlavičky vygeneruje UUIDv7', () => {
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f]{8}-/);
  });
});
