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

  it('keeps only tag NAMES on the row, so ids and names do not end up in one list', () => {
    const ctx: RowContext = {
      ...base,
      mapping: { ...base.mapping, '3': { target: 'tag' } },
      options: { ...defaultOptions(), tag_ids: ['019fbf52-d8b9-7b0d-b67e-528e8026a385'] },
    };
    const out = processRow(row(['jana@firma.cz', 'Jana Nováková', 'Brno', 'VIP|veletrh']), ctx);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    // Štítky z voleb se aplikují při zápisu dávky, kde je podle čeho poznat, že jsou to
    // identifikátory. Smíchané s volným textem ze sloupce by je nikdo nerozlišil.
    expect(out.tags).toEqual(['VIP', 'veletrh']);
  });

  it('subscribes the row into the mapped list only when the cell says yes', () => {
    const listId = '019fbf52-d8b9-7b0d-b67e-528e8026a390';
    const ctx: RowContext = {
      ...base,
      mapping: { ...base.mapping, '3': { target: 'list', list_id: listId } },
    };
    const yes = processRow(row(['jana@firma.cz', 'Jana Nováková', 'Brno', 'ano']), ctx);
    const no = processRow(row(['petr@firma.cz', 'Petr Novák', 'Brno', 'ne']), ctx);
    expect(yes.kind === 'ok' && yes.listIds).toEqual([listId]);
    expect(no.kind === 'ok' && no.listIds).toEqual([]);
    // Nesmysl ve sloupci je chyba řádku, ne tiché nepřihlášení.
    expect(processRow(row(['x@firma.cz', 'A', 'B', 'možná']), ctx)).toMatchObject({
      kind: 'error',
      errorCode: 'invalid_boolean',
    });
  });

  it('takes the consent date and source from the mapped columns', () => {
    const consent = {
      purpose: 'email_marketing' as const,
      legal_basis: 'consent' as const,
      source: 'import',
      declaration: true,
    };
    const ctx: RowContext = {
      ...base,
      mapping: {
        ...base.mapping,
        '3': { target: 'consent_occurred_at' },
        '4': { target: 'consent_source' },
      },
      options: { ...defaultOptions(), consent },
    };
    const out = processRow(
      row(['jana@firma.cz', 'Jana Nováková', 'Brno', '3. 5. 2024', 'veletrh Brno']),
      ctx,
    );
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.consentOccurredAt).toBe('2024-05-03T00:00:00.000Z');
    expect(out.consent?.source).toBe('veletrh Brno');
  });

  it('warns about a padded row instead of failing it', () => {
    const out = processRow(row(['jana@firma.cz', 'A', ''], { padded: true }), base);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.warnings).toContain('trailing_fields_padded');
  });
});

/**
 * Sloupec s pohlavím se do 5. 8. 2026 přijímal jedině v podobě `male`, `female`
 * a `unknown`, protože se porovnával rovnou s typem `Gender`. Český export ale
 * píše „muž" a „žena" nebo zkratku, takže se sloupec, který uživatel v kroku
 * Mapování výslovně nastavil, tiše zahodil a rod se odhadl ze jména. Rod řídí
 * oslovení v 5. pádě, takže se to projevilo až v odeslané kampani.
 */
describe('sloupec s pohlavím', () => {
  const withGender: RowContext = {
    ...base,
    mapping: {
      '0': { target: 'email' },
      '1': { target: 'full_name' },
      '2': { target: 'gender' },
    },
    fieldCatalog: {},
  };

  it.each([
    ['muž', 'male'],
    ['Muž', 'male'],
    ['m', 'male'],
    ['male', 'male'],
    ['žena', 'female'],
    ['ž', 'female'],
    ['f', 'female'],
    ['female', 'female'],
  ])('rozumí zápisu %s jako %s', (value, expected) => {
    // Jméno je schválně cizí, aby rod nešel odhadnout z něj a test měřil sloupec.
    const out = processRow(row(['x@firma.cz', 'Kim Nguyen', value]), withGender);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.contact.gender).toBe(expected);
    expect(out.contact.genderSource).toBe('explicit');
  });

  it('nechá rod odhadnout ze jména, když hodnotě nerozumí', () => {
    const out = processRow(row(['jana@firma.cz', 'Jana Nováková', 'nesmysl']), withGender);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.contact.gender).toBe('female');
    expect(out.contact.genderSource).not.toBe('explicit');
  });
});
