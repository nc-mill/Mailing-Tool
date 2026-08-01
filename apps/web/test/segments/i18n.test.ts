import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FIELD_CLASS_OPERATORS } from '@mlain/core/segments';
import { describe, expect, it } from 'vitest';

// Odchylka od plánu: plán psal tři `..`, jenže tenhle soubor leží
// v `apps/web/test/segments`, takže do kořene repozitáře vedou čtyři.
const MESSAGES_DIR = path.resolve(import.meta.dirname, '../../../../packages/i18n/messages');

type Catalogue = {
  builder: {
    groupSentence: string;
    negationHint: { andNot: string; orNot: string };
  };
};

function load(locale: 'cs' | 'en'): Catalogue & Record<string, unknown> {
  return JSON.parse(
    readFileSync(path.join(MESSAGES_DIR, locale, 'segments.json'), 'utf8'),
  ) as Catalogue & Record<string, unknown>;
}

const cs = load('cs');
const en = load('en');

const flatten = (obj: unknown, prefix = ''): string[] =>
  typeof obj === 'object' && obj !== null
    ? Object.entries(obj).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k))
    : [prefix];

describe('segments catalogue', () => {
  it('has the same key set in both languages', () => {
    expect(flatten(cs).sort()).toEqual(flatten(en).sort());
  });

  it('has a label for every field and operator pair from the matrix', () => {
    const keys = flatten(cs);
    for (const operators of Object.values(FIELD_CLASS_OPERATORS)) {
      for (const operator of operators) expect(keys).toContain(`operators.${operator}`);
    }
  });

  it('carries the builder sentence as one ICU message with named slots', () => {
    expect(cs.builder.groupSentence).toBe('Kontakty, které {polarity} {quantifier}');
    expect(en.builder.groupSentence).toBe('Contacts that {polarity} {quantifier}');
  });

  it('has an explanation line for both negated combinations in both languages', () => {
    for (const cat of [cs, en]) {
      expect(cat.builder.negationHint.andNot.length).toBeGreaterThan(10);
      expect(cat.builder.negationHint.orNot.length).toBeGreaterThan(10);
    }
  });

  it('never shows AND, OR, NOT or the word operator to the user', () => {
    const text = JSON.stringify(cs) + JSON.stringify(en);
    expect(text).not.toMatch(/\bAND\b|\bOR\b|\bNOT\b/);
    expect(text).not.toMatch(/operátor|\boperator\b/i);
  });

  it('contains no em dash', () => {
    expect(JSON.stringify(cs) + JSON.stringify(en)).not.toContain('—');
  });

  it('has a title and an explanation for all six presets', () => {
    for (const key of [
      'neverOpened',
      'neverClicked',
      'inactive90d',
      'noOpenLastN',
      'unconfirmed30d',
      'repeatedSoftBounces',
    ]) {
      expect(flatten(cs)).toContain(`presets.${key}.title`);
      expect(flatten(cs)).toContain(`presets.${key}.explanation`);
    }
  });
});
