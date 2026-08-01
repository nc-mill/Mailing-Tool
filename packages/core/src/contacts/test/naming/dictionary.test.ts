import { describe, expect, it } from 'vitest';
import {
  AMBIGUOUS_GIVEN_NAMES,
  isVietnameseSurname,
  lookupGivenName,
} from '../../naming/dictionary';

describe('slovník křestních jmen', () => {
  it('najde jméno bez ohledu na diakritiku a velikost písmen', () => {
    expect(lookupGivenName('Tomáš')).toEqual({ gender: 'male', ambiguous: false });
    expect(lookupGivenName('tomas')).toEqual({ gender: 'male', ambiguous: false });
    expect(lookupGivenName('TOMAS')).toEqual({ gender: 'male', ambiguous: false });
  });

  it('vrátí ženské jméno', () => {
    expect(lookupGivenName('Jana')).toEqual({ gender: 'female', ambiguous: false });
  });

  it('označí obourodá jména příznakem', () => {
    for (const key of AMBIGUOUS_GIVEN_NAMES) {
      expect(lookupGivenName(key)?.ambiguous, key).toBe(true);
    }
  });

  it('obsahuje všech třináct obourodých jmen vyjmenovaných ve 4.4.4', () => {
    for (const name of [
      'Nikola',
      'Jindra',
      'Saša',
      'Míša',
      'Andrea',
      'René',
      'Vali',
      'Alex',
      'Kim',
      'Toni',
      'Sam',
      'Dominique',
      'Simone',
    ]) {
      expect(lookupGivenName(name), name).toBeDefined();
      expect(lookupGivenName(name)?.ambiguous, name).toBe(true);
    }
    expect(AMBIGUOUS_GIVEN_NAMES.length).toBeGreaterThanOrEqual(13);
  });

  it('Vlasta je obourodá, protože je to skutečné české jméno obou rodů', () => {
    // Nález z baterie skutečných jmen: se seznamem třinácti jmen ze 4.4.4 vycházela
    // "Vlasta Burian" jako žena s VYSOKOU jistotou, tedy "Dobrý den, Vlasto" pro muže.
    // Seznam ve specifikaci je výčet, ne uzavřená množina; tohle je čtrnáctá položka.
    expect(lookupGivenName('Vlasta')?.ambiguous).toBe(true);
  });

  it('neznámé jméno vrátí undefined', () => {
    expect(lookupGivenName('Xyzzy')).toBeUndefined();
  });

  it('prázdný vstup vrátí undefined', () => {
    expect(lookupGivenName('')).toBeUndefined();
  });
});

describe('vietnamská příjmení', () => {
  it.each(['Nguyen', 'Nguyễn', 'Tran', 'Trần', 'Pham', 'Hoang', 'Vu', 'Bui', 'Do', 'Ly'])(
    'zná %s',
    (name) => {
      expect(isVietnameseSurname(name)).toBe(true);
    },
  );

  it('Le zná také, kolizi s francouzskou částicí řeší split, ne slovník', () => {
    expect(isVietnameseSurname('Le')).toBe(true);
  });

  it('běžné české příjmení nepovažuje za vietnamské', () => {
    expect(isVietnameseSurname('Novák')).toBe(false);
  });
});
