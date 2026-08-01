import { describe, expect, it } from 'vitest';
import type { ValidationIssue } from '../../../errors/api-error';
import {
  CONTACT_ATTRIBUTES_MAX_BYTES,
  CONTACT_FIELD_LIMIT,
  CONTACT_INDEXED_FIELD_LIMIT,
  RESERVED_FIELD_KEYS,
  assertAttributesSize,
  assertFieldKeyAllowed,
} from '../../fields/limits';

/**
 * ODCHYLKA OD PLÁNU, VYNUCENÁ TVAREM CHYBY Z P04. Plán psal `.toThrow(/field_key_reserved/)`.
 * `ApiError` má ale `message` rovnou KÓDU (`validation_failed`) a doménová příčina leží
 * v poli `errors[].code`, protože text se skládá až ve vrstvě HTTP podle Accept-Language.
 * Regulární výraz nad zprávou by se tedy nikdy neshodl a test by procházel i nad funkcí,
 * která nekontroluje nic. Testuje se proto kód nálezu.
 */
function issueCodes(fn: () => void): string[] {
  try {
    fn();
  } catch (error) {
    return ((error as { errors?: ValidationIssue[] }).errors ?? []).map((e) => e.code);
  }
  return [];
}

describe('limity vlastních polí', () => {
  it('sto polí na projekt, osm indexovaných', () => {
    expect(CONTACT_FIELD_LIMIT).toBe(100);
    expect(CONTACT_INDEXED_FIELD_LIMIT).toBe(8);
  });
});

describe('assertFieldKeyAllowed', () => {
  it.each(['city', 'order_total', 'a', 'a1_b2'])('povolí klíč %s', (key) => {
    expect(() => assertFieldKeyAllowed(key)).not.toThrow();
  });

  it.each(['Město', '1city', '_city', 'city-name', 'a'.repeat(41), ''])(
    'odmítne klíč %s',
    (key) => {
      expect(() => assertFieldKeyAllowed(key)).toThrow();
      expect(issueCodes(() => assertFieldKeyAllowed(key))).toContain('unknown_field_key');
    },
  );

  it.each([...RESERVED_FIELD_KEYS])('odmítne rezervovaný klíč %s', (key) => {
    expect(issueCodes(() => assertFieldKeyAllowed(key))).toContain('field_key_reserved');
  });

  it('rezervované klíče obsahují všechna prvotřídní pole i odvozené hodnoty', () => {
    for (const key of [
      'email',
      'first_name',
      'greeting',
      'first_name_vocative',
      'unsubscribe_url',
      'tags',
      'lists',
    ]) {
      expect(RESERVED_FIELD_KEYS).toContain(key);
    }
  });
});

describe('assertAttributesSize', () => {
  it('měří serializovanou délku v bajtech, ne počet znaků', () => {
    // Diakritika zabere v UTF-8 dva bajty, takže znakový limit by tenhle objekt pustil.
    const value = { note: 'á'.repeat(200000) };
    expect(issueCodes(() => assertAttributesSize(value))).toContain('attributes_too_large');
  });

  it('malý objekt projde', () => {
    expect(() => assertAttributesSize({ city: 'Brno' })).not.toThrow();
  });

  it('do chyby vloží skutečnou i povolenou velikost', () => {
    try {
      assertAttributesSize({ note: 'x'.repeat(300000) });
      throw new Error('mělo to spadnout');
    } catch (error) {
      const params = (error as { params?: Record<string, number> }).params;
      expect(params).toMatchObject({ limit_bytes: CONTACT_ATTRIBUTES_MAX_BYTES });
      expect(params?.['actual_bytes']).toBeGreaterThan(CONTACT_ATTRIBUTES_MAX_BYTES);
    }
  });

  it('sedm plných long_text polí projde, což starý limit 64 kB nedovoloval', () => {
    const attributes = Object.fromEntries(
      Array.from({ length: 7 }, (_, i) => [`note${i}`, 'x'.repeat(10000)]),
    );
    expect(() => assertAttributesSize(attributes)).not.toThrow();
  });
});
