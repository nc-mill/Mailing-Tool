/**
 * JEDINÉ MÍSTO, KDE ŽIJÍ BEZPEČNOSTNÍ HLAVIČKY CELÉ APLIKACE.
 *
 * Dřív je nastavovala jen proxy (`src/proxy.ts`) a veřejné stránky si odpověď
 * skládaly samy v `render.tsx`. Byly to dvě různé sady a rozešly se přesně tak,
 * jak se takové dvojice rozcházejí: veřejná stránka nesla jen typ obsahu, zákaz
 * mezipaměti a `noindex`, takže **neměla politiku obsahu, ochranu proti rámování
 * ani nosniff**.
 *
 * PROČ TO NEZACHRÁNILA PROXY: její matcher vynechává jakoukoliv cestu s tečkou,
 * kdežto `sanitizePublicToken` token na první tečce jen uřízne. `/u/TOKEN.x`
 * tedy obslouží tatáž trasa se stejným výsledkem, ale proxy na ni vůbec neběží.
 * V kampani stačí napsat odkaz `{{ unsubscribe_url }}.x` a příjemce dostane
 * odhlašovací stránku úplně bez politiky obsahu. Hlavička nasazená u ZDROJE
 * odpovědi platí vždycky, na rozdíl od vzoru v konfiguraci, který se musí
 * trefit do všech budoucích cest.
 *
 * Modul schválně nezná `next/server`: vrací obyčejné dvojice jméno a hodnota,
 * takže je stejně použije proxy na `NextResponse` i route handler na `Response`.
 */

/** Cesty veřejných povrchů, které se schválně vkládají do rámu na cizím webu. */
export type PublicSurface =
  /** Stránka vázaná na token příjemce. Do cizího rámu nepatří za žádnou cenu. */
  | 'sealed'
  /**
   * Hostovaný formulář. Rozhraní nabízí vložení `<iframe src=".../f/{ref}">`
   * (`packages/core/src/contacts/forms/embed.ts`), takže zákaznický web JE ten
   * cizí rám a zákaz rámování by formulář všem zákazníkům zhasl.
   */
  | 'embeddable';

/**
 * Hlavičky, které nezávisí na tom, jestli jde o aplikaci, nebo veřejnou stránku.
 * Žádná z nich nic nevykresluje, takže se nemá jak rozejít s obsahem.
 */
const SHARED_HEADERS: Record<string, string> = {
  // Prohlížeč nesmí hádat typ obsahu podle bajtů. Bez tohohle jde z odpovědi,
  // kterou umíme naplnit textem od uživatele, udělat spustitelný skript.
  'x-content-type-options': 'nosniff',
  // Adresa veřejné stránky NESE TOKEN. `strict-origin-when-cross-origin` pošle
  // cizí doméně jen původ, nikdy celou cestu, takže token neuteče v Referer.
  //
  // Přísnější `no-referrer` tu být NESMÍ, i když by se nabízel: podle Fetch
  // specifikace se s ním u odeslání formuláře mimo CORS pošle `Origin: null`
  // a první vrstva ochrany formulářů (`allowedOrigins` v `protection.ts`)
  // by odeslání z legitimního webu odmítla jako cizí původ.
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
};

/**
 * Politika obsahu APLIKACE. Potřebuje nonce, protože Next.js si razítkuje
 * vlastní bootstrapové inline skripty, bez kterých se React nenamountuje.
 */
