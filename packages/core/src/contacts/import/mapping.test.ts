import { describe, expect, it } from 'vitest';
import { ImportMappingSchema, assertMappingValid, guessFieldType, suggestMapping } from './mapping';
import { importErrorCode } from './errors';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return importErrorCode(error);
  }
}

describe('column mapping', () => {
  it('maps czech and english headers without diacritics or case', () => {
    const out = suggestMapping([
      'E-mailová adresa',
      'JMENO A PRIJMENI',
      'Prijmeni',
      'Pohlaví',
      'Jazyk',
    ]);
    expect(out['0']).toEqual({ target: 'email' });
    expect(out['1']).toEqual({ target: 'full_name' });
    expect(out['2']).toEqual({ target: 'last_name' });
    expect(out['3']).toEqual({ target: 'gender' });
    expect(out['4']).toEqual({ target: 'locale' });
  });

  it('defaults an unrecognised column to ignore', () => {
    expect(suggestMapping(['Poznamka'])['0']).toEqual({ target: 'ignore' });
  });

  it('requires exactly one email column', () => {
    expect(codeOf(() => assertMappingValid({ '0': { target: 'first_name' } }))).toBe(
      'no_email_column_mapped',
    );
    expect(
      codeOf(() => assertMappingValid({ '0': { target: 'email' }, '1': { target: 'email' } })),
    ).toBe('duplicate_target');
  });

  it('lets full_name and first_name coexist, first_name wins with a warning', () => {
    const out = assertMappingValid({
      '0': { target: 'email' },
      '1': { target: 'full_name' },
      '2': { target: 'first_name' },
    });
    expect(out.warnings).toContain('full_name_ignored');
  });

  it('rejects an unknown target', () => {
    expect(() => ImportMappingSchema.parse({ '0': { target: 'shell_command' } })).toThrow();
  });

  it('guesses a field type from the first hundred values', () => {
    expect(guessFieldType(['1', '2', '3'])).toBe('number');
    expect(guessFieldType(['ano', 'ne', 'ano'])).toBe('boolean');
    expect(guessFieldType(['Praha', 'Brno', 'Praha'])).toBe('enum');
    expect(guessFieldType(['a'.repeat(300), 'b'.repeat(300)])).toBe('text');
  });
});
