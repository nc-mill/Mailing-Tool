/**
 * Převod hlavičky `Set-Cookie` na tvar, kterému rozumí `cookies().set()`
 * z `next/headers`.
 *
 * Proč to vůbec existuje: Server Action volá vlastní API přes `fetch`, takže
 * odpověď API **není** odpovědí, kterou Next.js pošle prohlížeči. Hlavičky se
 * cestou zahodí a relace založená přihlášením by se do prohlížeče nikdy
 * nedostala. Akce se pak tváří, že prošla, a uživatel přihlášený není.
 *
 * Atributy se přepisují jedna k jedné, nic se nedoplňuje ani nepřepisuje.
 * Vlastníkem hodnot je P04, který cookie vydává (3.2 části 1).
 */

export type ParsedSetCookie = {
  name: string;
  value: string;
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  priority?: 'low' | 'medium' | 'high';
  partitioned?: boolean;
};

function sameSiteOf(value: string): ParsedSetCookie['sameSite'] {
  const lower = value.toLowerCase();
  if (lower === 'lax' || lower === 'strict' || lower === 'none') return lower;
  return undefined;
}

function priorityOf(value: string): ParsedSetCookie['priority'] {
  const lower = value.toLowerCase();
  if (lower === 'low' || lower === 'medium' || lower === 'high') return lower;
  return undefined;
}

/**
 * Rozebere jednu hlavičku `Set-Cookie`. Vrátí `undefined`, když v ní není
 * dvojice jméno=hodnota, protože takovou hlavičku nemá smysl přeposílat.
 *
 * Hodnota se **nedekóduje**: cookie relace z P04 je base64url a jakýkoli
 * převod by ji změnil. Prázdná hodnota je platná, tak se cookie maže.
 */
export function parseSetCookie(header: string): ParsedSetCookie | undefined {
  const segments = header.split(';');
  const pair = segments[0];
  if (pair === undefined) return undefined;

  const separator = pair.indexOf('=');
  if (separator <= 0) return undefined;

  const name = pair.slice(0, separator).trim();
  if (name === '') return undefined;

  const parsed: ParsedSetCookie = { name, value: pair.slice(separator + 1).trim() };

  for (const segment of segments.slice(1)) {
    const trimmed = segment.trim();
    if (trimmed === '') continue;

    const index = trimmed.indexOf('=');
    const key = (index === -1 ? trimmed : trimmed.slice(0, index)).trim().toLowerCase();
    const value = index === -1 ? '' : trimmed.slice(index + 1).trim();

    switch (key) {
      case 'path':
        parsed.path = value;
        break;
      case 'domain':
        parsed.domain = value;
        break;
      case 'max-age': {
        const seconds = Number(value);
        if (Number.isFinite(seconds)) parsed.maxAge = seconds;
        break;
      }
      case 'expires': {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) parsed.expires = date;
        break;
      }
      case 'httponly':
        parsed.httpOnly = true;
        break;
      case 'secure':
        parsed.secure = true;
        break;
      case 'partitioned':
        parsed.partitioned = true;
        break;
      case 'samesite': {
        const sameSite = sameSiteOf(value);
        if (sameSite) parsed.sameSite = sameSite;
        break;
      }
      case 'priority': {
        const priority = priorityOf(value);
        if (priority) parsed.priority = priority;
        break;
      }
      default:
        break;
    }
  }

  return parsed;
}

/**
 * Rozebere všechny hlavičky `Set-Cookie` z odpovědi. Používá se
 * `getSetCookie()`, ne `get('set-cookie')`: druhé jmenované slepí víc hlaviček
 * do jednoho řetězce a cookie by se rozpadly na hodnotě s čárkou (třeba
 * `Expires=Tue, 01 Jan 2030 ...`).
 */
export function parseSetCookies(headers: Headers): ParsedSetCookie[] {
  return headers
    .getSetCookie()
    .map(parseSetCookie)
    .filter((cookie): cookie is ParsedSetCookie => cookie !== undefined);
}
