import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TtlLru } from './lru';

describe('TtlLru', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('vrátí uloženou hodnotu', () => {
    const lru = new TtlLru<string, number>({ capacity: 2, ttlMs: 1000 });
    lru.set('a', 1);
    expect(lru.get('a')).toBe(1);
  });

  it('po vypršení TTL vrátí undefined', () => {
    const lru = new TtlLru<string, number>({ capacity: 2, ttlMs: 1000 });
    lru.set('a', 1);
    vi.advanceTimersByTime(1001);
    expect(lru.get('a')).toBeUndefined();
  });

  it('při překročení kapacity vypadne nejdéle nepoužitá položka', () => {
    const lru = new TtlLru<string, number>({ capacity: 2, ttlMs: 1000 });
    lru.set('a', 1);
    lru.set('b', 2);
    lru.get('a');
    lru.set('c', 3);
    expect(lru.get('b')).toBeUndefined();
    expect(lru.get('a')).toBe(1);
    expect(lru.get('c')).toBe(3);
  });

  it('single flight udělá jedno naplnění pro souběžné požadavky', async () => {
    const lru = new TtlLru<string, number>({ capacity: 10, ttlMs: 1000 });
    let calls = 0;
    const loader = async (): Promise<number> => {
      calls += 1;
      return 42;
    };
    const [a, b, c] = await Promise.all([
      lru.getOrLoad('k', loader),
      lru.getOrLoad('k', loader),
      lru.getOrLoad('k', loader),
    ]);
    expect([a, b, c]).toEqual([42, 42, 42]);
    expect(calls).toBe(1);
  });

  it('selhání loaderu se nezacachuje a další pokus loader zavolá znovu', async () => {
    const lru = new TtlLru<string, number>({ capacity: 10, ttlMs: 1000 });
    let calls = 0;
    const failing = async (): Promise<number> => {
      calls += 1;
      throw new Error('nedostupná databáze');
    };
    await expect(lru.getOrLoad('k', failing)).rejects.toThrow();
    await expect(lru.getOrLoad('k', failing)).rejects.toThrow();
    expect(calls).toBe(2);
  });
});
