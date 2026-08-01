import { describe, expect, it } from 'vitest';
import { splitFullName } from '../../naming/split';

describe('splitFullName, prázdný vstup', () => {
  it('vrátí varování name_empty', () => {
    expect(splitFullName('', 'auto')).toEqual({
      firstName: null,
      lastName: null,
      middleName: null,
      confidence: 'none',
      warnings: ['name_empty'],
    });
  });
});

describe('splitFullName, jeden token', () => {
  it.each(['Nováková', 'Novotná', 'Malecká', 'Novakova', 'Malecka', 'Petrů'])(
    '%s s příjmenní koncovkou je příjmení s vysokou jistotou',
    (input) => {
      const result = splitFullName(input, 'auto');
      expect(result.lastName).toBe(input);
      expect(result.firstName).toBeNull();
      expect(result.confidence).toBe('high');
    },
  );

  it('známé křestní jméno je křestní jméno s vysokou jistotou', () => {
    expect(splitFullName('Jana', 'auto')).toMatchObject({
      firstName: 'Jana',
      lastName: null,
      confidence: 'high',
    });
  });

  it('neznámý token je křestní jméno s nízkou jistotou', () => {
    expect(splitFullName('Xyzzy', 'auto')).toMatchObject({
      firstName: 'Xyzzy',
      lastName: null,
      confidence: 'low',
    });
  });
});

describe('splitFullName, dva tokeny', () => {
  it('volba uživatele first_last vyhrává nad vším', () => {
    expect(splitFullName('Nováková Jana', 'first_last')).toMatchObject({
      firstName: 'Nováková',
      lastName: 'Jana',
      confidence: 'high',
    });
  });

  it('volba uživatele last_first vyhrává nad vším', () => {
    expect(splitFullName('Jana Nováková', 'last_first')).toMatchObject({
      firstName: 'Nováková',
      lastName: 'Jana',
      confidence: 'high',
    });
  });

  it('KRITÉRIUM 18: čárka mezi tokeny znamená obrácené pořadí', () => {
    expect(splitFullName('Nováková, Jana', 'auto')).toMatchObject({
      firstName: 'Jana',
      lastName: 'Nováková',
      confidence: 'high',
    });
  });

  it('KRITÉRIUM 17: příjmenní koncovka první a známé křestní druhé', () => {
    expect(splitFullName('Nováková Jana', 'auto')).toMatchObject({
      firstName: 'Jana',
      lastName: 'Nováková',
      confidence: 'high',
    });
  });

  it('známé křestní na druhém místě a neznámé na prvním dá obrácené pořadí s nízkou jistotou', () => {
    expect(splitFullName('Xyzzy Jana', 'auto')).toMatchObject({
      firstName: 'Jana',
      lastName: 'Xyzzy',
      confidence: 'low',
    });
  });

  it('KRITÉRIUM 16: běžné pořadí jméno příjmení', () => {
    expect(splitFullName('Jana Nováková', 'auto')).toMatchObject({
      firstName: 'Jana',
      lastName: 'Nováková',
      confidence: 'high',
    });
  });

  it('dva neznámé tokeny berou pořadí jméno příjmení s nízkou jistotou', () => {
    expect(splitFullName('Xyzzy Qwerty', 'auto')).toMatchObject({
      firstName: 'Xyzzy',
      lastName: 'Qwerty',
      confidence: 'low',
    });
  });
});

describe('splitFullName, tři a víc tokenů', () => {
  it('předložková částice patří k příjmení', () => {
    expect(splitFullName('Jan van der Berg', 'auto')).toMatchObject({
      firstName: 'Jan',
      lastName: 'van der Berg',
      middleName: null,
      confidence: 'high',
    });
  });

  it('vietnamské příjmení na prvním místě, křestní na posledním', () => {
    const result = splitFullName('Nguyen Van Thanh', 'auto');
    expect(result).toMatchObject({
      firstName: 'Thanh',
      lastName: 'Nguyen',
      middleName: 'Van',
      confidence: 'low',
    });
    expect(result.warnings).toContain('vietnamese_order_assumed');
  });

  it('Le na prvním místě u tří tokenů vyhrává vietnamská interpretace', () => {
    expect(splitFullName('Le Van Thanh', 'auto')).toMatchObject({
      firstName: 'Thanh',
      lastName: 'Le',
      middleName: 'Van',
    });
  });

  it('Le u dvou tokenů je částice, ne vietnamské příjmení', () => {
    expect(splitFullName('Jean Le', 'auto')).toMatchObject({ firstName: 'Jean', lastName: 'Le' });
  });

  it('ostatní tři tokeny: první křestní, poslední příjmení, prostředek do middle', () => {
    expect(splitFullName('Jan Petr Novák', 'auto')).toMatchObject({
      firstName: 'Jan',
      lastName: 'Novák',
      middleName: 'Petr',
      confidence: 'low',
    });
  });
});

describe('splitFullName, nedělitelné celky', () => {
  it('pomlčkou spojené příjmení je jeden token', () => {
    expect(splitFullName('Jana Nováková-Dvořáková', 'auto')).toMatchObject({
      firstName: 'Jana',
      lastName: 'Nováková-Dvořáková',
    });
  });

  it('apostrof se nedělí', () => {
    expect(splitFullName("Sean O'Brien", 'auto')).toMatchObject({
      firstName: 'Sean',
      lastName: "O'Brien",
    });
  });
});
