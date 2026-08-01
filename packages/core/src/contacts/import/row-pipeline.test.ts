import { describe, expect, it } from 'vitest';
import { processRow, type RowContext } from './row-pipeline';
import { defaultOptions } from './options';
import { EMPTY_OVERRIDES } from '../naming/types';
import type { RawRow } from './reader';

const base: RowContext = {
  mapping: {
    '0': { target: 'email' },
    '1': { target: 'full_name' },
    '2': { target: 'attribute', key: 'city' },
  },
  options: defaultOptions(),
  fieldCatalog: { city: { type: 'text', required: false, maxLength: 100 } },
  settings: {
    locale: 'cs',
    addressForm: 'formal',
    salutationBy: 'first_name',
    vocativePolicy: 'balanced',
  },
  overrides: EMPTY_OVERRIDES,
  suppressed: new Map<string, string>(),
};

const row = (fields: string[], extra: Partial<RawRow> = {}): RawRow => ({
  rowNumber: 1,
  fields,
  raw: fields.join(';'),
  byteOffsetAfter: 0,
  fieldCountMismatch: false,
  padded: false,
  truncatedCells: 0,
  ...extra,
});

describe('row pipeline', () => {
  it('turns Jana Nováková into a female contact with the vocative Jano', () => {
    const out = processRow(row(['jana@firma.cz', 'Jana Nováková', 'Brno']), base);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.contact.firstName).toBe('Jana');
    expect(out.contact.lastName).toBe('Nováková');
    expect(out.contact.gender).toBe('female');
    expect(out.contact.firstNameVocative).toBe('Jano');
    expect(out.contact.greeting).toBe('Dobrý den, Jano');
  });

  it('fills the name keys, so the vocative review queue is not left empty', () => {
    const out = processRow(row(['jana@firma.cz', 'Jana Nováková', 'Brno']), base);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.contact.firstNameKey).toBe('jana');
    expect(out.contact.lastNameKey).toBe('novakova');
  });

  it('reports email_missing before any other problem on the row', () => {
    const out = processRow(row(['', 'Jana Nováková', 'x'.repeat(500)]), base);
    expect(out).toMatchObject({ kind: 'error', errorCode: 'email_missing' });
  });

  it('reports email_invalid for two at signs', () => {
    expect(processRow(row(['jana@@firma.cz', 'A', 'B']), base)).toMatchObject({
      kind: 'error',
      errorCode: 'email_invalid',
    });
  });

  it('reports the field count mismatch before the email is even parsed', () => {
    const out = processRow(row(['jana@firma.cz', 'A', 'B'], { fieldCountMismatch: true }), base);
    expect(out).toMatchObject({ kind: 'error', errorCode: 'row_field_count_mismatch' });
  });

  it('drops a complaint suppressed address entirely', () => {
    const ctx: RowContext = { ...base, suppressed: new Map([['jana@firma.cz', 'complaint']]) };
    expect(processRow(row(['jana@firma.cz', 'A', 'B']), ctx)).toMatchObject({ kind: 'suppressed' });
  });

  it('keeps a soft suppressed contact but without subscription or consent', () => {
    const ctx: RowContext = {
      ...base,
      suppressed: new Map([['jana@firma.cz', 'soft_bounce_threshold']]),
    };
    const out = processRow(row(['jana@firma.cz', 'A', 'B']), ctx);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.subscribe).toBe(false);
    expect(out.consent).toBeNull();
    expect(out.warnings).toContain('suppressed_skipped');
  });

  it('fails the whole row when one custom field fails coercion', () => {
    const ctx: RowContext = {
      ...base,
      fieldCatalog: { city: { type: 'number', required: false } },
    };
    expect(processRow(row(['jana@firma.cz', 'A', 'not a number']), ctx)).toMatchObject({
      kind: 'error',
      errorCode: 'invalid_number',
    });
  });

  it('marks a low confidence vocative for the review queue', () => {
    const out = processRow(row(['nikola@x.cz', 'Nikola Krátký', 'Brno']), base);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.contact.vocativeConfidence).toBe('low');
    expect(out.warnings).toContain('vocative_low_confidence');
  });

  it('produces Dobrý den without a dangling comma for an empty name', () => {
    const out = processRow(row(['x@x.cz', '', '']), base);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.contact.greeting).toBe('Dobrý den');
  });

  it('warns about a padded row instead of failing it', () => {
    const out = processRow(row(['jana@firma.cz', 'A', ''], { padded: true }), base);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.warnings).toContain('trailing_fields_padded');
  });
});
