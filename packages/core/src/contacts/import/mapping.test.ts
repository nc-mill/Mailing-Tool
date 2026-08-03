import { describe, expect, it } from 'vitest';
import {
  ImportMappingSchema,
  assertMappingValid,
  collectMappingWarnings,
  guessFieldType,
  suggestMapping,
} from './mapping';
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

  /**
   * Sloupec „Jméno" znamená v českých exportech jednou křestní jméno a jednou
   * celé. Rozhodovat se proto musí podle hodnot, ne podle názvu.
   */
  describe('a name column decided by its values, not by its header', () => {
    const header = ['Jméno', 'E-mail'];

    it('maps multiword values to full_name so the surname and vocative survive', () => {
      const rows = [
        ['Jana Nováková', 'a@example.com'],
        ['Ing. Petr Svoboda', 'b@example.com'],
        ['Ondřej Dvořák', 'c@example.com'],
      ];
      expect(suggestMapping(header, rows)['0']).toEqual({ target: 'full_name' });
    });

    it('keeps single word values on first_name', () => {
      const rows = [
        ['Jana', 'a@example.com'],
        ['Petr', 'b@example.com'],
        ['Ondřej', 'c@example.com'],
      ];
      expect(suggestMapping(header, rows)['0']).toEqual({ target: 'first_name' });
    });

    it('picks full_name on an even split, because that is the recoverable side', () => {
      const rows = [
        ['Jana Nováková', 'a@example.com'],
        ['Petr', 'b@example.com'],
        ['Ondřej Dvořák', 'c@example.com'],
        ['Lucie', 'd@example.com'],
      ];
      expect(suggestMapping(header, rows)['0']).toEqual({ target: 'full_name' });
    });

    it('ignores empty cells instead of counting them as single words', () => {
      const rows = [
        ['Jana Nováková', 'a@example.com'],
        ['', 'b@example.com'],
        ['   ', 'c@example.com'],
      ];
      expect(suggestMapping(header, rows)['0']).toEqual({ target: 'full_name' });
    });

    it('never proposes full_name next to a surname column, that pair is silently ignored', () => {
      const rows = [
        ['Jana Nováková', 'Nováková', 'a@example.com'],
        ['Petr Svoboda', 'Svoboda', 'b@example.com'],
      ];
      const out = suggestMapping(['Jméno', 'Příjmení', 'E-mail'], rows);
      expect(out['0']).toEqual({ target: 'first_name' });
      expect(assertMappingValid(out).warnings).toEqual([]);
    });

    it('falls back to the header alone when no sample rows are available', () => {
      expect(suggestMapping(header)['0']).toEqual({ target: 'first_name' });
    });
  });

  it('collects warnings without throwing on a mapping that has no email yet', () => {
    expect(
      collectMappingWarnings({ '0': { target: 'full_name' }, '1': { target: 'last_name' } }),
    ).toEqual(['full_name_ignored']);
    expect(collectMappingWarnings({ '0': { target: 'full_name' } })).toEqual([]);
    expect(collectMappingWarnings({ nonsense: true })).toEqual([]);
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
