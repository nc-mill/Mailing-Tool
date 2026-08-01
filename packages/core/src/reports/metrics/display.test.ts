import { describe, expect, it } from 'vitest';
import { metricDisplay } from './display';

describe('metricDisplay', () => {
  it('u vypnutého měření vrací not_measured, nikdy nulu', () => {
    expect(
      metricDisplay({
        rate: null,
        absolute: 0,
        enabled: false,
        smallSample: false,
        disabledReason: 'opens_disabled',
      }),
    ).toEqual({
      kind: 'not_measured',
      reason: 'opens_disabled',
    });
  });

  it('u nulového jmenovatele vrací dash, ne nulu ani NaN', () => {
    expect(
      metricDisplay({
        rate: null,
        absolute: 0,
        enabled: true,
        smallSample: false,
        disabledReason: 'opens_disabled',
      }),
    ).toEqual({
      kind: 'dash',
    });
  });

  it('u malého vzorku vrací absolutní počet s příznakem', () => {
    expect(
      metricDisplay({
        rate: 0.25,
        absolute: 12,
        enabled: true,
        smallSample: true,
        disabledReason: 'opens_disabled',
      }),
    ).toEqual({
      kind: 'absolute',
      value: 12,
      rate: 0.25,
      hint: 'small_sample',
    });
  });

  it('jinak vrací míru', () => {
    expect(
      metricDisplay({
        rate: 0.164,
        absolute: 187,
        enabled: true,
        smallSample: false,
        disabledReason: 'clicks_disabled',
      }),
    ).toEqual({
      kind: 'rate',
      rate: 0.164,
      absolute: 187,
    });
  });
});
