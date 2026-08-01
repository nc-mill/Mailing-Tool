import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TileCache } from './cache';

describe('TileCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('vrátí čerstvou hodnotu bez dalšího výpočtu', async () => {
    const cache = new TileCache();
    const compute = vi.fn().mockResolvedValue(42);
    const first = await cache.resolve('a', 60_000, compute);
    const second = await cache.resolve('a', 60_000, compute);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(second).toEqual({
      status: 'ok',
      data: 42,
      computedAt: first.status === 'ok' ? first.computedAt : '',
      stale: false,
    });
  });

  it('po vypršení TTL počítá znovu', async () => {
    const cache = new TileCache();
    const compute = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    await cache.resolve('a', 60_000, compute);
    vi.advanceTimersByTime(61_000);
    const result = await cache.resolve('a', 60_000, compute);
    expect(result).toMatchObject({ status: 'ok', data: 2 });
  });

  it('při chybě výpočtu vrátí poslední známou hodnotu označenou jako zastaralou', async () => {
    const cache = new TileCache();
    await cache.resolve('a', 60_000, async () => 1);
    vi.advanceTimersByTime(61_000);
    const result = await cache.resolve('a', 60_000, async () => {
      throw new Error('databáze mlčí');
    });
    expect(result).toMatchObject({ status: 'ok', data: 1, stale: true });
  });

  it('když není co vracet, přizná chybu dlaždice a nezhroutí celou odpověď', async () => {
    const cache = new TileCache();
    const result = await cache.resolve('a', 60_000, async () => {
      throw new Error('databáze mlčí');
    });
    expect(result).toEqual({ status: 'error', code: 'tile_unavailable' });
  });
});
