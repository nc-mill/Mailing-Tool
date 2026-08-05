/**
 * Proč se metrika neukazuje číslem.
 *
 * První dva jsou ROZHODNUTÍ SPRÁVCE (vypnuté měření otevření a prokliků),
 * `delivery_unknown` je NAMĚŘENÝ STAV: doručení se vypnout nedá, ale dokud od
 * odesílací služby nedorazila ani jedna událost o osudu zprávy, není z čeho ho
 * vzít. Rozdíl je v tom, co s tím uživatel udělá (zapne měření vs. dokončí
 * nastavení oznámení), a proto to nejsou tytéž stavy.
 */
export type DisabledReason = 'opens_disabled' | 'clicks_disabled' | 'delivery_unknown';

/**
 * Vypnutý tracking nikdy nesmí vypadat jako nula (3.16 části 5).
 * Nula znamená "nikdo neotevřel", což je úplně jiná informace.
 */
export type MetricDisplay =
  | { kind: 'rate'; rate: number; absolute: number }
  | { kind: 'absolute'; value: number; rate: number; hint: 'small_sample' }
  | { kind: 'dash' }
  | { kind: 'not_measured'; reason: DisabledReason };

export function metricDisplay(input: {
  rate: number | null;
  absolute: number;
  enabled: boolean;
  smallSample: boolean;
  disabledReason: DisabledReason;
}): MetricDisplay {
  if (!input.enabled) return { kind: 'not_measured', reason: input.disabledReason };
  if (input.rate === null) return { kind: 'dash' };
  if (input.smallSample) {
    return { kind: 'absolute', value: input.absolute, rate: input.rate, hint: 'small_sample' };
  }
  return { kind: 'rate', rate: input.rate, absolute: input.absolute };
}
