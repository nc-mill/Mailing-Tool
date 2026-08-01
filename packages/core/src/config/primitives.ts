import { z } from 'zod';

/** Ukázkový klíč z dokumentace. Odmítá se, aby nikdo nenasadil produkci s klíčem z README. */
export const EXAMPLE_SECRET_KEYS = new Set([
  '1:ZXhhbXBsZS1rZXktZG8tbm90LXVzZS1pbi1wcm9kdWN0aW9u',
  'ZXhhbXBsZS1rZXktZG8tbm90LXVzZS1pbi1wcm9kdWN0aW9u',
]);

export const envBool = (): z.ZodType<boolean> =>
  z.union([z.boolean(), z.enum(['true', 'false', '1', '0'])]).transform((value) => {
    if (typeof value === 'boolean') return value;
    return value === 'true' || value === '1';
  });

export const envInt = (min: number, max: number): z.ZodType<number> =>
  z
    .union([z.number(), z.string().regex(/^-?\d+$/, 'musí být celé číslo')])
    .transform((value) => (typeof value === 'number' ? value : Number.parseInt(value, 10)))
    .refine((value) => Number.isInteger(value), 'musí být celé číslo')
    .refine((value) => value >= min && value <= max, `musí být v rozsahu ${min} až ${max}`);

export const envFloat = (min: number, max: number): z.ZodType<number> =>
  z
    .union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/, 'musí být číslo')])
    .transform((value) => (typeof value === 'number' ? value : Number.parseFloat(value)))
    .refine((value) => value >= min && value <= max, `musí být v rozsahu ${min} až ${max}`);

/** Seznam oddělený čárkami. Prázdný řetězec dá prázdné pole, ne pole s prázdným prvkem. */
export const envCsv = (): z.ZodType<string[]> =>
  z.string().transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

export const envUrl = (): z.ZodType<string> =>
  z
    .string()
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    }, 'musí být absolutní URL s http nebo https')
    .refine((value) => !value.endsWith('/'), 'nesmí končit lomítkem');

export const envPostgresUrl = (): z.ZodType<string> =>
  z.string().refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'postgres:' || url.protocol === 'postgresql:';
    } catch {
      return false;
    }
  }, 'musí být připojovací řetězec postgres://');

export const envTimezone = (): z.ZodType<string> =>
  z.string().refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'musí být platná IANA časová zóna');

/** Pět nebo šest polí. Prázdná hodnota je povolená a znamená "vypnuto". */
export const envCron = (): z.ZodType<string> =>
  z
    .string()
    .refine(
      (value) => value === '' || [5, 6].includes(value.trim().split(/\s+/).length),
      'musí být cron výraz s pěti nebo šesti poli, nebo prázdný pro vypnutí',
    );

export interface KeyGeneration {
  readonly keyId: number;
  readonly key: Uint8Array;
  readonly raw: string;
}

function parseKeyGeneration(value: string, allowBareKey: boolean): KeyGeneration {
  const separator = value.indexOf(':');
  const hasId = separator > 0;
  if (!hasId && !allowBareKey) {
    throw new Error('musí mít tvar <key_id>:<base64url>');
  }
  const keyId = hasId ? Number.parseInt(value.slice(0, separator), 10) : 1;
  const encoded = hasId ? value.slice(separator + 1) : value;
  if (!Number.isInteger(keyId) || keyId < 1 || keyId > 255) {
    throw new Error(
      'key_id musí být celé číslo 1 až 255, protože formát tokenu i obálky má jeden bajt',
    );
  }
  const key = Buffer.from(encoded, 'base64url');
  if (key.length !== 32) {
    throw new Error(`po dekódování musí mít přesně 32 bajtů, má ${key.length}`);
  }
  return { keyId, key: new Uint8Array(key), raw: value };
}

export const envSecretKey = (): z.ZodType<KeyGeneration> =>
  z.string().transform((value, ctx) => {
    if (EXAMPLE_SECRET_KEYS.has(value)) {
      ctx.addIssue({ code: 'custom', message: 'je ukázkový klíč z dokumentace a nesmí se použít' });
      return z.NEVER;
    }
    try {
      return parseKeyGeneration(value, true);
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: (error as Error).message });
      return z.NEVER;
    }
  });

/**
 * Čárkou oddělený seznam starších pokolení. BEZ HORNÍHO POČTU POLOŽEK.
 * Strop by znamenal, že po jeho vyčerpání přestanou platit otisky smazaných
 * adres v suppression listu a smazaný člověk se vrátí prvním dalším importem,
 * aniž by cokoliv selhalo (část 1, kapitola 3.10).
 */
export const envPreviousKeys = (): z.ZodType<KeyGeneration[]> =>
  z.string().transform((value, ctx) => {
    const items = value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    const parsed: KeyGeneration[] = [];
    for (const item of items) {
      try {
        parsed.push(parseKeyGeneration(item, false));
      } catch (error) {
        ctx.addIssue({ code: 'custom', message: `položka "${item}": ${(error as Error).message}` });
      }
    }
    return parsed;
  });
