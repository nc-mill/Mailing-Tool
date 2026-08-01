import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Odchylka od plánu: plán psal tři `..`, jenže tenhle soubor leží
// v `apps/web/test/import`, takže do kořene repozitáře vedou čtyři.
const MESSAGES_DIR = path.resolve(import.meta.dirname, '../../../../packages/i18n/messages');

function load(locale: 'cs' | 'en'): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(MESSAGES_DIR, locale, 'import.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

const cs = load('cs');
const en = load('en');

const flatten = (obj: unknown, prefix = ''): string[] =>
  typeof obj === 'object' && obj !== null
    ? Object.entries(obj).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k))
    : [prefix];

describe('import catalogue', () => {
  it('has the same key set in both languages', () => {
    expect(flatten(cs).sort()).toEqual(flatten(en).sort());
  });

  it('contains no em dash', () => {
    // U+2014 se zapisuje escapem schválně: znak samotný je v editoru
    // k nerozeznání od pomlčky a spolehlivě by se do katalogu vrátil.
    expect(JSON.stringify(cs)).not.toContain('—');
    expect(JSON.stringify(en)).not.toContain('—');
  });

  it('covers all eleven warning codes', () => {
    for (const code of [
      'excel_serial_date_assumed',
      'number_format_ambiguous',
      'value_truncated',
      'name_split_low_confidence',
      'vietnamese_order_assumed',
      'gender_unknown',
      'gender_conflict',
      'vocative_low_confidence',
      'non_latin_script',
      'suppressed_skipped',
      'trailing_fields_padded',
    ]) {
      expect(flatten(cs)).toContain(`warnings.${code}`);
    }
  });

  it('covers all twenty row level error codes', () => {
    for (const code of [
      'row_field_count_mismatch',
      'email_missing',
      'email_invalid',
      'email_too_long',
      'email_domain_invalid',
      'email_disposable',
      'duplicate_in_file',
      'invalid_number',
      'invalid_boolean',
      'invalid_date',
      'invalid_datetime',
      'invalid_enum_value',
      'invalid_url',
      'invalid_phone',
      'value_too_long',
      'required_field_missing',
      'unknown_field_key',
      'encoding_error',
      'name_empty',
      'list_not_found',
    ]) {
      expect(flatten(cs)).toContain(`rowErrors.${code}`);
    }
  });

  it('covers all ten file level error codes with a second sentence', () => {
    for (const code of [
      'file_too_large',
      'too_many_rows',
      'too_many_columns',
      'empty_file',
      'unsupported_encoding',
      'delimiter_not_detected',
      'malformed_csv',
      'no_email_column_mapped',
      'storage_unavailable',
      'contact_limit_reached',
    ]) {
      expect(flatten(cs)).toContain(`fileErrors.${code}.title`);
      expect(flatten(cs)).toContain(`fileErrors.${code}.nextStep`);
    }
  });

  it('uses ICU plurals with the =0 category on every count', () => {
    const withCount = flatten(cs).filter((k) => /count|rows|groups/i.test(k));
    expect(withCount.length).toBeGreaterThan(0);
    for (const key of withCount) {
      const value = key
        .split('.')
        .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)[part], cs);
      if (typeof value === 'string' && value.includes('plural')) expect(value).toContain('=0');
    }
  });

  it('never uses the banned word subscribed as a status', () => {
    expect(JSON.stringify(cs)).not.toMatch(/"subscribed"/);
  });
});
