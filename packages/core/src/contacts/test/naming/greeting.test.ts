import { describe, expect, it } from 'vitest';
import { buildGreeting } from '../../naming/greeting';

const cs = {
  locale: 'cs',
  addressForm: 'formal' as const,
  salutationBy: 'first_name' as const,
  vocativePolicy: 'balanced' as const,
};

describe('buildGreeting, testovací vektory ze 4.4.7', () => {
  it.each([
    ['Jana', 'Nováková', 'female', 'Jano', 'Nováková', 'high', 'Dobrý den, Jano'],
    ['Petr', 'Novák', 'male', 'Petře', 'Nováku', 'high', 'Dobrý den, Petře'],
    ['Marie', 'Dvořáková', 'female', 'Marie', 'Dvořáková', 'high', 'Dobrý den, Marie'],
    ['Jiří', 'Svoboda', 'male', 'Jiří', 'Svobodo', 'high', 'Dobrý den, Jiří'],
    [null, null, 'unknown', null, null, 'none', 'Dobrý den'],
    [null, 'Novák', 'male', null, 'Nováku', 'high', 'Dobrý den'],
    ['Nikola', 'Krátká', 'female', 'Nikolo', 'Krátká', 'high', 'Dobrý den, Nikolo'],
    ['Nikola', 'Krátký', 'unknown', 'Nikolo', 'Krátký', 'low', 'Dobrý den, Nikolo'],
  ] as const)('%s %s dá %s', (firstName, lastName, gender, fnv, lnv, confidence, expected) => {
    expect(
      buildGreeting({
        ...cs,
        firstName,
        lastName,
        gender,
        firstNameVocative: fnv,
        lastNameVocative: lnv,
        vocativeConfidence: confidence,
      }).greeting,
    ).toBe(expected);
  });
});

describe('buildGreeting, režimy', () => {
  const jana = {
    firstName: 'Jana',
    lastName: 'Nováková',
    gender: 'female' as const,
    firstNameVocative: 'Jano',
    lastNameVocative: 'Nováková',
    vocativeConfidence: 'high' as const,
  };

  it('formal a first_name', () => {
    expect(buildGreeting({ ...cs, ...jana }).greeting).toBe('Dobrý den, Jano');
  });

  it('informal a first_name', () => {
    expect(buildGreeting({ ...cs, ...jana, addressForm: 'informal' }).greeting).toBe('Ahoj Jano');
  });

  it('formal a surname u ženy', () => {
    expect(buildGreeting({ ...cs, ...jana, salutationBy: 'surname' }).greeting).toBe(
      'Vážená paní Nováková,',
    );
  });

  it('formal a surname u muže', () => {
    expect(
      buildGreeting({
        ...cs,
        salutationBy: 'surname',
        firstName: 'Petr',
        lastName: 'Novák',
        gender: 'male',
        firstNameVocative: 'Petře',
        lastNameVocative: 'Nováku',
        vocativeConfidence: 'high',
      }).greeting,
    ).toBe('Vážený pane Nováku,');
  });

  it('informal a surname nedává smysl a spadne na informal a first_name', () => {
    expect(
      buildGreeting({ ...cs, ...jana, addressForm: 'informal', salutationBy: 'surname' }).greeting,
    ).toBe('Ahoj Jano');
  });

  it('formal a surname s neznámým rodem spadne na oslovení křestním jménem', () => {
    expect(
      buildGreeting({
        ...cs,
        ...jana,
        salutationBy: 'surname',
        gender: 'unknown',
      }).greeting,
    ).toBe('Dobrý den, Jano');
  });

  it('anglický projekt', () => {
    expect(buildGreeting({ ...cs, ...jana, locale: 'en' }).greeting).toBe('Hello Jana');
    expect(buildGreeting({ ...cs, ...jana, locale: 'en', addressForm: 'informal' }).greeting).toBe(
      'Hi Jana',
    );
  });

  it('anglický projekt s oslovením příjmením', () => {
    expect(buildGreeting({ ...cs, ...jana, locale: 'en', salutationBy: 'surname' }).greeting).toBe(
      'Dear Ms Nováková,',
    );
  });

  it('slovenský projekt', () => {
    expect(buildGreeting({ ...cs, ...jana, locale: 'sk' }).greeting).toBe('Dobrý deň, Jano');
  });

  it('neznámý jazyk spadne na angličtinu a osloví nominativem', () => {
    expect(buildGreeting({ ...cs, ...jana, locale: 'de' }).greeting).toBe('Hello Jana');
  });
});

