import { describe, it, expect } from 'vitest';
import { z } from '@hono/zod-openapi';
import { ApiError } from '@mlain/core/errors/api-error';
import { zodIssuesToValidationErrors, parseStrict } from './validation';

const Schema = z
  .object({
    email: z.email(),
    attributes: z.object({ age: z.number() }).optional(),
  })
  .strict();

describe('parseStrict', () => {
  it('propustí platné tělo', () => {
    expect(parseStrict(Schema, { email: 'a@b.cz' })).toEqual({ email: 'a@b.cz' });
  });

  it('neznámý klíč odmítne s validation_failed, ne s 201', () => {
    try {
      parseStrict(Schema, { email: 'a@b.cz', emial: 'preklep' });
      expect.unreachable('mělo hodit');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      const err = e as ApiError;
      expect(err.status).toBe(422);
      expect(err.code).toBe('validation_failed');
      expect(JSON.stringify(err.errors)).toContain('emial');
    }
  });

  it('cesta je tečková notace bez úvodního lomítka', () => {
    try {
      parseStrict(Schema, { email: 'a@b.cz', attributes: { age: 'sedm' } });
      expect.unreachable('mělo hodit');
    } catch (e) {
      expect((e as ApiError).errors?.map((x) => x.path)).toContain('attributes.age');
    }
  });

  it('každá vadná položka má vlastní záznam v errors', () => {
    try {
      parseStrict(Schema, { email: 'neni-email', attributes: { age: 'sedm' } });
      expect.unreachable('mělo hodit');
    } catch (e) {
      expect((e as ApiError).errors?.length).toBe(2);
    }
  });
});

describe('zodIssuesToValidationErrors', () => {
  it('prázdná cesta se mapuje na prázdný řetězec, ne na undefined', () => {
    const result = Schema.safeParse('nejsem objekt');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(zodIssuesToValidationErrors(result.error.issues)[0]!.path).toBe('');
    }
  });

  it('index pole se píše tečkou, ne hranatou závorkou', () => {
    const ArraySchema = z.object({ tags: z.array(z.string()) }).strict();
    const result = ArraySchema.safeParse({ tags: ['a', 7] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(zodIssuesToValidationErrors(result.error.issues)[0]!.path).toBe('tags.1');
    }
  });
});
