export type DisabledReason = 'opens_disabled' | 'clicks_disabled';

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
