import { describe, expect, it } from 'vitest';
import { resolveGender } from '../../naming/gender';
import { EMPTY_OVERRIDES, type Gender, type NameOverrideLookup } from '../../naming/types';

const overridesWith = (
  entries: Record<string, { gender?: Gender; vocative?: string }>,
): NameOverrideLookup => ({ find: (kind, key) => entries[`${kind}:${key}`] });

describe('resolveGender', () => {
  it('pravidlo 1: explicitní hodnota vyhrává nad vším', () => {
    expect(
      resolveGender({
        firstName: 'Jana',
        lastName: 'Nováková',
        explicit: 'male',
        overrides: EMPTY_OVERRIDES,
      }),
    ).toMatchObject({ gender: 'male', source: 'explicit', confidence: 'high' });
  });

  it('pravidlo 2: přepis projektu na křestní jméno', () => {
    expect(
      resolveGender({
        firstName: 'Nikola',
        lastName: 'Krátký',
        overrides: overridesWith({ 'first:nikola': { gender: 'male' } }),
      }),
    ).toMatchObject({ gender: 'male', source: 'workspace_override', confidence: 'high' });
  });

  it('pravidlo 2: přepis projektu na příjmení', () => {
    expect(
      resolveGender({
        firstName: 'Xyzzy',
        lastName: 'Qwerty',
        overrides: overridesWith({ 'last:qwerty': { gender: 'female' } }),
      }),
    ).toMatchObject({ gender: 'female', source: 'workspace_override' });
  });

  it.each(['Nováková', 'Malecká', 'Novotná', 'Malá', 'Tichá'])(
    'pravidlo 3: příjmení %s je ženské s vysokou jistotou',
    (lastName) => {
      expect(
        resolveGender({ firstName: null, lastName, overrides: EMPTY_OVERRIDES }),
      ).toMatchObject({ gender: 'female', source: 'surname_rule', confidence: 'high' });
    },
  );

  it.each(['Novakova', 'Ivanova', 'Petrovska'])(
    'pravidlo 4: transliterovaná koncovka u %s dává nízkou jistotu',
    (lastName) => {
      expect(
        resolveGender({ firstName: null, lastName, overrides: EMPTY_OVERRIDES }),
      ).toMatchObject({ gender: 'female', source: 'surname_rule_translit', confidence: 'low' });
    },
  );

  it('pravidlo 5: jednoznačné jméno ze slovníku', () => {
    expect(
      resolveGender({ firstName: 'Petr', lastName: 'Xyzzy', overrides: EMPTY_OVERRIDES }),
    ).toMatchObject({ gender: 'male', source: 'given_name_dict', confidence: 'high' });
  });

  it('pravidlo 6: obourodé jméno ze slovníku dává nízkou jistotu', () => {
    expect(
      resolveGender({ firstName: 'Nikola', lastName: 'Xyzzy', overrides: EMPTY_OVERRIDES }),
    ).toMatchObject({ source: 'given_name_dict', confidence: 'low' });
  });

  it('pravidlo 6: obourodé jméno samo o sobě netvrdí rod, takže vrací unknown', () => {
    // Bez tohohle by "Nikola Krátký" skončila jako žena s vysokou jistotou a šla by
    // ven s oslovením "Nikolo" i v režimu strict. Kritérium 20 vyžaduje opak.
    expect(
      resolveGender({ firstName: 'Nikola', lastName: 'Xyzzy', overrides: EMPTY_OVERRIDES }).gender,
    ).toBe('unknown');
  });

  it('Vlasta Burian není žena, obourodé jméno bez ženského příjmení dá unknown', () => {
    // Nález z baterie skutečných jmen. Před opravou vycházel rod 'female' s vysokou
    // jistotou a muž by dostal oslovení "Dobrý den, Vlasto".
    expect(
      resolveGender({ firstName: 'Vlasta', lastName: 'Burian', overrides: EMPTY_OVERRIDES }),
    ).toMatchObject({ gender: 'unknown', source: 'given_name_dict', confidence: 'low' });
  });

  it('Vlasta s ženským příjmením je žena, protože rozhoduje příjmení', () => {
    expect(
      resolveGender({ firstName: 'Vlasta', lastName: 'Fialová', overrides: EMPTY_OVERRIDES }),
    ).toMatchObject({ gender: 'female', source: 'surname_rule', confidence: 'high' });
  });

  it('pravidlo 7: knihovní heuristika je poslední záchrana a vždy nízká jistota', () => {
    const result = resolveGender({
      firstName: 'Xyzzia',
      lastName: null,
      overrides: EMPTY_OVERRIDES,
    });
    expect(result.source).toBe('library_heuristic');
    expect(result.confidence).toBe('low');
  });

  it('pravidlo 8: bez jakéhokoliv vstupu je rod unknown', () => {
    expect(resolveGender({ firstName: null, lastName: null, overrides: EMPTY_OVERRIDES })).toEqual({
      gender: 'unknown',
      source: 'none',
      confidence: 'none',
      warnings: ['gender_unknown'],
    });
  });

  it('konflikt: ženské příjmení a mužské křestní jméno dá unknown a varování', () => {
    const result = resolveGender({
      firstName: 'Petr',
      lastName: 'Nováková',
      overrides: EMPTY_OVERRIDES,
    });
    expect(result.gender).toBe('unknown');
    expect(result.confidence).toBe('low');
    expect(result.warnings).toContain('gender_conflict');
  });

  it('konflikt se nevyhlásí, když se pravidla shodují', () => {
    const result = resolveGender({
      firstName: 'Jana',
      lastName: 'Nováková',
      overrides: EMPTY_OVERRIDES,
    });
    expect(result.gender).toBe('female');
    expect(result.warnings).not.toContain('gender_conflict');
  });

  it('konflikt nepřebije explicitní hodnotu', () => {
    expect(
      resolveGender({
        firstName: 'Petr',
        lastName: 'Nováková',
        explicit: 'male',
        overrides: EMPTY_OVERRIDES,
      }),
    ).toMatchObject({ gender: 'male', source: 'explicit' });
  });

  it('konflikt nepřebije přepis projektu', () => {
    expect(
      resolveGender({
        firstName: 'Petr',
        lastName: 'Nováková',
        overrides: overridesWith({ 'first:petr': { gender: 'male' } }),
      }),
    ).toMatchObject({ gender: 'male', source: 'workspace_override' });
  });

  it('obourodé jméno konflikt nevyvolá, protože samo o sobě nic netvrdí', () => {
    const result = resolveGender({
      firstName: 'Andrea',
      lastName: 'Novák',
      overrides: EMPTY_OVERRIDES,
    });
    expect(result.warnings).not.toContain('gender_conflict');
  });
});
