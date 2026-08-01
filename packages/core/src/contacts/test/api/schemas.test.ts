import { describe, expect, it } from 'vitest';
import { z } from '@hono/zod-openapi';
import {
  CountResponseSchema,
  EmailInput,
  IsoDateTime,
  cursorQuery,
  paginated,
  toFieldErrors,
  toIso,
} from '../../api/schemas';
import { contactsApi } from '../../api/index';

describe('IsoDateTime', () => {
  it('přijme čas v UTC s milisekundami a Z', () => {
    expect(IsoDateTime.parse('2026-07-31T10:15:30.000Z')).toBe('2026-07-31T10:15:30.000Z');
  });

  it.each([
    '2026-07-31T10:15:30Z',
    '2026-07-31T10:15:30.000+02:00',
    '2026-07-31 10:15:30.000Z',
    '2026-07-31',
  ])('odmítne %s', (value) => {
    expect(() => IsoDateTime.parse(value)).toThrow();
  });

  it('toIso vrací tvar, který schéma přijme', () => {
    expect(IsoDateTime.parse(toIso(new Date('2026-07-31T10:15:30Z')))).toBe(
      '2026-07-31T10:15:30.000Z',
    );
  });

  it('toIso z null vrací null', () => {
    expect(toIso(null)).toBeNull();
  });

  it('toIso zvládne i řetězec z ovladače, ne jen Date', () => {
    expect(toIso('2026-07-31T10:15:30.000Z')).toBe('2026-07-31T10:15:30.000Z');
  });
});

describe('EmailInput', () => {
  it('vrací normalizovanou adresu, ne tu vstupní', () => {
    expect(EmailInput.parse('  <Jan.Novak@Example.COM>  ')).toBe('jan.novak@example.com');
  });

  it('neplatnou adresu odmítne kódem invalid_email', () => {
    const result = EmailInput.safeParse('jan@');
    expect(result.success).toBe(false);
    if (!result.success) expect(toFieldErrors(result.error)[0]!.code).toBe('invalid_email');
  });

  it('dlouhou adresu odmítne kódem email_too_long', () => {
    const result = EmailInput.safeParse(`${'a'.repeat(250)}@x.cz`);
    expect(result.success).toBe(false);
    if (!result.success) expect(toFieldErrors(result.error)[0]!.code).toBe('email_too_long');
  });
});

describe('cursorQuery', () => {
  const query = cursorQuery(['created_at.desc', 'created_at.asc'], 'created_at.desc');

  it('doplní výchozí limit i řazení', () => {
    expect(query.parse({})).toEqual({ limit: 50, order: 'created_at.desc' });
  });

  it('převede limit z řetězce, protože query string nemá čísla', () => {
    expect(query.parse({ limit: '25' }).limit).toBe(25);
  });

  it('odmítne limit nad stropem', () => {
    expect(() => query.parse({ limit: '500' })).toThrow();
  });

  it('odmítne řazení, které nemá krycí index', () => {
    expect(() => query.parse({ order: 'email.asc' })).toThrow();
  });
});

describe('obálka stránkování', () => {
  const schema = paginated(z.object({ id: z.string() }), 'TestPage');

  it('má data a pagination se čtyřmi klíči', () => {
    const parsed = schema.parse({
      data: [{ id: 'a' }],
      pagination: { next_cursor: 'c1', prev_cursor: null, has_more: true, limit: 50 },
    });
    expect(Object.keys(parsed.pagination).sort()).toEqual([
      'has_more',
      'limit',
      'next_cursor',
      'prev_cursor',
    ]);
  });

  it('nikdy nevrací celkový počet', () => {
    const parsed = schema.parse({
      data: [],
      pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 50, total: 99 },
    });
    expect(parsed.pagination).not.toHaveProperty('total');
  });
});

describe('CountResponseSchema', () => {
  it('má počet, přesnost, čas výpočtu a příznak zastaralosti', () => {
    const value = {
      count: 4211,
      precision: 'estimated',
      computed_at: '2026-07-31T10:15:30.000Z',
      stale: true,
    };
    expect(CountResponseSchema.parse(value)).toEqual(value);
  });

  it('odmítne neznámou přesnost', () => {
    expect(() =>
      CountResponseSchema.parse({
        count: 1,
        precision: 'roughly',
        computed_at: '2026-07-31T10:15:30.000Z',
        stale: false,
      }),
    ).toThrow();
  });
});

describe('toFieldErrors', () => {
  const body = z
    .object({ email: z.string(), age: z.number(), tags: z.array(z.string()).max(2) })
    .strict();

  it('z neznámého klíče udělá unknown_field_key s názvem klíče', () => {
    const result = body.safeParse({ email: 'a@b.cz', age: 1, tags: [], nope: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toFieldErrors(result.error)).toContainEqual(
        expect.objectContaining({ path: 'nope', code: 'unknown_field_key' }),
      );
    }
  });

  it('z chybějícího klíče udělá required_field_missing', () => {
    const result = body.safeParse({ email: 'a@b.cz', tags: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toFieldErrors(result.error)).toContainEqual(
        expect.objectContaining({ path: 'age', code: 'required_field_missing' }),
      );
    }
  });

  it('z příliš dlouhého pole udělá too_many_items', () => {
    const result = body.safeParse({ email: 'a@b.cz', age: 1, tags: ['a', 'b', 'c'] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toFieldErrors(result.error)).toContainEqual(
        expect.objectContaining({ path: 'tags', code: 'too_many_items' }),
      );
    }
  });

  it('cestu do vnořeného objektu spojí tečkou', () => {
    const nested = z.object({ consent: z.array(z.object({ purpose: z.string() })) });
    const result = nested.safeParse({ consent: [{ purpose: 1 }] });
    expect(result.success).toBe(false);
    if (!result.success) expect(toFieldErrors(result.error)[0]!.path).toBe('consent.0.purpose');
  });

  it('nikdy nevrátí prázdné pole, i když zod issue nezná', () => {
    const error = new z.ZodError([]);
    expect(toFieldErrors(error)).toEqual([
      { path: '', code: 'invalid_value', message: 'Neplatná hodnota.' },
    ]);
  });
});

describe('contactsApi', () => {
  it('je router, do kterého se dají mountovat další routery', () => {
    expect(typeof contactsApi.route).toBe('function');
    expect(typeof contactsApi.request).toBe('function');
  });
});
