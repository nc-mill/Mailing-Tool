import { describe, expect, it } from 'vitest';
import { computeVocative, localeHasVocative } from '../../naming/vocative';
import { EMPTY_OVERRIDES } from '../../naming/types';

describe('localeHasVocative', () => {
  it.each(['cs', 'sk', 'cs-CZ', 'CS', 'sk-SK'])('%s má vokativ', (locale) => {
    expect(localeHasVocative(locale)).toBe(true);
  });

  it.each(['en', 'de', 'pl', 'en-GB', 'fr-CA', 'zh-Hant'])('%s vokativ nemá', (locale) => {
    expect(localeHasVocative(locale)).toBe(false);
  });
});

describe('computeVocative', () => {
  const base = { locale: 'cs', overrides: EMPTY_OVERRIDES, script: 'latin' as const };

  it('jazyk bez vokativu vrací nominativ s vysokou jistotou', () => {
    expect(
      computeVocative({
        ...base,
        locale: 'en',
        firstName: 'Jana',
        lastName: 'Nováková',
        gender: 'female',
      }),
    ).toMatchObject({
      firstNameVocative: 'Jana',
      lastNameVocative: 'Nováková',
      confidence: 'high',
    });
  });

  it('nelatinkové písmo nevyrábí žádný vokativ', () => {
    expect(
      computeVocative({
        ...base,
        script: 'non_latin',
        firstName: 'Иван',
        lastName: 'Петров',
        gender: 'unknown',
      }),
    ).toMatchObject({ firstNameVocative: null, lastNameVocative: null, confidence: 'none' });
  });

  it('přepis projektu vyhrává a dává vysokou jistotu', () => {
    const overrides = {
      find: (kind: 'first' | 'last', key: string) =>
        kind === 'first' && key === 'nikola' ? { vocative: 'Nikolo' } : undefined,
    };
    expect(
      computeVocative({
        ...base,
        overrides,
        firstName: 'Nikola',
        lastName: 'Krátký',
        gender: 'unknown',
      }),
    ).toMatchObject({ firstNameVocative: 'Nikolo', confidence: 'high' });
  });

  it.each([
    ['Jana', 'female', 'Jano'],
    ['Petr', 'male', 'Petře'],
    ['Jan', 'male', 'Jane'],
    ['Marie', 'female', 'Marie'],
    ['Lucie', 'female', 'Lucie'],
    ['Jiří', 'male', 'Jiří'],
    ['Hugo', 'male', 'Hugo'],
    ['Dagmar', 'female', 'Dagmar'],
    ['Ester', 'female', 'Ester'],
  ] as const)('křestní jméno %s (%s) dá %s', (firstName, gender, expected) => {
    expect(computeVocative({ ...base, firstName, lastName: null, gender }).firstNameVocative).toBe(
      expected,
    );
  });

  it.each([
    ['Novák', 'male', 'Nováku'],
    ['Nováková', 'female', 'Nováková'],
    ['Havel', 'male', 'Havle'],
    ['Ježek', 'male', 'Ježku'],
    ['Svoboda', 'male', 'Svobodo'],
    ['Procházka', 'male', 'Procházko'],
    ['Tichý', 'male', 'Tichý'],
    ['Novotná', 'female', 'Novotná'],
  ] as const)('příjmení %s (%s) dá %s', (lastName, gender, expected) => {
    expect(computeVocative({ ...base, firstName: null, lastName, gender }).lastNameVocative).toBe(
      expected,
    );
  });

  it('KRITÉRIUM 23: ženské příjmení nikdy nedostane mužskou koncovku', () => {
    for (const lastName of ['Nováková', 'Novotná', 'Malecká', 'Tichá']) {
      for (const gender of ['female', 'male', 'unknown'] as const) {
        const result = computeVocative({ ...base, firstName: null, lastName, gender });
        expect(result.lastNameVocative, `${lastName}/${gender}`).not.toBe(`${lastName}e`);
      }
    }
  });

  it('u neznámého rodu se volá automatický režim, nikdy vynucený mužský', () => {
    expect(
      computeVocative({ ...base, firstName: null, lastName: 'Nováková', gender: 'unknown' })
        .lastNameVocative,
    ).toBe('Nováková');
  });

  it.each(['', '   ', 'Jan123', 'X'])(
    'nesmyslný vstup %s nevyrobí důvěryhodný vokativ',
    (firstName) => {
      const result = computeVocative({ ...base, firstName, lastName: null, gender: 'male' });
      expect(result.firstNameVocative === null || result.confidence !== 'high').toBe(true);
    },
  );

  it('nezpracované víceslovné jméno snižuje jistotu', () => {
    expect(
      computeVocative({ ...base, firstName: 'Marie Anna', lastName: null, gender: 'female' })
        .confidence,
    ).toBe('low');
  });

  it('rod z knihovní heuristiky vždy snižuje jistotu na low', () => {
    expect(
      computeVocative({
        ...base,
        firstName: 'Petr',
        lastName: null,
        gender: 'male',
        genderSource: 'library_heuristic',
      }).confidence,
    ).toBe('low');
  });

  it('rod z explicitní hodnoty jistotu nesnižuje', () => {
    expect(
      computeVocative({
        ...base,
        firstName: 'Petr',
        lastName: null,
        gender: 'male',
        genderSource: 'explicit',
      }).confidence,
    ).toBe('high');
  });

  it('neznámý rod snižuje jistotu, i když knihovna něco vrátí', () => {
    // Automatický režim je bezpečný, ale je to odhad. Kritérium 20 stojí na tom,
    // že "Nikola Krátký" skončí s nízkou jistotou, ne s vysokou.
    expect(
      computeVocative({ ...base, firstName: 'Nikola', lastName: null, gender: 'unknown' }),
    ).toMatchObject({ firstNameVocative: 'Nikolo', confidence: 'low' });
  });
});
