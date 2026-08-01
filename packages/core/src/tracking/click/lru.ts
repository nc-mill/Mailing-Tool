type Entry<V> = { value: V; expiresAt: number };

export type TtlLruOptions = { capacity: number; ttlMs: number };

/**
 * LRU s TTL a single flight. Vlastní implementace schválně:
 * lru-cache je pod BlueOak-1.0.0, což není na whitelistu licenční brány,
 * a tahle věc je čtyřicet řádků.
 * Pořadí drží Map, která si v JavaScriptu pamatuje pořadí vložení.
 */
export class TtlLru<K, V> {
  readonly #entries = new Map<K, Entry<V>>();
  readonly #pending = new Map<K, Promise<V>>();
  readonly #capacity: number;
  readonly #ttlMs: number;

  constructor(options: TtlLruOptions) {
    this.#capacity = options.capacity;
    this.#ttlMs = options.ttlMs;
  }

  get size(): number {
    return this.#entries.size;
  }

  get(key: K): V | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.#entries.delete(key);
      return undefined;
    }
    // dotek posune položku na konec, tedy mezi nedávno použité
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    this.#entries.delete(key);
    this.#entries.set(key, { value, expiresAt: Date.now() + this.#ttlMs });
    while (this.#entries.size > this.#capacity) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) break;
      this.#entries.delete(oldest.value);
    }
  }

  /** Souběžné požadavky na týž klíč čekají na jedno naplnění. */
  async getOrLoad(key: K, loader: () => Promise<V>): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    const inFlight = this.#pending.get(key);
    if (inFlight !== undefined) return inFlight;

    const promise = loader()
      .then((value) => {
        this.set(key, value);
        return value;
      })
      .finally(() => {
        this.#pending.delete(key);
      });

    this.#pending.set(key, promise);
    return promise;
  }

  setMany(entries: Iterable<readonly [K, V]>): void {
    for (const [key, value] of entries) this.set(key, value);
  }
}
