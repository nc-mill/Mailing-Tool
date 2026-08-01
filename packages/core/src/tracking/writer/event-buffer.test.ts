import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBuffer } from './event-buffer';

type Item = { n: number };

describe('EventBuffer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('vyprázdní se po uplynutí intervalu', async () => {
    const flushed: Item[][] = [];
    const buffer = new EventBuffer<Item>({
      flushMs: 250,
      batchSize: 500,
      capacity: 100,
      flush: async (b) => {
        flushed.push(b);
      },
    });
    buffer.push({ n: 1 });
    expect(flushed).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(250);
    expect(flushed).toEqual([[{ n: 1 }]]);
  });

  it('vyprázdní se po dosažení velikosti dávky, aniž se čeká na interval', async () => {
    const flushed: Item[][] = [];
    const buffer = new EventBuffer<Item>({
      flushMs: 250,
      batchSize: 3,
      capacity: 100,
      flush: async (b) => {
        flushed.push(b);
      },
    });
    buffer.push({ n: 1 });
    buffer.push({ n: 2 });
    buffer.push({ n: 3 });
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed).toEqual([[{ n: 1 }, { n: 2 }, { n: 3 }]]);
  });

  it('při plném bufferu zahodí nejstarší a zvýší čítač', () => {
    const dropped: number[] = [];
    const buffer = new EventBuffer<Item>({
      flushMs: 250,
      batchSize: 500,
      capacity: 2,
      flush: async () => {},
      onDrop: (count) => dropped.push(count),
    });
    buffer.push({ n: 1 });
    buffer.push({ n: 2 });
    buffer.push({ n: 3 });
    expect(dropped).toEqual([1]);
    expect(buffer.size).toBe(2);
  });

  it('chyba zápisu se zkusí třikrát s odstupem 100, 300 a 900 ms, pak se zahodí', async () => {
    const attempts: number[] = [];
    const buffer = new EventBuffer<Item>({
      flushMs: 250,
      batchSize: 500,
      capacity: 100,
      flush: async () => {
        attempts.push(Date.now());
        throw new Error('nedostupná databáze');
      },
    });
    buffer.push({ n: 1 });
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(900);
    expect(attempts).toHaveLength(4); // první pokus plus tři opakování
    expect(buffer.size).toBe(0);
  });

  it('shutdown vyprázdní zbytek před ukončením', async () => {
    const flushed: Item[][] = [];
    const buffer = new EventBuffer<Item>({
      flushMs: 250,
      batchSize: 500,
      capacity: 100,
      flush: async (b) => {
        flushed.push(b);
      },
    });
    buffer.push({ n: 7 });
    await buffer.shutdown();
    expect(flushed).toEqual([[{ n: 7 }]]);
  });

  it('po shutdown se nová položka odmítne, ne tiše zahodí', async () => {
    const buffer = new EventBuffer<Item>({
      flushMs: 250,
      batchSize: 500,
      capacity: 100,
      flush: async () => {},
    });
    await buffer.shutdown();
    expect(() => buffer.push({ n: 1 })).toThrow(/shutdown/);
  });
});