export function buildAppCsp(nonce: string): string {
  // Uvolnění platí VÝHRADNĚ ve vývoji, v produkci nikdy. Schváleno zadavatelem
  // 2026-08-01 poté, co se ukázalo, že jinak v dev režimu nefunguje nic.
  //
  // Vývojový build Reactu vyhodnocuje kód za běhu kvůli ladicím funkcím,
  // například rekonstrukci zásobníku volání z jiného prostředí. Bez téhle
  // výjimky prohlížeč skript zablokuje a klientská hydratace vůbec neproběhne.
  // Projeví se to nejhorším možným způsobem: stránka se vykreslí správně,
  // vypadá hotově, a žádné tlačítko nefunguje. Jediná stopa je řádek v konzoli,
  // který na CSP vůbec neodkazuje, takže se chyba hledá v komponentách.
  // Produkční build Reactu tuhle schopnost nepoužívá, tam zůstává CSP přísná.
  const scriptSrc =
    process.env.NODE_ENV === 'production'
      ? `script-src 'self' 'nonce-${nonce}'`
      : `script-src 'self' 'unsafe-eval' 'nonce-${nonce}'`;

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    // https: je potřeba, protože náhled šablony ukazuje obrázky z domény uživatele
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

/**
 * Politika obsahu VEŘEJNÉ STRÁNKY. Je PŘÍSNĚJŠÍ než v aplikaci, a smí být,
 * protože veřejné stránky z definice běží bez jediného bajtu JavaScriptu
 * (viz hlavička `render.tsx`): jsou to route handlery, které si HTML vykreslí
 * do řetězce, takže tu není co orazítkovat nonce a `script-src 'none'`
 * nemá co rozbít.
 *
 * Co si naopak dovolit NEMŮŽE:
 *   - `style-src 'unsafe-inline'`, protože obal veřejných stránek nese CSS ve
 *     značce `<style>` a navržená stránka z Builderu má styly vložené přímo
 *     v atributech `style`. Bez téhle výjimky by se navržená stránka rozsypala
 *     až u návštěvníka, tedy tam, kde to nikdo z nás neuvidí.
 *   - `img-src` s `https:`, protože obrázky navržené stránky jdou z našeho
 *     úložiště, které smí být za CDN na jiné doméně.
 */
export function buildPublicCsp(surface: PublicSurface): string {
  const directives = [
    // Základ je nula: co stránka potřebuje, to se povolí jmenovitě níž.
    "default-src 'none'",
    "script-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    // Formulář (odhlášení, potvrzení, předvolby, hostovaný formulář) posílá
    // vždy na naši doménu. Cizí cíl by znamenal, že někdo přepsal značku.
    "form-action 'self'",
    "base-uri 'none'",
  ];
  // `frame-ancestors` NEMÁ v CSP zálohu v `default-src`, takže jeho vynechání
  // znamená „rámovat smí kdokoliv". U vkládaného formuláře je to záměr, jinde
  // by to byla díra, proto se u zapečetěných povrchů uvádí vždy.
  directives.push(surface === 'embeddable' ? 'frame-ancestors *' : "frame-ancestors 'none'");
  return directives.join('; ');
}

/** Sada hlaviček pro stránky a rozhraní aplikace, tedy pro to, co obsluhuje proxy. */
export function appSecurityHeaders(csp: string, nonce: string): Record<string, string> {
  return {
    ...SHARED_HEADERS,
    'content-security-policy': csp,
    // Doplněk pro ladění. Next si nonce bere z hlaviček POŽADAVKU, viz `proxy.ts`.
    'x-nonce': nonce,
    'x-frame-options': 'DENY',
  };
}

/**
 * Sada hlaviček pro veřejnou stránku pro příjemce.
 *
 * `x-frame-options` je tu vedle `frame-ancestors` schválně: novější prohlížeče
 * dají přednost politice obsahu, starší umí jen tuhle hlavičku. U vkládaného
 * formuláře se NESMÍ objevit ani jedna zakazující varianta, protože hodnota
 * „rámovat smí kdokoliv" v `x-frame-options` neexistuje.
 */
export function publicSecurityHeaders(surface: PublicSurface = 'sealed'): Record<string, string> {
  return {
    ...SHARED_HEADERS,
    'content-security-policy': buildPublicCsp(surface),
    ...(surface === 'embeddable' ? {} : { 'x-frame-options': 'DENY' }),
  };
}