describe('vocative_policy', () => {
  const low = {
    ...cs,
    firstName: 'Nikola',
    lastName: 'Krátký',
    gender: 'unknown' as const,
    firstNameVocative: 'Nikolo',
    lastNameVocative: 'Krátký',
    vocativeConfidence: 'low' as const,
  };

  it('balanced použije i nízkou jistotu', () => {
    expect(buildGreeting(low).greeting).toBe('Dobrý den, Nikolo');
  });

  it('strict nízkou jistotu nepoužije, a strict je výchozí politika', () => {
    expect(buildGreeting({ ...low, vocativePolicy: 'strict' }).greeting).toBe('Dobrý den');
  });

  it('strict vysokou jistotu použije', () => {
    expect(
      buildGreeting({ ...low, vocativePolicy: 'strict', vocativeConfidence: 'high' }).greeting,
    ).toBe('Dobrý den, Nikolo');
  });
});

describe('greeting_neutral', () => {
  it.each([
    ['formal', 'first_name', 'cs', 'Dobrý den, Jano', 'Dobrý den'],
    ['informal', 'first_name', 'cs', 'Ahoj Jano', 'Ahoj'],
    ['formal', 'surname', 'cs', 'Vážená paní Nováková,', 'Dobrý den'],
    ['formal', 'first_name', 'en', 'Hello Jana', 'Hello'],
  ] as const)(
    '%s %s %s dá %s a neutrálně %s',
    (addressForm, salutationBy, locale, greeting, neutral) => {
      const result = buildGreeting({
        locale,
        addressForm,
        salutationBy,
        vocativePolicy: 'balanced',
        firstName: 'Jana',
        lastName: 'Nováková',
        gender: 'female',
        firstNameVocative: 'Jano',
        lastNameVocative: 'Nováková',
        vocativeConfidence: 'high',
      });
      expect(result.greeting).toBe(greeting);
      expect(result.greetingNeutral).toBe(neutral);
    },
  );

  it('u neznámého jména jsou obě hodnoty shodné', () => {
    const result = buildGreeting({
      ...cs,
      firstName: null,
      lastName: null,
      gender: 'unknown',
      firstNameVocative: null,
      lastNameVocative: null,
      vocativeConfidence: 'none',
    });
    expect(result.greeting).toBe('Dobrý den');
    expect(result.greetingNeutral).toBe('Dobrý den');
  });

  it('KRITÉRIUM 28: greeting_neutral nikdy neobsahuje jméno ani příjmení', () => {
    for (const addressForm of ['formal', 'informal'] as const) {
      for (const salutationBy of ['first_name', 'surname'] as const) {
        for (const locale of ['cs', 'en']) {
          const result = buildGreeting({
            locale,
            addressForm,
            salutationBy,
            vocativePolicy: 'balanced',
            firstName: 'Jana',
            lastName: 'Nováková',
            gender: 'female',
            firstNameVocative: 'Jano',
            lastNameVocative: 'Nováková',
            vocativeConfidence: 'high',
          });
          expect(result.greetingNeutral, `${addressForm}/${salutationBy}/${locale}`).not.toContain(
            'Jan',
          );
          expect(result.greetingNeutral, `${addressForm}/${salutationBy}/${locale}`).not.toContain(
            'Novák',
          );
        }
      }
    }
  });
});

describe('KRITÉRIUM 22: nikdy visící čárka', () => {
  it('projde všechny kombinace prázdnosti jména, příjmení a rodu', () => {
    for (const firstName of [null, '', '   ', 'Jana']) {
      for (const lastName of [null, '', 'Nováková']) {
        for (const gender of ['unknown', 'female', 'male'] as const) {
          for (const salutationBy of ['first_name', 'surname'] as const) {
            const result = buildGreeting({
              ...cs,
              salutationBy,
              firstName,
              lastName,
              gender,
              firstNameVocative: firstName,
              lastNameVocative: lastName,
              vocativeConfidence: 'high',
            });
            const label = JSON.stringify({ firstName, lastName, gender, salutationBy });

            // ODCHYLKA OD PLÁNU, VYNUCENÁ ROZPOREM V PLÁNU SAMOTNÉM. Plán tady zakazoval
            // jakoukoliv koncovou čárku, ale o šedesát řádků výš svým vlastním vektorem
            // vyžaduje "Vážená paní Nováková,". Kritérium 22 nezakazuje čárku, zakazuje
            // čárku VISÍCÍ, tedy takovou, před kterou žádné jméno není. Test se ptá
            // přesně na to.
            expect(result.greeting, label).not.toMatch(/[,:]\s+$/);
            expect(result.greeting, label).not.toMatch(/^\s*[,:]/);
            expect(result.greeting, label).not.toMatch(
              /^(Dobrý den|Dobrý deň|Ahoj|Hello|Hi)\s*[,:]\s*$/,
            );
            expect(result.greetingNeutral, label).not.toMatch(/[,:]\s*$/);
            expect(result.greeting.trim(), label).not.toBe('');

            // Když oslovení končí čárkou, musí před ní stát jméno.
            if (/[,:]$/.test(result.greeting)) {
              expect(result.greeting, label).toMatch(/\p{L}+[,:]$/u);
              expect(
                result.greeting.replace(/[,:]$/, '').trim().split(' ').length,
                label,
              ).toBeGreaterThan(1);
            }
          }
        }
      }
    }
  });
});
