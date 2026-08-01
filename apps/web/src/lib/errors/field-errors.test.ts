import { describe, expect, it } from 'vitest';
import type { Problem } from '@/lib/api-client/problem';
import { fieldErrorsFrom, firstErrorField, formLevelErrors } from './field-errors';

function problem(overrides: Partial<Problem>): Problem {
  return {
    type: 'https://docs.mlain.dev/errors/validation_failed',
    title: 'Validation failed',
    status: 422,
    detail: 'Tělo neprošlo schématem.',
    instance: '/api/v1/api-keys',
    code: 'validation_failed',
    request_id: 'req_1',
    ...overrides,
  };
}

describe('fieldErrorsFrom', () => {
  it('seskupí hlášky podle path', () => {
    const result = fieldErrorsFrom(
      problem({
        errors: [
          { path: 'name', code: 'too_short', message: 'Název je moc krátký.' },
          { path: 'scopes', code: 'unknown_scope', message: 'Neznámé oprávnění.' },
          { path: 'name', code: 'invalid_chars', message: 'Nepovolený znak.' },
        ],
      }),
    );
    expect(result).toEqual({
      name: ['Název je moc krátký.', 'Nepovolený znak.'],
      scopes: ['Neznámé oprávnění.'],
    });
  });

  it('u jiného kódu než validation_failed vrátí prázdnou mapu', () => {
    expect(
      fieldErrorsFrom(
        problem({ code: 'forbidden', errors: [{ path: 'x', code: 'y', message: 'z' }] }),
      ),
    ).toEqual({});
  });

  it('prázdnou path zařadí pod klíč formuláře', () => {
    const result = fieldErrorsFrom(
      problem({ errors: [{ path: '', code: 'x', message: 'Chyba formuláře.' }] }),
    );
    expect(formLevelErrors(result)).toEqual(['Chyba formuláře.']);
  });

  it('hlavičku Idempotency-Key mapuje na klíč formuláře, ne na pole', () => {
    const result = fieldErrorsFrom(
      problem({
        errors: [{ path: 'Idempotency-Key', code: 'missing', message: 'Chybí hlavička.' }],
      }),
    );
    expect(formLevelErrors(result)).toEqual(['Chybí hlavička.']);
  });
});

describe('firstErrorField', () => {
  it('vrátí první pole v pořadí, v jakém přišlo ze serveru', () => {
    const result = fieldErrorsFrom(
      problem({
        errors: [
          { path: 'timezone', code: 'a', message: 'a' },
          { path: 'name', code: 'b', message: 'b' },
        ],
      }),
    );
    expect(firstErrorField(result)).toBe('timezone');
  });

  it('u prázdné mapy vrátí undefined', () => {
    expect(firstErrorField({})).toBeUndefined();
  });
});
