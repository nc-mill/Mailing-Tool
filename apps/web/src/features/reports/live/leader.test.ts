import { describe, expect, it, vi } from 'vitest';
import { FakeChannel, electLeader } from './leader';

describe('electLeader', () => {
  it('první karta se stane vůdcem', async () => {
    vi.useFakeTimers();
    const bus = new Map<string, FakeChannel[]>();
    const promise = electLeader('c1', (name) => new FakeChannel(name, bus));
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;
    expect(result.isLeader).toBe(true);
    result.release();
    vi.useRealTimers();
  });

  it('druhá karta vůdcem není a dostává data od vůdce', async () => {
    vi.useFakeTimers();
    const bus = new Map<string, FakeChannel[]>();
    const firstPromise = electLeader('c1', (name) => new FakeChannel(name, bus));
    await vi.advanceTimersByTimeAsync(200);
    const first = await firstPromise;

    const secondPromise = electLeader('c1', (name) => new FakeChannel(name, bus));
    await vi.advanceTimersByTimeAsync(200);
    const second = await secondPromise;
    expect(second.isLeader).toBe(false);

    const received: unknown[] = [];
    second.onMessage((data) => received.push(data));
    first.broadcast({ sent: 5 });
    expect(received).toEqual([{ sent: 5 }]);
    first.release();
    second.release();
    vi.useRealTimers();
  });

  it('bez BroadcastChannel se karta chová jako vůdce, jen si otevře vlastní spojení (kritérium 96)', async () => {
    vi.useFakeTimers();
    const promise = electLeader('c1', () => null);
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;
    expect(result.isLeader).toBe(true);
    result.release();
    vi.useRealTimers();
  });

  it('když vůdce skončí, následovník se to dozví a může se postavit na vlastní nohy', async () => {
    vi.useFakeTimers();
    const bus = new Map<string, FakeChannel[]>();
    const firstPromise = electLeader('c1', (name) => new FakeChannel(name, bus));
    await vi.advanceTimersByTimeAsync(200);
    const first = await firstPromise;
    const secondPromise = electLeader('c1', (name) => new FakeChannel(name, bus));
    await vi.advanceTimersByTimeAsync(200);
    const second = await secondPromise;

    let gone = false;
    second.onLeaderGone(() => {
      gone = true;
    });
    first.release();
    expect(gone).toBe(true);
    second.release();
    vi.useRealTimers();
  });
});
