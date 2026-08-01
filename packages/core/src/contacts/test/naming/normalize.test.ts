import { describe, expect, it } from 'vitest';
import { detectScript, normalizeNameKey, normalizeNameValue } from '../../naming/normalize';

describe('normalizeNameKey', () => {
  it.each([
    ['Tomáš', 'tomas'],
    ['Tomas', 'tomas'],
    ['TOMÁŠ', 'tomas'],
    ['Nováková', 'novakova'],
    ['Škorpil', 'skorpil'],
    ['Řehoř', 'rehor'],
    ['Ďáblík', 'dablik'],
    ["O'Brien", "o'brien"],
    ['Novák-Dvořák', 'novak-dvorak'],
    ['  Jan  ', 'jan'],
  ])('z %s udělá %s', (input, expected) => {
    expect(normalizeNameKey(input)).toBe(expected);
  });

  it('Tomáš a Tomas dávají stejný klíč, na tom stojí kritérium 30', () => {
    expect(normalizeNameKey('Tomáš')).toBe(normalizeNameKey('Tomas'));
  });

  it('prázdný a bílý vstup dává prázdný klíč', () => {
    expect(normalizeNameKey('')).toBe('');
    expect(normalizeNameKey('   ')).toBe('');
  });

  it('je idempotentní', () => {
    const once = normalizeNameKey('Tomáš');
    expect(normalizeNameKey(once)).toBe(once);
  });
});

describe('normalizeNameValue', () => {
  it('sbalí opakované mezery a ořeže okraje', () => {
    expect(normalizeNameValue('  Jan   Petr  ')).toEqual({ value: 'Jan Petr', warnings: [] });
  });

  it('nahradí NBSP obyčejnou mezerou', () => {
    expect(normalizeNameValue('Jan\u00a0Petr').value).toBe('Jan Petr');
  });

  it('sbalí i úzkou nedělitelnou a ideografickou mezeru', () => {
    expect(normalizeNameValue('Jan\u202fPetr').value).toBe('Jan Petr');
    expect(normalizeNameValue('Jan\u3000Petr').value).toBe('Jan Petr');
  });

  it('z prázdného vstupu udělá null', () => {
    expect(normalizeNameValue('   ')).toEqual({ value: null, warnings: [] });
    expect(normalizeNameValue(null)).toEqual({ value: null, warnings: [] });
    expect(normalizeNameValue(undefined)).toEqual({ value: null, warnings: [] });
  });

  it('zkrátí hodnotu nad 100 znaků a přidá varování', () => {
    const result = normalizeNameValue('a'.repeat(150));
    expect(result.value).toHaveLength(100);
    expect(result.warnings).toContain('value_truncated');
  });
});

describe('detectScript', () => {
  it.each([
    ['Jan', 'latin'],
    ['Nováková', 'latin'],
    ['Nguyễn', 'latin'],
    ['Иван', 'non_latin'],
    ['Πέτρος', 'non_latin'],
    ['王伟', 'non_latin'],
    ['محمد', 'non_latin'],
    ['אברהם', 'non_latin'],
    ['राहुल', 'non_latin'],
  ])('%s je %s', (input, expected) => {
    expect(detectScript(input)).toBe(expected);
  });
});
