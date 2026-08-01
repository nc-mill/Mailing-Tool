import { describe, expect, it } from 'vitest';
import { emptyCounts } from './counts';
import { breakdownShares, openBreakdown } from './open-breakdown';

describe('openBreakdown', () => {
  it('rozpadne otevření na tři skupiny podle 8.7.3 (kritérium 61)', () => {
    const b = openBreakdown({
      ...emptyCounts(),
      opensUnique: 500,
      opensUniqueHuman: 200,
      opensUniqueApple: 300,
      clicksUniqueHuman: 187,
    });
    expect(b).toEqual({
      verified: 200,
      machine: 300,
      uncertain: 0,
      total: 500,
      clickedFromVerified: 187,
    });
  });

  it('zbytek po ověřených a automatických je nejistý', () => {
    const b = openBreakdown({
      ...emptyCounts(),
      opensUnique: 832,
      opensUniqueHuman: 387,
      opensUniqueApple: 411,
    });
    expect(b.uncertain).toBe(34);
  });

  it('nikdy nevrací zápornou nejistou skupinu, ani když se čítače rozejdou', () => {
    const b = openBreakdown({
      ...emptyCounts(),
      opensUnique: 10,
      opensUniqueHuman: 8,
      opensUniqueApple: 7,
    });
    expect(b.uncertain).toBe(0);
    expect(b.verified + b.machine + b.uncertain).toBeGreaterThanOrEqual(b.total);
  });

  it('podíly v pruhu dávají dohromady jedničku', () => {
    const shares = breakdownShares(
      openBreakdown({
        ...emptyCounts(),
        opensUnique: 500,
        opensUniqueHuman: 200,
        opensUniqueApple: 300,
      }),
    );
    expect(shares.verified + shares.machine + shares.uncertain).toBeCloseTo(1, 10);
    expect(shares.verified).toBeCloseTo(0.4, 10);
  });

  it('u nulových otevření vrací nulové podíly, ne NaN', () => {
    const shares = breakdownShares(openBreakdown(emptyCounts()));
    expect(shares).toEqual({ verified: 0, machine: 0, uncertain: 0 });
  });
});
