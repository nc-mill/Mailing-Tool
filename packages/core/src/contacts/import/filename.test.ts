import { describe, expect, it } from 'vitest';
import { decodeUploadFilename } from './filename';

/**
 * Vada, kterou tenhle soubor hlídá, zastavila celý import u prvního kroku:
 * hlavičky HTTP unesou jen Latin-1, takže „kontakty-červen.csv" se v nich
 * nedá poslat v nezměněné podobě. Klient jméno kóduje procentově a server ho
 * musí umět vrátit, jinak se do seznamu importů zapíše „kontakty-%C4%8Derven.csv".
 */
describe('decodeUploadFilename', () => {
  it('vrátí diakritiku v původní podobě', () => {
    expect(decodeUploadFilename('kontakty-%C4%8Derven.csv')).toBe('kontakty-červen.csv');
  });

  it('nechá nezakódované jméno být', () => {
    expect(decodeUploadFilename('contacts.csv')).toBe('contacts.csv');
  });

  it('projde jménem s osamoceným procentem místo odmítnutí nahrání', () => {
    expect(decodeUploadFilename('sleva 50%.csv')).toBe('sleva 50%.csv');
  });

  it('dosadí náhradní jméno, když hlavička chybí', () => {
    expect(decodeUploadFilename(null)).toBe('import.csv');
    expect(decodeUploadFilename('')).toBe('import.csv');
  });

  it('projde i mezerou a plusem, které se v URL kódují jinak', () => {
    expect(decodeUploadFilename('nové%20kontakty%20(2).csv')).toBe('nové kontakty (2).csv');
    expect(decodeUploadFilename('a%2Bb.csv')).toBe('a+b.csv');
  });
});
