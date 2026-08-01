import { describe, expect, it } from 'vitest';
import { buildPreview } from '../preview';

const gates = {
  raw: 1208,
  eligible: 1129,
  excluded_suppressed: 12,
  excluded_unsubscribed: 43,
  excluded_unconfirmed: 17,
  excluded_snoozed: 4,
  excluded_processing_restricted: 3,
  excluded_invalid_email: 0,
  excluded_deleted: 0,
  excluded_sample: 0,
  duplicates_removed: 0,
};

describe('nahled publika', () => {
  it('soucet vyloucenych plus vysledek se rovna vstupnimu poctu', () => {
    const p = buildPreview({ gates, sample: [], exact: true, computedAt: new Date(0) });
    const sum =
      p.breakdown.excluded_suppressed +
      p.breakdown.excluded_unsubscribed +
      p.breakdown.excluded_unconfirmed +
      p.breakdown.excluded_snoozed +
      p.breakdown.excluded_processing_restricted +
      p.breakdown.excluded_invalid_email +
      p.breakdown.excluded_deleted +
      p.breakdown.excluded_sample +
      p.breakdown.duplicates_removed;
    expect(sum + p.total).toBe(gates.raw);
  });

  it('total je eligible, nikdy vlastni vypocet', () => {
    expect(buildPreview({ gates, sample: [], exact: true, computedAt: new Date(0) }).total).toBe(
      1129,
    );
  });

  it('pri timeoutu vraci exact false a odhad', () => {
    const p = buildPreview({
      gates: { ...gates, eligible: 1100 },
      sample: [],
      exact: false,
      computedAt: new Date(0),
    });
    expect(p.exact).toBe(false);
  });

  it('vzorek ma nejvyse 20 polozek', () => {
    const sample = Array.from({ length: 50 }, (_, i) => ({
      contact_id: `c${i}`,
      email: `a${i}@x.cz`,
      first_name: null,
    }));
    expect(
      buildPreview({ gates, sample, exact: true, computedAt: new Date(0) }).sample,
    ).toHaveLength(20);
  });

  it('nulove brany zustavaji v rozpadu, aby bylo videt, ze se kontrolovaly', () => {
    const p = buildPreview({ gates, sample: [], exact: true, computedAt: new Date(0) });
    expect(p.breakdown).toHaveProperty('excluded_invalid_email', 0);
  });
});
