/**
 * Čištění adres, viz plán P10 Task 23.
 *
 * Adresa stránky je jediná věc, kterou SDK posílá doslova, a je to zároveň
 * nejčastější místo, kudy do měření prosákne osobní údaj: odkaz z e-mailu
 * s tokenem, odkaz na obnovu hesla, adresa s e-mailem v query.
 */

/**
 * Výchozí sada odstraňovaných parametrů. Konfigurace ji smí jen ROZŠIŘOVAT,
 * nikdy zkracovat pod tuhle množinu.
 *
 * `ml_token` je v seznamu schválně: SDK ho sice z adresy maže přes
 * `replaceState`, ale první `page_view` může proběhnout dřív.
 */
export const DEFAULT_STRIP_PARAMS: readonly string[] = [
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'password',
  'passwd',
  'pwd',
  'secret',
  'api_key',
  'apikey',
  'key',
  'signature',
  'sig',
  'auth',
  'session',
  'sessionid',
  'otp',
  'code',
  'email',
  'e-mail',
  'phone',
  'tel',
  'ssn',
  'rc',
  'ml_token',
];

const SENSITIVE_PATH_RE = /\/(reset|obnova)-?hesla|\/login|\/prihlaseni|\/verify|\/overeni/i;
const CAMPAIGN_PARAMS = ['source', 'medium', 'campaign', 'content', 'term'] as const;

/**
 * Vrátí adresu bez přihlašovacích údajů, bez fragmentu a bez citlivých
 * parametrů. Nevalidní vstup vrací prázdný řetězec, ne výjimku: jedna vadná
 * adresa nesmí shodit celou dávku.
 */
export function sanitizeUrl(rawUrl: string, stripParams: readonly string[]): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return '';
  }

  url.username = '';
  url.password = '';
  url.hash = '';

  if (SENSITIVE_PATH_RE.test(url.pathname)) {
    url.search = '';
    return url.toString();
  }

  const strip = new Set(stripParams.map((p) => p.toLowerCase()));
  // Jména se vyberou DOPŘEDU do pole. `searchParams.keys()` je živý iterátor
  // a mazání během něj přeskakuje položky, takže by při dvou citlivých
  // parametrech vedle sebe druhý v adrese zůstal.
  const names = Array.from(url.searchParams.keys());
  for (const name of names) {
    if (strip.has(name.toLowerCase())) url.searchParams.delete(name);
  }

  return url.toString();
}

/** Rozparsuje `utm_*` do `context.campaign`. Značkovací parametry se nemažou. */
export function extractCampaign(rawUrl: string): Record<string, string> | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const name of CAMPAIGN_PARAMS) {
    const value = url.searchParams.get(`utm_${name}`);
    if (value !== null && value !== '') out[name] = value.slice(0, 255);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
