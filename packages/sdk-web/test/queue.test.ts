import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../src/emitter';
import { EventQueue } from '../src/queue';
import { Storage } from '../src/storage';

describe('EventQueue', () => {
  let sent: string[];
  let beacon: ReturnType<typeof vi.fn>;
  let queue: EventQueue;
  let emitter: Emitter;

  const make = (over = {}) => {
    sent = [];
    beacon = vi.fn(() => true);
    emitter = new Emitter();
    queue = new EventQueue({
      host: 'https://events.shop.cz',
      key: 'ml_pub_aebagbafaydqqcik',
      storage: new Storage(),
      emitter,
      sendBeacon: beacon as unknown as (url: string, data: Blob) => boolean,
      fetchImpl: async (_url: RequestInfo | URL, init?: RequestInit) => {
        sent.push(String(init?.body));
        return new Response('{"accepted":1,"rejected":0}', { status: 202 });
      },
      ...over,
    });
    return queue;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    make();
  });
  afterEach(() => vi.useRealTimers());

  it('odešle dávku po dosažení dvaceti událostí', async () => {
    for (let i = 0; i < 20; i += 1) queue.push({ id: `e${i}`, name: 'page_view' });
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!).events).toHaveLength(20);
  });

  it('odešle dávku po pěti sekundách i s jedinou událostí', async () => {
    queue.push({ id: 'e1', name: 'page_view' });
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).toHaveLength(1);
  });

  it('payload nese verzi, veřejný klíč a sent_at', async () => {
    queue.push({ id: 'e1', name: 'page_view' });
    await vi.advanceTimersByTimeAsync(5000);
    const body = JSON.parse(sent[0]!);
    expect(body.v).toBe(1);
    expect(body.key).toBe('ml_pub_aebagbafaydqqcik');
    expect(body.sent_at).toMatch(/Z$/);
  });

  it('visibilitychange na hidden odešle frontu přes sendBeacon jako text/plain', () => {
    queue.push({ id: 'e1', name: 'page_view' });
    queue.attachLifecycleHandlers();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(beacon).toHaveBeenCalledTimes(1);
    const blob = beacon.mock.calls[0]![1] as Blob;
    // ODCHYLKA OD PLÁNU: plán čekal 'text/plain;charset=UTF-8', jenže konstruktor
    // Blobu podle specifikace typ převádí na malá písmena. Content-Type se porovnává
    // case insensitive, takže to pořád je jednoduchý požadavek bez preflightu.
    expect(blob.type).toBe('text/plain;charset=utf-8');
  });

  it('pagehide odešle frontu také, kvůli bfcache', () => {
    queue.push({ id: 'e1', name: 'page_view' });
    queue.attachLifecycleHandlers();
    window.dispatchEvent(new Event('pagehide'));
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it('selhání odeslání vrátí události do fronty a uloží je do localStorage', async () => {
    make({
      fetchImpl: async () => {
        throw new Error('offline');
      },
    });
    queue.push({ id: 'e1', name: 'page_view' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(localStorage.getItem('ml_q')).toContain('e1');
  });

  it('opakuje s exponenciálním backoffem 1, 2, 4, 8, 16 a 30 sekund', async () => {
    let attempts = 0;
    make({
      fetchImpl: async () => {
        attempts += 1;
        throw new Error('offline');
      },
    });
    queue.push({ id: 'e1', name: 'page_view' });
    await vi.advanceTimersByTimeAsync(5000);
    for (const delay of [1000, 2000, 4000, 8000, 16_000, 30_000]) {
      await vi.advanceTimersByTimeAsync(delay);
    }
    expect(attempts).toBeGreaterThanOrEqual(6);
    expect(attempts).toBeLessThanOrEqual(9);
  });

  it('odpověď 4xx kromě 408 a 429 znamená trvalou chybu a dávka se zahodí', async () => {
    const errors: unknown[] = [];
    make({ fetchImpl: async () => new Response('{}', { status: 422 }) });
    emitter.on('error', (payload) => errors.push(payload));
    queue.push({ id: 'e1', name: 'page_view' });
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(errors).toHaveLength(1);
    expect(localStorage.getItem('ml_q')).toBeNull();
  });

  it('odpověď 429 respektuje Retry-After', async () => {
    let attempts = 0;
    make({
      fetchImpl: async () => {
        attempts += 1;
        return new Response('{}', { status: 429, headers: { 'Retry-After': '3' } });
      },
    });
    queue.push({ id: 'e1', name: 'page_view' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(attempts).toBe(2);
  });

  it('zablokovaný sendBeacon vyvolá událost blocked a blokátor se neobchází', () => {
    const blocked: unknown[] = [];
    make({
      sendBeacon: () => false,
      fetchImpl: async () => {
        throw new Error('blocked');
      },
    });
    emitter.on('blocked', (payload) => blocked.push(payload));
    queue.push({ id: 'e1', name: 'page_view' });
    queue.attachLifecycleHandlers();
    window.dispatchEvent(new Event('pagehide'));
    expect(blocked).toHaveLength(1);
  });

  it('při načtení stránky se uložená fronta přehraje jako první', async () => {
    localStorage.setItem(
      'ml_q',
      JSON.stringify({ at: Date.now(), events: [{ id: 'old', name: 'page_view' }] }),
    );
    make();
    queue.replayStoredQueue();
    await vi.advanceTimersByTimeAsync(5000);
    expect(JSON.parse(sent[0]!).events[0].id).toBe('old');
  });

  it('flush vrátí Promise, která se vyřeší po odeslání', async () => {
    queue.push({ id: 'e1', name: 'page_view' });
    const promise = queue.flush();
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toBeUndefined();
    expect(sent).toHaveLength(1);
  });
});
