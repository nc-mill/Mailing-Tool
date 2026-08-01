import type { ClickClass } from '../types';
import { SCANNER_RE, isCrawlerUserAgent, isPrefetchRequest } from '../open/ua-rules';

const SCANNER_HEAD_START_SECONDS = 5;
const SCANNER_WINDOW_SECONDS = 60;
const SCANNER_DISTINCT_LINKS = 3;

export type ClassifyClickHotInput = {
  userAgent: string;
  method: string;
  headers: Record<string, string | undefined>;
};

/**
 * Pravidla 1 až 4 a 7 z 3.5. Jen tahle podmnožina jde vyhodnotit v horké cestě,
 * protože pravidlo 5 potřebuje messages.sent_at a pravidlo 6 okno napříč požadavky.
 */
export function classifyClickHot(input: ClassifyClickHotInput): ClickClass {
  const ua = input.userAgent.trim();
  if (isCrawlerUserAgent(ua)) return 'bot';
  if (isPrefetchRequest(input.headers)) return 'prefetch';
  if (input.method.toUpperCase() === 'HEAD') return 'scanner';
  if (SCANNER_RE.test(ua)) return 'scanner';
  if (ua === '') return 'bot';
  return 'human';
}

export type PendingClick = {
  messageId: string;
  linkId: string;
  ip: string | null;
  occurredAt: Date;
  clickClass: ClickClass;
};

type WindowEntry = { at: number; links: Set<string> };

/**
 * Okno pro pravidlo 6, drží se v paměti workeru. Při restartu se ztratí,
 * což vede k několika falešným human klikům. Přijatelné a zapsané.
 */
export class ScannerWindow {
  readonly #byKey = new Map<string, WindowEntry>();

  observe(ip: string, messageId: string, linkId: string, at: Date): Set<string> {
    const key = `${ip}:${messageId}`;
    const nowMs = at.getTime();
    const entry = this.#byKey.get(key);
    if (entry === undefined || nowMs - entry.at > SCANNER_WINDOW_SECONDS * 1000) {
      const fresh: WindowEntry = { at: nowMs, links: new Set([linkId]) };
      this.#byKey.set(key, fresh);
      return fresh.links;
    }
    entry.links.add(linkId);
    return entry.links;
  }

  prune(now: Date): void {
    const cutoff = now.getTime() - SCANNER_WINDOW_SECONDS * 1000;
    for (const [key, entry] of this.#byKey) {
      if (entry.at < cutoff) this.#byKey.delete(key);
    }
  }
}

/**
 * Pravidla 5 a 6. Běží v asynchronním zpracování dávky, ne v horké cestě.
 * Pravidlo 6 přeznačí i předchozí kliky téže dvojice IP a zpráva ve stejné dávce.
 */
export function reclassifyClicks(
  clicks: readonly PendingClick[],
  sentAtByMessage: Readonly<Record<string, Date>>,
  window: ScannerWindow,
): PendingClick[] {
  const out = clicks.map((click) => ({ ...click }));

  // pravidlo 5
  for (const click of out) {
    if (click.clickClass !== 'human') continue;
    const sentAt = sentAtByMessage[click.messageId];
    if (sentAt === undefined) continue;
    const ageSeconds = (click.occurredAt.getTime() - sentAt.getTime()) / 1000;
    if (ageSeconds < SCANNER_HEAD_START_SECONDS) click.clickClass = 'scanner';
  }

  // pravidlo 6
  const flagged = new Set<string>();
  for (const click of out) {
    if (click.ip === null) continue;
    const links = window.observe(click.ip, click.messageId, click.linkId, click.occurredAt);
    if (links.size >= SCANNER_DISTINCT_LINKS) flagged.add(`${click.ip}:${click.messageId}`);
  }
  for (const click of out) {
    if (click.ip === null) continue;
    if (flagged.has(`${click.ip}:${click.messageId}`)) click.clickClass = 'scanner';
  }

  return out;
}

/** Do metrik prokliku se počítá jen human, viz 3.5. */
export function isCountedClickClass(cls: ClickClass): boolean {
  return cls === 'human';
}
