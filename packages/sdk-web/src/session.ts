import type { Storage } from './storage';
import { uuidv4 } from './uuid';

const DEFAULT_TIMEOUT_MINUTES = 30;
const MAX_SESSION_HOURS = 24;

export class Session {
  #startedAt = 0;
  readonly #storage: Storage;
  readonly #timeoutMs: number;

  constructor(storage: Storage, timeoutMinutes = DEFAULT_TIMEOUT_MINUTES) {
    this.#storage = storage;
    this.#timeoutMs = Math.min(Math.max(timeoutMinutes, 1), 1440) * 60_000;
  }

  /**
   * Vrátí ID session a příznak, jestli právě začala nová.
   * Session končí po nečinnosti nebo po 24 hodinách, podle toho, co nastane dřív.
   * Událost session_ended se neposílá: spolehlivé odeslání při zavření karty neexistuje,
   * konec se dopočítá při čtení jako poslední událost session.
   */
  current(now: number): { id: string; started: boolean } {
    const last = this.#storage.readLastActivity();
    const existing = this.#storage.readSessionId();

    const expiredByIdle = last === null || now - last > this.#timeoutMs;
    const expiredByAge =
      this.#startedAt !== 0 && now - this.#startedAt > MAX_SESSION_HOURS * 3600_000;

    if (existing === null || expiredByIdle || expiredByAge) {
      const id = uuidv4();
      this.#storage.writeSessionId(id);
      this.#storage.writeLastActivity(now);
      this.#startedAt = now;
      return { id, started: true };
    }

    this.#storage.writeLastActivity(now);
    return { id: existing, started: false };
  }
}
