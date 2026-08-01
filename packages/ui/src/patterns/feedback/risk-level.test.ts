import { describe, expect, it } from 'vitest';
import { riskLevel } from './risk-level';

describe('riskLevel', () => {
  it('odebrání kontaktu ze seznamu je N1', () => {
    expect(riskLevel({ scope: 0, recoverability: 0, externalImpact: 0 })).toBe('N1');
  });

  it('smazání jednoho kontaktu je N2', () => {
    expect(riskLevel({ scope: 0, recoverability: 2, externalImpact: 0 })).toBe('N2');
  });

  it('hromadné smazání 500 kontaktů je N3', () => {
    expect(riskLevel({ scope: 2, recoverability: 2, externalImpact: 0 })).toBe('N3');
  });

  it('smazání projektu je N4', () => {
    expect(riskLevel({ scope: 2, recoverability: 2, externalImpact: 2 })).toBe('N4');
  });

  it('smazání segmentu je N1, protože je plně vratné', () => {
    // Definice se drží 30 dní v koši a kontakty se nemažou,
    // takže obnovitelnost je 0. Vnější dopad zůstává 1.
    expect(riskLevel({ scope: 0, recoverability: 0, externalImpact: 1 })).toBe('N1');
  });

  it('hromadná akce nad více než 20 položkami se povyšuje na dlouhou úlohu', () => {
    expect(riskLevel({ scope: 0, recoverability: 0, externalImpact: 0 }, { bulkCount: 50 })).toBe(
      'N2',
    );
  });

  it('hromadná destruktivní akce se povyšuje aspoň na N3', () => {
    expect(
      riskLevel(
        { scope: 1, recoverability: 1, externalImpact: 0 },
        { bulkCount: 50, destructive: true },
      ),
    ).toBe('N3');
  });
});
