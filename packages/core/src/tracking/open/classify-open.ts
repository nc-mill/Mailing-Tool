import type { OpenClass } from '../types';
import type { ProxyRangeIndex } from './proxy-ranges';
import {
  APPLE_MPP_EXACT_UA,
  BROWSER_RE,
  IMAGE_PROXY_RE,
  MAIL_CLIENT_RE,
  SECURITY_PROXY_RE,
  isCrawlerUserAgent,
  isPrefetchRequest,
} from './ua-rules';

export type ClassifyOpenInput = {
  userAgent: string;
  method: string;
  headers: Record<string, string | undefined>;
  ip: string | null;
  proxyRanges: ProxyRangeIndex;
};

/**
 * Jedenáct pravidel z 3.3.2, první shoda vyhrává. Pořadí je závazné.
 * Klasifikace se nikdy nemaže: report z ní počítá tři různá čísla a uživatel
 * jen přepíná pohled, nikdy neztrácí původní data.
 */
export function classifyOpen(input: ClassifyOpenInput): OpenClass {
  const ua = input.userAgent.trim();

  // 1. známý crawler
  if (isCrawlerUserAgent(ua)) return 'bot';

  // 2. prefetch a preview
  if (isPrefetchRequest(input.headers)) return 'bot';

  // 3. HEAD
  if (input.method.toUpperCase() === 'HEAD') return 'bot';

  // 4. Apple Mail Privacy Protection posílá doslova Mozilla/5.0 bez dalších tokenů
  if (ua === APPLE_MPP_EXACT_UA) return 'proxy_apple';

  // 5. a 6. Apple adresní prostor. Pevný blok platí vždy, stažené rozsahy jen při
  //         zapnutém tracking.use_apple_relay_ranges, což řeší ProxyRangeIndex.
  if (
    input.ip !== null &&
    input.proxyRanges.match(input.ip, 'email_open') === 'apple_private_relay'
  ) {
    return 'proxy_apple';
  }

  // 7. obrazové proxy
  if (IMAGE_PROXY_RE.test(ua)) return 'proxy_image';

  // 8. poštovní bezpečnostní proxy
  if (SECURITY_PROXY_RE.test(ua)) return 'bot';

  // 9. známý poštovní klient
  if (MAIL_CLIENT_RE.test(ua)) return 'human';

  // 10. běžný prohlížeč, tedy webmail s otevřenými obrázky
  if (BROWSER_RE.test(ua)) return 'human';

  // 11. nestačí signály
  return 'unknown';
}

/** Třída bot se do message_events neukládá vůbec, viz 3.3.4. */
export function isPersistedOpenClass(cls: OpenClass): boolean {
  return cls !== 'bot';
}

/** Ověřené otevření je human nebo proxy_image, viz 3.3.4. */
export function isVerifiedOpenClass(cls: OpenClass): boolean {
  return cls === 'human' || cls === 'proxy_image';
}
