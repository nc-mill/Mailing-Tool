import { describe, expect, it } from 'vitest';
import { resolveName } from '../../naming/resolve';
import { EMPTY_OVERRIDES } from '../../naming/types';

const ctx = {
  overrides: EMPTY_OVERRIDES,
  settings: {
    addressForm: 'formal' as const,
    salutationBy: 'first_name' as const,
    vocativePolicy: 'balanced' as const,
  },
};

describe('resolveName, akceptační kritéria 16 až 23', () => {
  it('KRITÉRIUM 16: Jana Nováková v jednom sloupci', () => {
    expect(resolveName({ fullName: 'Jana Nováková', locale: 'cs' }, ctx)).toMatchObject({
      firstName: 'Jana',
      lastName: 'Nováková',
      gender: 'female',
      firstNameVocative: 'Jano',
      greeting: 'Dobrý den, Jano',
    });
  });

  it('KRITÉRIUM 17: Nováková Jana dá totéž', () => {
    expect(resolveName({ fullName: 'Nováková Jana', locale: 'cs' }, ctx)).toMatchObject({
      firstName: 'Jana',
      lastName: 'Nováková',
      greeting: 'Dobrý den, Jano',
    });
  });

  it('KRITÉRIUM 18: Nováková, Jana dá totéž', () => {
    expect(resolveName({ fullName: 'Nováková, Jana', locale: 'cs' }, ctx)).toMatchObject({
      firstName: 'Jana',
      lastName: 'Nováková',
      greeting: 'Dobrý den, Jano',
    });
  });

  it('KRITÉRIUM 19: Petr Novák', () => {
    expect(resolveName({ fullName: 'Petr Novák', locale: 'cs' }, ctx).greeting).toBe(
      'Dobrý den, Petře',
    );
  });

  it('KRITÉRIUM 20: Nikola Krátký skončí s neznámým rodem a nízkou jistotou', () => {
    const result = resolveName({ fullName: 'Nikola Krátký', locale: 'cs' }, ctx);
    expect(result.gender).toBe('unknown');
    expect(result.vocativeConfidence).toBe('low');
  });

  it('KRITÉRIUM 20b: v režimu strict se nejistý vokativ nepoužije', () => {
    const strict = { ...ctx, settings: { ...ctx.settings, vocativePolicy: 'strict' as const } };
    expect(resolveName({ fullName: 'Nikola Krátký', locale: 'cs' }, strict).greeting).toBe(
      'Dobrý den',
    );
  });

  it('KRITÉRIUM 21: Иван Петров nevyrobí vokativ a dá neutrální oslovení', () => {
    const result = resolveName({ fullName: 'Иван Петров', locale: 'cs' }, ctx);
    expect(result.firstNameVocative).toBeNull();
    expect(result.greeting).toBe('Dobrý den');
    expect(result.warnings).toContain('non_latin_script');
  });

  it('KRITÉRIUM 11: Ing. Pavel Novák', () => {
    expect(resolveName({ fullName: 'Ing. Pavel Novák', locale: 'cs' }, ctx)).toMatchObject({
      titlePrefix: 'Ing.',
      firstName: 'Pavel',
      lastName: 'Novák',
      greeting: 'Dobrý den, Pavle',
    });
  });

  it('KRITÉRIUM 23: ženské příjmení nedostane mužskou koncovku ani přes resolveName', () => {
    const result = resolveName(
      { firstName: 'Petr', lastName: 'Nováková', gender: 'male', locale: 'cs' },
      ctx,
    );
    expect(result.lastNameVocative).toBe('Nováková');
  });
});

describe('resolveName, chování modulu', () => {
  it('samostatné sloupce se nedělí a mají vysokou jistotu rozdělení', () => {
    expect(
      resolveName({ firstName: 'Jana', lastName: 'Nováková', locale: 'cs' }, ctx),
    ).toMatchObject({ nameSplitConfidence: 'high', firstName: 'Jana', lastName: 'Nováková' });
  });

  it('plní kanonické klíče pro frontu i pro přepisy', () => {
    expect(
      resolveName({ firstName: 'Tomáš', lastName: 'Nováková', locale: 'cs' }, ctx),
    ).toMatchObject({ firstNameKey: 'tomas', lastNameKey: 'novakova' });
  });

  it('KRITÉRIUM 30: Tomáš a Tomas dají stejný klíč', () => {
    expect(resolveName({ firstName: 'Tomáš', locale: 'cs' }, ctx).firstNameKey).toBe(
      resolveName({ firstName: 'Tomas', locale: 'cs' }, ctx).firstNameKey,
    );
  });

  it('oslovení pan se použije jako rod a neuloží se do titulu', () => {
    const result = resolveName({ fullName: 'pan Xyzzy Qwerty', locale: 'cs' }, ctx);
    expect(result.titlePrefix).toBeNull();
    expect(result.gender).toBe('male');
    expect(result.genderSource).toBe('explicit');
  });

  it('anglický kontakt nedostane vokativ, ale dostane oslovení', () => {
    expect(resolveName({ fullName: 'Jana Nováková', locale: 'en' }, ctx)).toMatchObject({
      firstNameVocative: 'Jana',
      greeting: 'Hello Jana',
    });
  });

  it('prázdný vstup nevyrobí visící čárku', () => {
    expect(resolveName({ locale: 'cs' }, ctx)).toMatchObject({
      firstName: null,
      lastName: null,
      greeting: 'Dobrý den',
      greetingNeutral: 'Dobrý den',
    });
  });

  it('varování se neopakují', () => {
    const result = resolveName({ fullName: 'Nguyen Van Thanh', locale: 'cs' }, ctx);
    expect(new Set(result.warnings).size).toBe(result.warnings.length);
  });

  it('je čistá funkce: dvě volání se stejným vstupem dají shodný výsledek', () => {
    const input = { fullName: 'Ing. Jana Nováková, Ph.D.', locale: 'cs' };
    expect(resolveName(input, ctx)).toEqual(resolveName(input, ctx));
  });
});
