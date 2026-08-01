import { trackingLogger } from '../logging';

const RETRY_DELAYS_MS = [100, 300, 900] as const;

export type EventBufferOptions<T> = {
  flushMs: number;
  batchSize: number;
  capacity: number;
  flush: (batch: T[]) => Promise<void>;
  onDrop?: (count: number) => void;
  onFlushDuration?: (seconds: number) => void;
};

/**
 * Buffer v procesu pro otevření a prokliky. Odpověď na požadavek se neblokuje
 * na databázi, viz 3.9.1. Tvrdý pád procesu ztratí až jeden interval, což je
 * vědomý a zapsaný kompromis proti ztrojnásobení latence přesměrování.
 */
export class EventBuffer<T> {
  #items: T[] = [];
  #timer: NodeJS.Timeout | null = null;
  #closed = false;
  #inFlight: Promise<void> = Promise.resolve();
  readonly #options: EventBufferOptions<T>;

  constructor(options: EventBufferOptions<T>) {
    this.#options = options;
  }

  get size(): number {
    return this.#items.length;
  }

  push(item: T): void {
    if (this.#closed) throw new Error('EventBuffer je po shutdown a nepřijímá další položky');

    if (this.#items.length >= this.#options.capacity) {
      const overflow = this.#items.length - this.#options.capacity + 1;
      this.#items.splice(0, overflow);
      this.#options.onDrop?.(overflow);
      trackingLogger().warn({ dropped: overflow }, 'tracking_writer_dropped');
    }

    this.#items.push(item);

    if (this.#items.length >= this.#options.batchSize) {
      void this.#drain();
      return;
    }
    if (this.#timer === null) {
      this.#timer = setTimeout(() => void this.#drain(), this.#options.flushMs);
      this.#timer.unref?.();
    }
  }

  async shutdown(): Promise<void> {
    this.#closed = true;
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    await this.#drain();
    await this.#inFlight;
  }

  async #drain(): Promise<void> {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    if (this.#items.length === 0) return;

    const batch = this.#items;
    this.#items = [];
    this.#inFlight = this.#inFlight.then(() => this.#writeWithRetry(batch));
    await this.#inFlight;
  }

  async #writeWithRetry(batch: T[]): Promise<void> {
    const startedAt = Date.now();
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        await this.#options.flush(batch);
        this.#options.onFlushDuration?.((Date.now() - startedAt) / 1000);
        return;
      } catch (error) {
        if (attempt === RETRY_DELAYS_MS.length) {
          this.#options.onDrop?.(batch.length);
          trackingLogger().error(
            { err: error, dropped: batch.length },
            'tracking_writer_flush_failed',
          );
          return;
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, RETRY_DELAYS_MS[attempt]);
          timer.unref?.();
        });
      }
    }
  }
}
