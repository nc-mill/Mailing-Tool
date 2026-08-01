import type { StatsCounts } from '../metrics/counts';

export type FingerprintInput = {
  version: number;
  updatedAt: Date;
  counts: StatsCounts;
};

/**
 * Otisk stavu kampaně. SSE poller podle něj rozhoduje, jestli má co poslat.
 * `ETag` zůstává podle 4.2 části 5 `W/"<version>"`; otisk je pojistka pro případ,
 * že by některý zapisovatel `version` nezvýšil.
 */
export function statsFingerprint(input: FingerprintInput): string {
  const c = input.counts;
  return [
    input.version,
    c.sent,
    c.failed,
    c.delivered,
    c.bouncedHard + c.bouncedSoft,
    c.complained,
    c.unsubscribed,
    c.opensUnique,
    c.opensUniqueHuman,
    c.opensUniqueApple,
    c.clicksUnique,
    c.clicksUniqueHuman,
    input.updatedAt.getTime(),
  ].join(':');
}

/**
 * Vrací true, když se změnily počty, ale `version` zůstala. To je porušení
 * dohody se zapisovateli (P10 a P13) a musí se ohlásit, ne přejít mlčky.
 */
export function detectStaleVersion(previous: FingerprintInput, next: FingerprintInput): boolean {
  if (next.version !== previous.version) return false;
  return countsKey(next.counts) !== countsKey(previous.counts);
}

function countsKey(c: StatsCounts): string {
  return [
    c.sent,
    c.failed,
    c.delivered,
    c.bouncedHard,
    c.bouncedSoft,
    c.complained,
    c.unsubscribed,
    c.opensUnique,
    c.opensUniqueHuman,
    c.opensUniqueApple,
    c.clicksUnique,
    c.clicksUniqueHuman,
  ].join(':');
}
