import { describe, expect, it } from 'vitest';
import { extractTitles } from '../../naming/titles';

describe('extractTitles', () => {
  it('oddělí jednoduchý prefix', () => {
    expect(extractTitles('Ing. Pavel Novák')).toEqual({
      titlePrefix: 'Ing.',
      titleSuffix: null,
      rest: 'Pavel Novák',
      genderHint: undefined,
    });
  });

  it('oddělí vícedílný prefix', () => {
    expect(extractTitles('Ing. arch. Jan Novák')).toEqual({
      titlePrefix: 'Ing. arch.',
      titleSuffix: null,
      rest: 'Jan Novák',
      genderHint: undefined,
    });
  });

  it('spojku et bere jako součást prefixu', () => {
    expect(extractTitles('MUDr. et MUDr. Jana Nová')).toEqual({
      titlePrefix: 'MUDr. et MUDr.',
      titleSuffix: null,
      rest: 'Jana Nová',
      genderHint: undefined,
    });
  });

  it('vše za první čárkou bere jako sufixové tituly, když sedí do slovníku', () => {
    expect(extractTitles('Novák Jan, Ph.D., MBA')).toEqual({
      titlePrefix: null,
      titleSuffix: 'Ph.D., MBA',
      rest: 'Novák Jan',
      genderHint: undefined,
    });
  });

  it('čárku před neznámým slovem nebere jako titul, je to signál obráceného pořadí', () => {
    expect(extractTitles('Nováková, Jana')).toEqual({
      titlePrefix: null,
      titleSuffix: null,
      rest: 'Nováková, Jana',
      genderHint: undefined,
    });
  });

  it('sbírá sufixy i od konce bez čárky', () => {
    expect(extractTitles('Jan Novák Ph.D.')).toEqual({
      titlePrefix: null,
      titleSuffix: 'Ph.D.',
      rest: 'Jan Novák',
      genderHint: undefined,
    });
  });

  it('zachová původní tvar včetně teček a velikosti písmen', () => {
    expect(extractTitles('MUDr. Jan Novák').titlePrefix).toBe('MUDr.');
    expect(extractTitles('mudr. Jan Novák').titlePrefix).toBe('mudr.');
  });

  it('pan a paní se neuloží do prefixu, ale vrátí se jako signál rodu', () => {
    expect(extractTitles('pan Jan Novák')).toEqual({
      titlePrefix: null,
      titleSuffix: null,
      rest: 'Jan Novák',
      genderHint: 'male',
    });
    expect(extractTitles('paní Jana Nová')).toEqual({
      titlePrefix: null,
      titleSuffix: null,
      rest: 'Jana Nová',
      genderHint: 'female',
    });
    expect(extractTitles('p. Jan Novák').genderHint).toBe('male');
  });

  it('kombinuje oslovení, prefix i sufix', () => {
    expect(extractTitles('pan Ing. Jan Novák, CSc.')).toEqual({
      titlePrefix: 'Ing.',
      titleSuffix: 'CSc.',
      rest: 'Jan Novák',
      genderHint: 'male',
    });
  });

  it('hodnotu bez titulů vrátí beze změny', () => {
    expect(extractTitles('Jan Novák')).toEqual({
      titlePrefix: null,
      titleSuffix: null,
      rest: 'Jan Novák',
      genderHint: undefined,
    });
  });

  it('nespotřebuje celou hodnotu, když jsou v ní jen tituly', () => {
    expect(extractTitles('Ing.')).toEqual({
      titlePrefix: null,
      titleSuffix: null,
      rest: 'Ing.',
      genderHint: undefined,
    });
  });
});
