import { describe, expect, it } from 'vitest';
import { failureText } from '../../src/features/segments/live-count';
import { catalogTranslate } from '../helpers/intl';

const t = catalogTranslate('cs', 'segments');

/**
 * „Počet se nepodařilo spočítat." je věta, se kterou uživatel nemůže udělat
 * vůbec nic. Zbývá jako poslední možnost, ne jako první odpověď.
 */
describe('text chyby živého počtu', () => {
  it('u chybějícího odkazu řekne česky, na co podmínka ukazuje', () => {
    expect(
      failureText(t, { code: 'segment_reference_not_found', kind: 'tag', message: 'whatever' }),
    ).toBe(
      'Podmínka odkazuje na štítek, který už neexistuje. Odeberte ji, nebo vyberte jinou hodnotu.',
    );
  });

  it('u validace ukáže podrobnost ze serveru', () => {
    expect(
      failureText(t, {
        code: 'segment_invalid_ast',
        kind: null,
        message: 'tag condition expects tag ids, not tag names',
      }),
    ).toContain('tag condition expects tag ids');
  });

  it('bez jakéhokoli detailu zbývá obecná věta', () => {
    expect(failureText(t, null)).toBe('Počet se nepodařilo spočítat.');
    expect(failureText(t, { code: null, kind: null, message: null })).toBe(
      'Počet se nepodařilo spočítat.',
    );
  });

  it('neznámý druh odkazu nespadne na chybějící překlad', () => {
    // `kind` chodí ze serveru, takže se do něj může dostat cokoliv.
    expect(
      failureText(t, { code: 'segment_reference_not_found', kind: 'neco_noveho', message: 'x' }),
    ).toContain('x');
  });
});
