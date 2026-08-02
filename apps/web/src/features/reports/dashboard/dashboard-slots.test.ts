import { describe, expect, it } from 'vitest';
import { isStale, parsePeriod, tileOrder } from './dashboard-slots';

describe('parsePeriod', () => {
  it('bere jen povolená období, jinak třicet dní', () => {
    expect(parsePeriod('7')).toBe(7);
    expect(parsePeriod('365')).toBe(30);
    expect(parsePeriod(null)).toBe(30);
  });
});

describe('tileOrder', () => {
  it('proklik je první, otevření až za ním', () => {
    expect(tileOrder()[0]).toBe('click_rate');
    expect(tileOrder().indexOf('open_rate')).toBeGreaterThan(0);
  });
});

describe('isStale', () => {
  it('hodnota starší než dvojnásobek TTL se označí', () => {
    const now = new Date('2026-07-31T12:03:00.000Z');
    expect(isStale('2026-07-31T12:00:00.000Z', 60_000, now)).toBe(true);
    expect(isStale('2026-07-31T12:02:30.000Z', 60_000, now)).toBe(false);
  });
});
