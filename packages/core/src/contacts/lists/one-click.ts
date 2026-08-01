/**
 * Přesná hodnota těla, kterou podle RFC 8058 posílá poštovní klient. Jiná hodnota
 * one-click není a musí se zpracovat jako běžné odeslání formuláře.
 */
export const ONE_CLICK_BODY = 'List-Unsubscribe=One-Click';

/**
 * ODCHYLKA OD PLÁNU, VYNUCENÁ tsconfigem. Plán vracel `Record<string, string>`.
 * Pod `noUncheckedIndexedAccess` je pak `headers['List-Unsubscribe']` typu
 * `string | undefined` a volající se nezkompiluje. Návratový typ je proto pojmenovaný
 * a obě hlavičky jsou v něm povinné, což je i věcně správně: RFC 8058 vyžaduje obě.
 */
export type ListUnsubscribeHeaders = {
  'List-Unsubscribe': string;
  'List-Unsubscribe-Post': string;
};

/**
 * Hlavičky pro odchozí zprávu podle RFC 8058.
 *
 * Závazné body z RFC, které se z tohohle tvaru nesmí ztratit:
 *   1. List-Unsubscribe MUSÍ obsahovat právě jedno HTTPS URI a SMÍ obsahovat další ne-HTTP.
 *   2. List-Unsubscribe-Post MUSÍ obsahovat přesně dvojici List-Unsubscribe=One-Click.
 *   3. URI MUSÍ samo o sobě nést dost informací k identifikaci příjemce a seznamu,
 *      protože POST nepřenáší žádné další argumenty.
 *   4. URI MÁ obsahovat neuhodnutelnou složku, kterou server ověří. Brání to útoku,
 *      kdy někdo rozešle spam s odkazy na cizí seznam, aby ho stížnosti odhlásily.
 *
 * Pátý požadavek (zpráva musí mít platný DKIM podpis pokrývající obě hlavičky) plní
 * část 4; bez něj je one-click neplatný a poštovní klienti ho nezobrazí.
 */
export function buildListUnsubscribeHeaders(input: {
  unsubscribeUrl: string;
  mailtoAddress?: string;
  token: string;
}): ListUnsubscribeHeaders {
  const uris = [`<${input.unsubscribeUrl}>`];
  if (input.mailtoAddress !== undefined) {
    uris.push(`<mailto:${input.mailtoAddress}?subject=unsub-${input.token}>`);
  }
  return {
    'List-Unsubscribe': uris.join(', '),
    'List-Unsubscribe-Post': ONE_CLICK_BODY,
  };
}

/** Je tělo požadavku one-click podle RFC, nebo je to formulář ze stránky předvoleb? */
export function isOneClickBody(body: URLSearchParams): boolean {
  return body.get('List-Unsubscribe') === 'One-Click';
}

/**
 * Rate limit endpointu POST /u/{token}.
 *
 * PER-IP LIMIT ZÁMĚRNĚ NEEXISTUJE a nesmí se doplnit. Tenhle POST neposílá prohlížeč
 * příjemce, ale infrastruktura poštovního providera: Gmail, Apple Mail a Outlook ho
 * volají ze své vlastní, poměrně úzké sady serverových IP adres. U kampaně na sto tisíc
 * adres přijdou stovky odhlášení za minutu z několika málo IP.
 *
 * Per-IP limit 30 za minutu by je začal odmítat s 429, poštovní klient by uživateli
 * ukázal, že odhlášení selhalo, a ten by místo toho označil zprávu jako spam. Neúspěšné
 * one-click odhlášení je přesně to, za co Gmail penalizuje doručitelnost, takže by
 * ochrana způsobila právě tu škodu, které má bránit.
 *
 * Token sám o sobě je neuhodnutelný, takže per-IP limit stejně nechrání proti ničemu
 * smysluplnému. Limit per token pokryje dvojklik i opakované doručení. Viz kritérium 82.
 */
export const oneClickRateLimit = {
  perIp: null,
  perToken: { points: 20, durationSeconds: 3600 },
} as const;

/**
 * Tři vlastnosti endpointu, které vypadají jako chyba a jsou úmyslné. Musí být
 * okomentované v kódu handleru, jinak je při příští bezpečnostní revizi někdo "opraví".
 */
export const ONE_CLICK_INVARIANTS = [
  'POST /u/{token} je vyňatý z CSRF ochrany: autorizaci nese podepsaný token, cookie se nečte. RFC 8058 bod 5.',
  'POST /u/{token} nesmí vrátit přesměrování: přesměrovaný POST se v prohlížečích chová nespolehlivě. RFC 8058 bod 6.',
  'POST /u/{token} nemá per-IP rate limit: volá ho infrastruktura providerů z úzké sady adres.',
] as const;
