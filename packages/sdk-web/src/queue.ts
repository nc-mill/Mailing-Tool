import type { Emitter } from './emitter';
import type { Storage } from './storage';

declare const __SDK_VERSION__: string;

const BATCH_SIZE = 20;
const FLUSH_INTERVAL_MS = 5000;
const MAX_BATCH_BYTES = 24 * 1024;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16_000, 30_000] as const;
const MAX_ATTEMPTS = 8;

export type QueuedEvent = { id: string; name: string; [key: string]: unknown };

export type EventQueueOptions = {
  host: string;
  key: string;
  storage: Storage;
  emitter: Emitter;
  // ODCHYLKA OD PLÁNU: volitelné položky mají v typu i undefined.
  // Monorepo má exactOptionalPropertyTypes, takže bez toho nejde předat
  // runtime.sendBeacon, které undefined být může.
  anonymousId?: (() => string | null) | undefined;
  sendBeacon?: ((url: string, data: Blob) => boolean) | undefined;
  fetchImpl?: typeof fetch | undefined;
};

export class EventQueue {
  #items: QueuedEvent[] = [];
  #timer: ReturnType<typeof setTimeout> | null = null;
  #attempt = 0;
  #inFlight: Promise<void> = Promise.resolve();
  readonly #options: EventQueueOptions;

  constructor(options: EventQueueOptions) {
    this.#options = options;
  }

  push(event: QueuedEvent): void {
    this.#items.push(event);
    if (this.#items.length >= BATCH_SIZE || JSON.stringify(this.#items).length >= MAX_BATCH_BYTES) {
      void this.#drain();
      return;
    }
    if (this.#timer === null) {
      this.#timer = setTimeout(() => void this.#drain(), FLUSH_INTERVAL_MS);
    }
  }

  replayStoredQueue(): void {
    const stored = this.#options.storage.readQueue() as QueuedEvent[];
    if (stored.length === 0) return;
    this.#items = [...stored, ...this.#items];
    if (this.#timer === null) {
      this.#timer = setTimeout(() => void this.#drain(), FLUSH_INTERVAL_MS);
    }
  }

  async flush(): Promise<void> {
    await this.#drain();
    await this.#inFlight;
  }

  /**
   * beforeunload a unload se na mobilech často nespustí vůbec.
   * visibilitychange na hidden se spouští spolehlivě, pagehide doplňuje bfcache.
   */
  attachLifecycleHandlers(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.#sendBeaconBatch();
    });
    window.addEventListener('pagehide', () => this.#sendBeaconBatch());
  }

  #payload(events: QueuedEvent[]): string {
    return JSON.stringify({
      v: 1,
      key: this.#options.key,
      sent_at: new Date().toISOString(),
      anonymous_id: this.#options.anonymousId?.() ?? undefined,
      events: events.map((event) => ({
        ...event,
        context: {
          ...(event.context as object),
          sdk: { name: 'ml-web', version: __SDK_VERSION__ },
        },
      })),
    });
  }

  #sendBeaconBatch(): void {
    if (this.#items.length === 0) return;
    const batch = this.#items;
    this.#items = [];
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }

    const beacon = this.#options.sendBeacon ?? navigator.sendBeacon.bind(navigator);
    // text/plain je jeden ze tří typů, které nevyvolají preflight.
    const blob = new Blob([this.#payload(batch)], { type: 'text/plain;charset=UTF-8' });

    let delivered = false;
    try {
      delivered = beacon(`${this.#options.host}/e/track`, blob);
    } catch {
      delivered = false;
    }

    if (!delivered) {
      // Blokátor nebo plná fronta prohlížeče. Neobchází se, jen se to ohlásí.
      this.#items = [...batch, ...this.#items];
      this.#options.storage.writeQueue(this.#items);
      this.#options.emitter.emit('blocked', { events: batch.length });
    }
  }

  async #drain(): Promise<void> {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    if (this.#items.length === 0) return;

    const batch = this.#items;
    this.#items = [];
    this.#inFlight = this.#inFlight.then(() => this.#send(batch));
    await this.#inFlight;
  }

  async #send(batch: QueuedEvent[]): Promise<void> {
    const fetchImpl = this.#options.fetchImpl ?? fetch;
    try {
      const response = await fetchImpl(`${this.#options.host}/e/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: this.#payload(batch),
        keepalive: true,
      });

      if (response.ok) {
        this.#attempt = 0;
        this.#options.storage.writeQueue([]);
        return;
      }

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('Retry-After') ?? '1');
        this.#retry(batch, Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000);
        return;
      }
      if (response.status >= 400 && response.status < 500 && response.status !== 408) {
        // Trvalá chyba. Opakovat nemá smysl, dávka se zahodí.
        this.#attempt = 0;
        this.#options.storage.writeQueue([]);
        this.#options.emitter.emit('error', { status: response.status });
        return;
      }
      this.#retry(batch, BACKOFF_MS[Math.min(this.#attempt, BACKOFF_MS.length - 1)]!);
    } catch {
      this.#retry(batch, BACKOFF_MS[Math.min(this.#attempt, BACKOFF_MS.length - 1)]!);
    }
  }

  #retry(batch: QueuedEvent[], delayMs: number): void {
    this.#attempt += 1;
    if (this.#attempt > MAX_ATTEMPTS) {
      this.#attempt = 0;
      this.#options.emitter.emit('error', { dropped: batch.length });
      return;
    }
    this.#items = [...batch, ...this.#items];
    this.#options.storage.writeQueue(this.#items);
    this.#timer = setTimeout(() => void this.#drain(), delayMs);
  }
}
