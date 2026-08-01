import crawlers from 'crawler-user-agents';

/**
 * Regulární výrazy nad User-Agent. Žádná knihovna na parsování UA:
 * ua-parser-js 2.x je AGPL-3.0-or-later a device-detector-js je LGPL-3.0,
 * obojí je zakázané a CI job licenses-node na obojím padá.
 */

/**
 * Apple Mail Privacy Protection posílá doslova tenhle řetězec bez dalších tokenů,
 * což žádný skutečný klient nedělá. Je to heuristika, ne jistota, a Apple ji může
 * kdykoliv změnit bez ohlášení. Proto je to hodnota v tabulce, ne podmínka v kódu,
 * a proto se podíly tříd sledují metrikou tracking_open_total{class}.
 */
export const APPLE_MPP_EXACT_UA = 'Mozilla/5.0';

/** Gmail a jiné obrazové proxy. Obvykle skutečné otevření, ale nespolehlivý čas. */
export const IMAGE_PROXY_RE = /GoogleImageProxy|via ggpht\.com/i;

/** Poštovní brány, které stahují obrázky samy od sebe. */
export const SECURITY_PROXY_RE = /YahooMailProxy|Barracuda|ProofPoint/i;

/** Bezpečnostní filtry, které po doručení navštíví každý odkaz. */
export const SCANNER_RE = /Safelinks|ProofPoint|Mimecast|Barracuda|urldefense|Symantec|FireEye/i;

/** Známé poštovní klienty. */
export const MAIL_CLIENT_RE =
  /Outlook|Microsoft Office|Thunderbird|AppleMail|Apple-Mail|Airmail|Spark|Superhuman|Edison|BlueMail|em[Cc]lient|Postbox|Evolution|KMail|Zimbra|Roundcube/i;

/** Běžné prohlížeče, tedy webmail s otevřenými obrázky. */
export const BROWSER_RE = /(Chrome|Chromium|Firefox|Safari|Edg|OPR|SamsungBrowser)\/[\d.]+/i;

/**
 * Obecní HTTP klienti, které `crawler-user-agents` vede jako crawlery, ale
 * klasifikace otevření pro ně má vlastní odpověď.
 *
 * ODCHYLKA OD PLÁNU, vynucená obsahem seznamu a ověřená spuštěním. Vzor `^curl`
 * v seznamu JE, jenže pravidlo 11 z 3.3.2 pro `curl/8.5.0` předepisuje
 * `unknown`, ne `bot`. Rozdíl není kosmetický: `bot` se do `message_events`
 * neukládá vůbec, takže by se otevření zahodilo místo toho, aby se uložilo
 * jako nerozhodnuté.
 */
const GENERIC_HTTP_CLIENT_PATTERNS: ReadonlySet<string> = new Set(['^curl']);

/**
 * Vzory, které si nárokuje pozdější a přesnější pravidlo této domény.
 *
 * ODCHYLKA OD PLÁNU, a je to oprava skutečné vady. Seznam obsahuje
 * `GoogleImageProxy` i `YahooMailProxy`. Pravidlo 1 vyhrává nad vším, takže
 * bez tohohle filtru by se Gmail proxy vyhodnotila jako `bot`, pravidlo 7 by
 * bylo mrtvý kód a **každé otevření přes obrazovou proxy Googlu by se zahodilo**,
 * protože `bot` se neukládá. Ověřeno spuštěním nad crawler-user-agents 1.56.0.
 */
const CLAIMED_BY_LATER_RULES: readonly RegExp[] = [IMAGE_PROXY_RE, SECURITY_PROXY_RE];

const CRAWLER_RES: readonly RegExp[] = (crawlers as ReadonlyArray<{ pattern: string }>)
  .filter((entry) => !GENERIC_HTTP_CLIENT_PATTERNS.has(entry.pattern))
  .filter((entry) => !CLAIMED_BY_LATER_RULES.some((re) => re.test(entry.pattern)))
  .map((entry) => new RegExp(entry.pattern, 'i'));

export function isCrawlerUserAgent(userAgent: string): boolean {
  if (userAgent === '') return false;
  return CRAWLER_RES.some((re) => re.test(userAgent));
}

const PREFETCH_HEADERS = ['purpose', 'x-purpose', 'x-moz', 'sec-purpose'] as const;

/**
 * Prefetch a preview. Prohlížeč nebo klient si stránku stáhne dopředu,
 * aniž ji člověk viděl, takže to není otevření ani proklik.
 */
export function isPrefetchRequest(headers: Record<string, string | undefined>): boolean {
  for (const name of PREFETCH_HEADERS) {
    const value = headers[name]?.toLowerCase();
    if (value === undefined) continue;
    if (value.includes('prefetch') || value.includes('preview') || value.includes('prerender')) {
      return true;
    }
  }
  return false;
}
