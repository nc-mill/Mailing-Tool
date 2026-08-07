import { describe, expect, it } from 'vitest';
import { emptyCounts, type StatsCounts } from './counts';
import { computeRates, deliveredEffective, isSmallSample } from './rates';

/** Případ z akceptačních kritérií 61 a 62 části 5. */
const APPLE_CASE: StatsCounts = {
  ...emptyCounts(),
  materialized: 1000,
  sent: 1000,
  delivered: 1000,
  opensTotal: 900,
  opensUnique: 500,
  opensUniqueHuman: 200,
  opensUniqueApple: 300,
  clicksTotal: 210,
  clicksUnique: 190,
  clicksUniqueHuman: 187,
  clicksScanner: 20,
  unsubscribed: 4,
};

const BOTH_ON = { trackOpens: true, trackClicks: true };

describe('deliveredEffective', () => {
  it('u provideru s událostmi doručení vrací delivered', () => {
    expect(
      deliveredEffective({ ...emptyCounts(), sent: 100, delivered: 97 }, 'provider_events'),
    ).toBe(97);
  });

  it('bez událostí doručení odečítá odrazy a selhání od odeslaných', () => {
    expect(
      deliveredEffective(
        { ...emptyCounts(), sent: 100, bouncedHard: 3, bouncedSoft: 2, failed: 1 },
        'derived_from_sent',
      ),
    ).toBe(94);
  });

  it('nikdy nevrací záporné číslo', () => {
    expect(
      deliveredEffective({ ...emptyCounts(), sent: 1, bouncedHard: 5 }, 'derived_from_sent'),
    ).toBe(0);
  });

  /**
   * Odmítnutá zpráva má status `sent`, protože se odeslání pokusilo, ale
   * poskytovatel ji nepřijal. Dokud pro ni nebyl čítač, zůstávala v odeslaných
   * a od ničeho se neodečítala, takže PLATILA ZA DORUČENOU: kampaň, kterou
   * poskytovatel celou odmítl, vykazovala stoprocentní doručenost.
   */
  it('ČÍSLA: odečítá odmítnuté poskytovatelem, jinak platí za doručené', () => {
    const counts = { ...emptyCounts(), sent: 100, rejected: 40, bouncedHard: 2 };
    expect(deliveredEffective(counts, 'derived_from_sent')).toBe(58);
  });

  it('ČÍSLA: kampaň odmítnutá celá nemá stoprocentní doručenost, ale nulovou', () => {
    const counts = { ...emptyCounts(), sent: 100, rejected: 100 };
    expect(deliveredEffective(counts, 'derived_from_sent')).toBe(0);
  });

  /**
   * Ve větvi `provider_events` je `delivered` počet potvrzení od poskytovatele
   * a ten k odmítnuté zprávě potvrzení nepošle, takže se odečítat nesmí.
   * Bez tohohle tvrzení by se odmítnutí započítalo dvakrát.
   */
  it('u provideru s událostmi doručení se odmítnuté NEODEČÍTAJÍ podruhé', () => {
    const counts = { ...emptyCounts(), sent: 100, delivered: 60, rejected: 40 };
    expect(deliveredEffective(counts, 'provider_events')).toBe(60);
  });
});

describe('computeRates', () => {
  it('počítá ověřenou míru otevření z jmenovatele bez Apple příjemců (kritérium 62)', () => {
    const rates = computeRates(APPLE_CASE, 'provider_events', BOTH_ON);
    expect(rates.verifiedOpenRate).toBeCloseTo(200 / 700, 10);
    expect(rates.verifiedOpenRate).not.toBeCloseTo(200 / 1000, 4);
  });

  it('počítá míru otevření z doručených', () => {
    expect(computeRates(APPLE_CASE, 'provider_events', BOTH_ON).openRate).toBeCloseTo(0.5, 10);
  });

  it('počítá CTOR z ověřených otevření, ne ze všech (kritérium 63)', () => {
    const rates = computeRates(APPLE_CASE, 'provider_events', BOTH_ON);
    expect(rates.clickToOpenRate).toBeCloseTo(187 / 200, 10);
  });

  it('počítá míru prokliku z doručených a z ověřených prokliků', () => {
    expect(computeRates(APPLE_CASE, 'provider_events', BOTH_ON).clickRate).toBeCloseTo(
      187 / 1000,
      10,
    );
  });

  it('počítá míru odmítnutí z odeslaných, ne z doručených', () => {
    const counts = { ...APPLE_CASE, bouncedHard: 8, bouncedSoft: 4 };
    expect(computeRates(counts, 'provider_events', BOTH_ON).bounceRate).toBeCloseTo(12 / 1000, 10);
  });

  it('vrací null místo dělení nulou', () => {
    const rates = computeRates(emptyCounts(), 'provider_events', BOTH_ON);
    expect(rates.openRate).toBeNull();
    expect(rates.clickRate).toBeNull();
    expect(rates.bounceRate).toBeNull();
    expect(rates.clickToOpenRate).toBeNull();
  });

  it('nezobrazuje ověřenou míru pod padesáti měřitelnými příjemci', () => {
    const counts = {
      ...emptyCounts(),
      sent: 60,
      delivered: 60,
      opensUnique: 20,
      opensUniqueHuman: 8,
      opensUniqueApple: 30,
    };
    expect(computeRates(counts, 'provider_events', BOTH_ON).verifiedOpenRate).toBeNull();
  });

  it('u kampaně s vypnutým měřením otevření vrací null, ne nulu (kritérium 65)', () => {
    const rates = computeRates(APPLE_CASE, 'provider_events', {
      trackOpens: false,
      trackClicks: true,
    });
    expect(rates.openRate).toBeNull();
    expect(rates.machineOpenShare).toBeNull();
    expect(rates.verifiedOpenRate).toBeNull();
    expect(rates.clickToOpenRate).toBeNull();
    expect(rates.clickRate).toBeCloseTo(187 / 1000, 10);
  });

  it('u kampaně s vypnutým měřením prokliků vrací null u prokliků', () => {
    const rates = computeRates(APPLE_CASE, 'provider_events', {
      trackOpens: true,
      trackClicks: false,
    });
    expect(rates.clickRate).toBeNull();
    expect(rates.clickToOpenRate).toBeNull();
    expect(rates.openRate).toBeCloseTo(0.5, 10);
  });
});

describe('isSmallSample', () => {
  it('je pravda pod dvěma sty doručenými (kritérium 66)', () => {
    expect(isSmallSample(199)).toBe(true);
    expect(isSmallSample(200)).toBe(false);
  });
});
