import { describe, expect, it } from 'vitest';
import { coerceValue, type CoerceSettings } from '../../fields/coerce';

const numberField = { key: 'total', type: 'number' as const, options: {} };
const settings: CoerceSettings = { numberFormat: 'auto', dateFormat: 'cs', defaultCountry: 'CZ' };

describe('koerce čísel v režimu auto', () => {
  it.each([
    ['1 234,56', 1234.56, 'český Excel'],
    ['1 234.56', 1234.56, ''],
    ['1,234.56', 1234.56, 'anglický formát'],
    ['1234,56', 1234.56, ''],
    ['1234.56', 1234.56, ''],
    ['-1 234,5', -1234.5, ''],
    ['1234', 1234, ''],
  ])('%s dá %s %s', (input, expected) => {
    expect(coerceValue(input, numberField, settings)).toEqual({ ok: true, value: expected });
  });

  it('PAST: 1,234 se čte jako 1.234, protože jediný oddělovač je desetinný', () => {
    const result = coerceValue('1,234', numberField, settings);
    expect(result).toMatchObject({ ok: true, value: 1.234 });
    // Náhled importu tuhle hodnotu zvýrazní, aby si uživatel všiml, že to nemusí být 1234.
    expect(result.ok && result.warning).toBe('number_format_ambiguous');
  });

  it('jednotky se neodstraňují', () => {
    expect(coerceValue('1 234 Kč', numberField, settings)).toEqual({
      ok: false,
      code: 'invalid_number',
    });
  });

  it('prázdná hodnota dá null', () => {
    expect(coerceValue('', numberField, settings)).toEqual({ ok: true, value: null });
  });

  it('nekonečno a NaN se odmítají', () => {
    expect(coerceValue('Infinity', numberField, settings)).toEqual({
      ok: false,
      code: 'invalid_number',
    });
    expect(coerceValue('NaN', numberField, settings)).toEqual({
      ok: false,
      code: 'invalid_number',
    });
  });

  it('režim cs bere čárku jako desetinný oddělovač', () => {
    expect(coerceValue('1,234', numberField, { ...settings, numberFormat: 'cs' })).toMatchObject({
      ok: true,
      value: 1.234,
    });
  });

  it('režim en bere čárku jako oddělovač tisíců', () => {
    expect(coerceValue('1,234', numberField, { ...settings, numberFormat: 'en' })).toMatchObject({
      ok: true,
      value: 1234,
    });
  });

  it('respektuje meze z options', () => {
    const field = { key: 'age', type: 'number' as const, options: { min: 0, max: 120 } };
    expect(coerceValue('150', field, settings)).toEqual({ ok: false, code: 'invalid_number' });
  });
});

describe('koerce booleanů', () => {
  const field = { key: 'ok', type: 'boolean' as const, options: {} };

  it.each(['1', 'true', 'ano', 'yes', 'y', 'a', 'x', 'on', '✓', 'ANO', 'Áno'])(
    '%s je pravda',
    (input) => {
      expect(coerceValue(input, field, settings)).toEqual({ ok: true, value: true });
    },
  );

  it.each(['0', 'false', 'ne', 'no', 'n', 'off', 'NE'])('%s je nepravda', (input) => {
    expect(coerceValue(input, field, settings)).toEqual({ ok: true, value: false });
  });

  it('prázdná hodnota je null, ne false', () => {
    expect(coerceValue('', field, settings)).toEqual({ ok: true, value: null });
  });

  it('cokoliv jiného je chyba', () => {
    expect(coerceValue('možná', field, settings)).toEqual({ ok: false, code: 'invalid_boolean' });
  });
});

describe('koerce dat', () => {
  const field = { key: 'birthday', type: 'date' as const, options: {} };

  it.each([
    ['1.2.2026', '2026-02-01'],
    ['01.02.2026', '2026-02-01'],
    ['1. 2. 2026', '2026-02-01'],
    ['2026-02-01', '2026-02-01'],
    ['01/02/2026', '2026-02-01'],
  ])('český formát %s dá %s', (input, expected) => {
    expect(coerceValue(input, field, settings)).toMatchObject({ ok: true, value: expected });
  });

  it('anglický formát v režimu en', () => {
    expect(coerceValue('02/01/2026', field, { ...settings, dateFormat: 'en' })).toMatchObject({
      ok: true,
      value: '2026-02-01',
    });
  });

  it('sériové číslo z Excelu se převede z epochy 1899-12-30 a přidá varování', () => {
    // 44927 je 2023-01-01. Epocha zahrnuje známou chybu s přestupným rokem 1900.
    const result = coerceValue('44927', field, settings);
    expect(result).toMatchObject({ ok: true, value: '2023-01-01' });
    expect(result.ok && result.warning).toBe('excel_serial_date_assumed');
  });

  it('číslo mimo rozsah sériových čísel se jako datum nebere', () => {
    expect(coerceValue('5', field, settings)).toEqual({ ok: false, code: 'invalid_date' });
  });

  it('rok mimo 1900 až 2200 se odmítne', () => {
    expect(coerceValue('1.1.1800', field, settings)).toEqual({ ok: false, code: 'invalid_date' });
  });
});

describe('koerce výčtů a textů', () => {
  it('enum přijme jen hodnotu ze seznamu', () => {
    const field = { key: 'plan', type: 'enum' as const, options: { values: ['free', 'pro'] } };
    expect(coerceValue('pro', field, settings)).toEqual({ ok: true, value: 'pro' });
    expect(coerceValue('enterprise', field, settings)).toEqual({
      ok: false,
      code: 'invalid_enum_value',
    });
  });

  it('multi_enum rozdělí hodnoty a ověří každou', () => {
    const field = {
      key: 'tags',
      type: 'multi_enum' as const,
      options: { values: ['a', 'b'], max_items: 5 },
    };
    expect(coerceValue('a|b', field, settings)).toEqual({ ok: true, value: ['a', 'b'] });
    expect(coerceValue('a|c', field, settings)).toEqual({ ok: false, code: 'invalid_enum_value' });
  });

  it('text nad limit délky se odmítne', () => {
    const field = { key: 'note', type: 'text' as const, options: {} };
    expect(coerceValue('x'.repeat(1001), field, settings)).toEqual({
      ok: false,
      code: 'value_too_long',
    });
  });

  it('url musí být absolutní', () => {
    const field = { key: 'web', type: 'url' as const, options: {} };
    expect(coerceValue('https://x.cz', field, settings)).toEqual({
      ok: true,
      value: 'https://x.cz',
    });
    expect(coerceValue('/relativni', field, settings)).toEqual({
      ok: false,
      code: 'value_too_long',
    });
  });

  it('e-mailové pole používá tutéž validaci jako hlavní adresa', () => {
    const field = { key: 'alt', type: 'email' as const, options: {} };
    expect(coerceValue('JAN@X.CZ', field, settings)).toEqual({ ok: true, value: 'jan@x.cz' });
    expect(coerceValue('nesmysl', field, settings)).toEqual({ ok: false, code: 'invalid_email' });
  });

  it('telefon se uloží tak, jak přišel, když se nedá normalizovat', () => {
    const field = { key: 'phone', type: 'phone' as const, options: {} };
    expect(coerceValue('777 123 456', field, settings)).toMatchObject({
      ok: true,
      value: '777 123 456',
    });
  });
});
