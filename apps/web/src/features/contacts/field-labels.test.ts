import { describe, expect, it } from 'vitest';
import { nextFieldLabels } from './field-labels';

/**
 * Popisek pole je otevřená mapa jazyků s povinným `en`. Obrazovka nabízí jedno
 * textové pole, takže se musí rozhodnout, co se stane se zbytkem mapy.
 */
describe('nextFieldLabels', () => {
  it('přepíše JEN jazyk rozhraní a zbytek mapy nechá být', () => {
    expect(nextFieldLabels({ cs: 'Město', en: 'City' }, 'cs', 'Obec')).toEqual({
      cs: 'Obec',
      en: 'City',
    });
  });

  it('cizí jazyky v mapě přežijí, i když je obrazovka nenabízí', () => {
    expect(nextFieldLabels({ cs: 'Město', en: 'City', de: 'Stadt' }, 'cs', 'Obec')).toEqual({
      cs: 'Obec',
      en: 'City',
      de: 'Stadt',
    });
  });

  /**
   * `en` je povinné. Kdyby chybělo, skončil by zápis na 422
   * `required_field_missing` a uživatel by u přejmenování dostal chybu, které
   * nemůže rozumět.
   */
  it('chybějící en doplní, aby zápis neskončil na 422', () => {
    expect(nextFieldLabels({ cs: 'Město' }, 'cs', 'Obec')).toEqual({ cs: 'Obec', en: 'Obec' });
    expect(nextFieldLabels({ cs: 'Město', en: '' }, 'cs', 'Obec')).toEqual({
      cs: 'Obec',
      en: 'Obec',
    });
  });
});
