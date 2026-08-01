import type { StatsCounts } from './counts';
import { SMALL_SAMPLE_THRESHOLD } from './rates';

/** Kvantil normálního rozdělení pro 95% interval. */
export const Z_95 = 1.959963984540054;

export type Interval = { low: number; high: number };

export type PredictedOpens = Interval & {
  lowCount: number;
  highCount: number;
  sampleSize: number;
};

/**
 * Wilsonův skórový interval. Proti obvyklému normálnímu intervalu se chová
 * rozumně i u malých podílů a nikdy nevyleze mimo interval nula až jedna,
 * což je u míry otevření podstatné: normální interval by u tří procent
 * vyrobil zápornou spodní mez a odhad by vypadal jako chyba.
 */
export function wilsonInterval(successes: number, sample: number, z: number = Z_95): Interval {
  if (sample <= 0) return { low: 0, high: 0 };
  const k = Math.min(Math.max(successes, 0), sample);
  const p = k / sample;
  const z2 = z * z;
  const denominator = 1 + z2 / sample;
  const center = (p + z2 / (2 * sample)) / denominator;
  const half = (z / denominator) * Math.sqrt((p * (1 - p)) / sample + z2 / (4 * sample * sample));
  return {
    low: Math.max(0, center - half),
    high: Math.min(1, center + half),
  };
}

/**
 * Prediktivní otevření: kolik lidí by e-mail otevřelo, kdyby se dalo měřit
 * u celého publika. Model bere ověřenou míru otevření z části publika, kterou
 * Apple nezkresluje, a promítne ji na všechny doručené.
 *
 * Vrací null, když je měřitelná část publika pod prahem malého vzorku.
 * Model nad padesáti lidmi by dal rozsah tak široký, že by nic neříkal,
 * a číslo, které nic neříká, je horší než žádné.
 */
export function predictedOpens(
  counts: StatsCounts,
  deliveredEffectiveValue: number,
): PredictedOpens | null {
  const sampleSize = deliveredEffectiveValue - counts.opensUniqueApple;
  if (deliveredEffectiveValue <= 0 || sampleSize < SMALL_SAMPLE_THRESHOLD) return null;

  const { low, high } = wilsonInterval(counts.opensUniqueHuman, sampleSize);
  return {
    low,
    high,
    lowCount: Math.round(low * deliveredEffectiveValue),
    highCount: Math.round(high * deliveredEffectiveValue),
    sampleSize,
  };
}
