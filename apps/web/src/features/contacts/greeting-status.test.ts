import { describe, expect, it } from 'vitest';
import { resolveName, EMPTY_OVERRIDES } from '@mlain/core/contacts';
import { describeGreetingStatus, localeHasVocative, vocativeForm } from './greeting-status';

const ctx = {
  overrides: EMPTY_OVERRIDES,
  settings: {
    addressForm: 'formal' as const,
    salutationBy: 'first_name' as const,
    vocativePolicy: 'strict' as const,
  },
};

describe('describeGreetingStatus', () => {
  it('ruční potvrzení přebíjí všechno ostatní', () => {
    const status = describeGreetingStatus({
      greeting: 'Dobrý den, Petře',
      first_name: 'Petr',
      first_name_vocative: 'Petře',
      vocative_confidence: 'low',
      vocative_locked: true,
      locale: 'cs',
    });
    expect(status.kind).toBe('locked');
    expect(status.needsReview).toBe(false);
  });

  /**
   * TOHLE JE TA HLÁŠENÁ VADA. Kontakt „Petr Novák" uložený pod projektem s jazykem
   * `en` má ve sloupci nominativ a jistotu `high`, takže by se bez vlastního stavu
   * tvářil stejně spolehlivě jako správně vyskloňovaný kontakt.
   */
  it('kontakt v jazyce bez vokativu se hlásí jako nejistý, přestože má jistotu high', () => {
    const status = describeGreetingStatus({
      greeting: 'Hello Petr',
      first_name: 'Petr',
      first_name_vocative: 'Petr',
      vocative_confidence: 'high',
      vocative_locked: false,
      locale: 'en',
    });
    expect(status.kind).toBe('noVocativeLocale');
    expect(status.tone).toBe('warning');
    expect(status.needsReview).toBe(true);
  });

  it('jistý český vokativ je odvozený ze slovníku a do fronty nepatří', () => {
    const status = describeGreetingStatus({
      greeting: 'Dobrý den, Petře',
      first_name: 'Petr',
      first_name_vocative: 'Petře',
      vocative_confidence: 'high',
      vocative_locked: false,
      locale: 'cs',
    });
    expect(status.kind).toBe('derived');
    expect(status.needsReview).toBe(false);
  });

  it('nízká jistota je odhad a patří do fronty', () => {
    expect(
      describeGreetingStatus({
        greeting: 'Dobrý den, Nikolo',
        first_name: 'Nikola',
        first_name_vocative: 'Nikolo',
        vocative_confidence: 'low',
        vocative_locked: false,
        locale: 'cs',
      }),
    ).toMatchObject({ kind: 'guessed', needsReview: true });
  });

  it('kontakt bez jména je neutrální, ne nejistý', () => {
    expect(
      describeGreetingStatus({
        greeting: 'Dobrý den',
        first_name: null,
        first_name_vocative: null,
        vocative_confidence: 'none',
        vocative_locked: false,
        locale: 'cs',
      }),
    ).toMatchObject({ kind: 'noName', needsReview: false });
  });

  it('prázdný řetězec se chová jako chybějící jméno', () => {
    expect(
      describeGreetingStatus({
        greeting: 'Dobrý den',
        first_name: '   ',
        first_name_vocative: '',
        vocative_confidence: 'high',
        vocative_locked: false,
        locale: 'cs',
      }).kind,
    ).toBe('noName');
  });
});

/**
 * Seznam jazyků s vokativem je v `apps/web` kopie konstanty z jádra, protože
 * doména `@mlain/core/contacts` sahá na databázi a do prohlížeče se importovat
 * nesmí. Kopie se ale nesmí rozejít, takže se tady neporovnává se seznamem, ale
 * se SKUTEČNÝM chováním `resolveName`: v jazyce s vokativem musí „Petr" vydat
 * jiný tvar než nominativ, v jazyce bez vokativu tentýž.
 */
describe('localeHasVocative drží krok s jádrem', () => {
  for (const locale of ['cs', 'sk', 'en', 'de', 'cs-CZ', 'EN']) {
    it(`${locale} se shoduje s resolveName`, () => {
      const result = resolveName({ firstName: 'Petr', lastName: 'Novák', locale }, ctx);
      const coreInflected = result.firstNameVocative !== 'Petr';
      expect(localeHasVocative(locale)).toBe(coreInflected);
    });
  }
});

describe('vocativeForm', () => {
  it('vrací uložený vokativ, ne celou větu', () => {
    expect(
      vocativeForm({
        greeting: 'Dobrý den, Petře',
        first_name: 'Petr',
        first_name_vocative: 'Petře',
        vocative_confidence: 'high',
        vocative_locked: false,
        locale: 'cs',
      }),
    ).toBe('Petře');
  });

  it('spadne na nominativ, když vokativ chybí', () => {
    expect(
      vocativeForm({
        greeting: 'Hello Petr',
        first_name: 'Petr',
        first_name_vocative: null,
        vocative_confidence: 'high',
        vocative_locked: false,
        locale: 'en',
      }),
    ).toBe('Petr');
  });
});
