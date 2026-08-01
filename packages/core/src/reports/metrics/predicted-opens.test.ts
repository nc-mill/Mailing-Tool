import { describe, expect, it } from 'vitest';
import { emptyCounts } from './counts';
import { predictedOpens, wilsonInterval } from './predicted-opens';

describe('wilsonInterval', () => {
  it('vrací interval, který obsahuje bodový odhad', () => {
    const { low, high } = wilsonInterval(200, 700);
    expect(low).toBeLessThan(200 / 700);
    expect(high).toBeGreaterThan(200 / 700);
  });

  it('drží meze uvnitř nuly a jedničky i v krajních případech', () => {
    expect(wilsonInterval(0, 500).low).toBeGreaterThanOrEqual(0);
    expect(wilsonInterval(500, 500).high).toBeLessThanOrEqual(1);
  });

  it('s rostoucím vzorkem se interval zužuje', () => {
    const small = wilsonInterval(200, 700);
    const large = wilsonInterval(2000, 7000);
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
  });

  it('u vzorku 200 ze 700 dává meze zhruba 0,253 a 0,320', () => {
    const { low, high } = wilsonInterval(200, 700);
    expect(low).toBeCloseTo(0.2535, 3);
    expect(high).toBeCloseTo(0.3203, 3);
  });
});

describe('predictedOpens', () => {
  it('dopočítá rozsah z měřitelné části publika', () => {
    const counts = {
      ...emptyCounts(),
      delivered: 1000,
      opensUnique: 500,
      opensUniqueHuman: 200,
      opensUniqueApple: 300,
    };
    const prediction = predictedOpens(counts, 1000);
    expect(prediction).not.toBeNull();
    expect(prediction?.sampleSize).toBe(700);
    expect(prediction?.lowCount).toBe(Math.round(prediction!.low * 1000));
    expect(prediction?.highCount).toBe(Math.round(prediction!.high * 1000));
    expect(prediction!.lowCount).toBeLessThan(prediction!.highCount);
  });

  it('se nezobrazuje u malého vzorku, protože odhad by byl k ničemu', () => {
    const counts = {
      ...emptyCounts(),
      delivered: 220,
      opensUniqueHuman: 20,
      opensUniqueApple: 100,
    };
    expect(predictedOpens(counts, 220)).toBeNull();
  });

  it('se nezobrazuje, když nejsou žádní doručení', () => {
    expect(predictedOpens(emptyCounts(), 0)).toBeNull();
  });

  it('nikdy neodhadne víc otevření, než kolik je doručených', () => {
    const counts = {
      ...emptyCounts(),
      delivered: 1000,
      opensUniqueHuman: 690,
      opensUniqueApple: 300,
    };
    const prediction = predictedOpens(counts, 1000);
    expect(prediction!.highCount).toBeLessThanOrEqual(1000);
  });
});
