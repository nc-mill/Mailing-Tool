import { oneClickRateLimit } from '@mlain/core/contacts';

/**
 * Limit odhlašovacího endpointu. PER TOKEN, nikdy per IP.
 *
 * Důvod je v `one-click.ts` domény: one-click POST posílá infrastruktura poštovního
 * providera z úzké sady serverových adres, takže per-IP limit by u kampaně na sto tisíc
 * adres začal odmítat legitimní odhlášení, poštovní klient by ukázal selhání a uživatel
 * by místo toho označil zprávu jako spam. Ochrana by způsobila přesně tu škodu,
 * které má bránit (kritérium 82).
 *
 * Okno je pevné a stav leží v paměti procesu. Při běhu ve víc instancích se strop
 * znásobí jejich počtem, což je bezpečná strana chyby: limit povolí víc, nikdy míň.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function consumeTokenRateLimit(token: string, now: number = Date.now()): boolean {
  const limit = oneClickRateLimit.perToken;
  const bucket = buckets.get(token);

  if (bucket === undefined || bucket.resetAt <= now) {
    if (buckets.size > 10_000) {
      for (const [key, value] of buckets) if (value.resetAt <= now) buckets.delete(key);
    }
    buckets.set(token, { count: 1, resetAt: now + limit.durationSeconds * 1000 });
    return true;
  }

  if (bucket.count >= limit.points) return false;
  bucket.count += 1;
  return true;
}

/** Jen pro testy: vyprázdní stav, aby jeden test neubíral strop druhému. */
export function resetTokenRateLimit(): void {
  buckets.clear();
}
