import { uuidv4 } from './uuid';

export const KEYS = {
  anonymousId: 'ml_aid',
  sessionId: 'ml_sid',
  lastActivity: 'ml_last',
  queue: 'ml_q',
} as const;

const COOKIE_MAX_AGE_SECONDS = 34_560_000; // 400 dní
const QUEUE_TTL_MS = 7 * 24 * 3600 * 1000;
const QUEUE_MAX_EVENTS = 100;
const QUEUE_MAX_BYTES = 256 * 1024;

/** Každý přístup k úložišti je obalený: v privátním režimu vyhazuje výjimky. */
function safeGet(store: globalThis.Storage | undefined, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function safeSet(store: globalThis.Storage | undefined, key: string, value: string): void {
  try {
    store?.setItem(key, value);
  } catch {
    // Privátní režim nebo plná kvóta. Sběr pokračuje jen v paměti.
  }
}
function safeRemove(store: globalThis.Storage | undefined, key: string): void {
  try {
    store?.removeItem(key);
  } catch {
    // nic
  }
}

function readCookie(name: string): string | null {
  const parts = document.cookie.split('; ');
  for (const part of parts) {
    const eq = part.indexOf('=');
    // Prázdná hodnota se bere jako neexistující: tak vypadá smazaná cookie
    // ve chvíli, kdy prohlížeč záznam ještě nezahodil.
    if (eq !== -1 && part.slice(0, eq) === name && part.length > eq + 1) return part.slice(eq + 1);
  }
  return null;
}

/**
 * ODCHYLKA OD PLÁNU: příznak Secure se přidává jen na HTTPS.
 * Plán ho měl natvrdo, jenže prohlížeč cookie se Secure na http:// zahodí
 * a SDK by na měřicí doméně http://localhost:3200 nefungovalo vůbec.
 * V produkci běží ingestion přes HTTPS, takže tam Secure zůstává.
 */
function cookieAttributes(): string {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  return `; SameSite=Lax${secure}; Path=/`;
}

export class Storage {
  readAnonymousId(): string | null {
    // localStorage je primární zdroj, protože Safari ITP cookie zkracuje na 7 dní.
    return safeGet(globalThis.localStorage, KEYS.anonymousId) ?? readCookie(KEYS.anonymousId);
  }

  ensureAnonymousId(): string {
    const id = this.readAnonymousId() ?? uuidv4();
    safeSet(globalThis.localStorage, KEYS.anonymousId, id);
    // Doména se nenastavuje, cookie platí jen pro přesný host.
    document.cookie = `${KEYS.anonymousId}=${id}; Max-Age=${COOKIE_MAX_AGE_SECONDS}${cookieAttributes()}`;
    return id;
  }

  readSessionId(): string | null {
    return safeGet(globalThis.sessionStorage, KEYS.sessionId);
  }

  writeSessionId(id: string): void {
    safeSet(globalThis.sessionStorage, KEYS.sessionId, id);
  }

  readLastActivity(): number | null {
    const raw = safeGet(globalThis.localStorage, KEYS.lastActivity);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  writeLastActivity(at: number): void {
    safeSet(globalThis.localStorage, KEYS.lastActivity, String(at));
  }

  readQueue(): unknown[] {
    const raw = safeGet(globalThis.localStorage, KEYS.queue);
    if (raw === null) return [];
    try {
      const parsed = JSON.parse(raw) as { at: number; events: unknown[] };
      // Starší než sedm dní se zahodí, delší retry SDK nedělá.
      if (!Array.isArray(parsed.events) || Date.now() - parsed.at > QUEUE_TTL_MS) {
        safeRemove(globalThis.localStorage, KEYS.queue);
        return [];
      }
      return parsed.events;
    } catch {
      safeRemove(globalThis.localStorage, KEYS.queue);
      return [];
    }
  }

  writeQueue(events: unknown[]): void {
    const trimmed = events.slice(-QUEUE_MAX_EVENTS);
    // ODCHYLKA OD PLÁNU: prázdná fronta klíč maže místo toho, aby ukládala
    // prázdné pole. Plán ukládal {"at":...,"events":[]}, což je zbytečný záznam
    // v localStorage a po úspěšném odeslání by v prohlížeči zůstal viset navždy.
    if (trimmed.length === 0) {
      safeRemove(globalThis.localStorage, KEYS.queue);
      return;
    }
    const payload = JSON.stringify({ at: Date.now(), events: trimmed });
    if (payload.length > QUEUE_MAX_BYTES) {
      safeSet(
        globalThis.localStorage,
        KEYS.queue,
        JSON.stringify({ at: Date.now(), events: trimmed.slice(-20) }),
      );
      return;
    }
    safeSet(globalThis.localStorage, KEYS.queue, payload);
  }

  clear(): void {
    for (const key of Object.values(KEYS)) {
      safeRemove(globalThis.localStorage, key);
      safeRemove(globalThis.sessionStorage, key);
    }
    // Max-Age i Expires: staré prohlížeče znají jen Expires a některé implementace
    // (například happy-dom v testech) zase ignorují Max-Age.
    document.cookie = `${KEYS.anonymousId}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${cookieAttributes()}`;
  }
}
