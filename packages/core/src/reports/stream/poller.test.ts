import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyCounts } from '../metrics/counts';
import { PollerRegistry } from './poller';

function snapshot(version: number, sent: number) {
  return {
    version,
    updatedAt: new Date('2026-07-31T12:00:00.000Z'),
    counts: { ...emptyCounts(), sent },
    status: 'sending',
  };
}

describe('PollerRegistry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sto odběratelů na jedné kampani znamená jeden dotaz za interval (kritérium 97)', async () => {
    const load = vi.fn().mockResolvedValue(snapshot(1, 10));
    const registry = new PollerRegistry({ intervalMs: 2000, load });
    for (let i = 0; i < 100; i += 1) registry.subscribe('c1', () => {});
    await vi.advanceTimersByTimeAsync(2000);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('pošle zprávu jen při změně otisku', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(snapshot(1, 10))
      .mockResolvedValueOnce(snapshot(1, 10))
      .mockResolvedValueOnce(snapshot(2, 11));
    const registry = new PollerRegistry({ intervalMs: 2000, load });
    const received: number[] = [];
    registry.subscribe('c1', (data) => received.push(data.counts.sent));
    await vi.advanceTimersByTimeAsync(6000);
    expect(received).toEqual([10, 11]);
  });

  it('po odhlášení posledního odběratele se poller zastaví', async () => {
    const load = vi.fn().mockResolvedValue(snapshot(1, 10));
    const registry = new PollerRegistry({ intervalMs: 2000, load });
    const unsubscribe = registry.subscribe('c1', () => {});
    await vi.advanceTimersByTimeAsync(2000);
    unsubscribe();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(load).toHaveBeenCalledTimes(1);
    expect(registry.activeCampaigns).toBe(0);
  });

  it('nahlásí zapisovatele, který změnil počty a nezvýšil verzi', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(snapshot(1, 10))
      .mockResolvedValueOnce(snapshot(1, 11));
    const onStaleVersion = vi.fn();
    const registry = new PollerRegistry({ intervalMs: 2000, load, onStaleVersion });
    registry.subscribe('c1', () => {});
    await vi.advanceTimersByTimeAsync(4000);
    expect(onStaleVersion).toHaveBeenCalledWith('c1');
  });

  it('chyba načtení poller nezabije, další interval to zkusí znovu', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('databáze mlčí'))
      .mockResolvedValue(snapshot(2, 5));
    const registry = new PollerRegistry({ intervalMs: 2000, load });
    const received: number[] = [];
    registry.subscribe('c1', (data) => received.push(data.counts.sent));
    await vi.advanceTimersByTimeAsync(4000);
    expect(received).toEqual([5]);
  });
});
