import { routing } from '@mlain/i18n/routing';
import { SESSION_COOKIE_NAME } from '@mlain/core/identity/cookie';
import createIntlMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Jediný proxy soubor aplikace (uzávěr S6). Řeší tři věci naráz:
 * jazyk, přesměrování nepřihlášeného a bezpečnostní hlavičky.
 *
 * V Next.js 16 se soubor jmenuje proxy.ts a funkce proxy.
 * Runtime je vždy Node.js, edge není podporovaný.
 */

// Jméno relační cookie se NEPÍŠE natvrdo. Vlastní ho identita v P04
// a proxy si ho odsud jen bere. Dokud tu byl literál, rozešel se s tím,
// co API skutečně nastavuje, a proxy přihlášeného uživatele neviděla.

/** Cesty, které volají příjemci e-mailů a prohlížeče, ne přihlášení uživatelé. */
const PUBLIC_PREFIXES = [
  '/t/', // trackovací pixel a proklik
  '/e/', // sběr událostí z webového SDK
  '/u/', // odhlášení
  '/p/', // nastavení odběru
  '/s/c/', // potvrzení přihlášení
  '/r/', // přesměrování
  '/f/', // vložený formulář
  '/d/', // delegovaná stránka DNS
  '/api/webhooks/', // příchozí webhooky provideru
  // Odchylka od plánu: bez tohohle by proxy poslala kontejnerový healthcheck
  // (`mlain healthcheck` volá /api/health/ready) na přihlašovací stránku
  // a kontejner by se hlásil jako nezdravý.
  '/api/health',
  // Veřejné API si přihlášení řeší samo, middlewarem `authenticate` z P04,
  // a na nepřihlášený požadavek odpovídá 401 v obálce Problem Details.
  //
  // Bez tohohle řádku ho proxy odbaví přesměrováním 307 na `/login`, tedy
  // na HTML stránku. Volající dostane místo JSON chyby stránku, `fetch`
  // přesměrování mlčky následuje a klient se pokusí zpracovat HTML jako JSON.
  // Projeví se to jako nesrozumitelná chyba parsování daleko od příčiny,
  // ne jako „nejsi přihlášený". Přihlašovací formulář by navíc neměl kam
  // poslat požadavek, protože i `POST /api/v1/auth/login` je nepřihlášený.
  '/api/v1/',
  // Interní endpointy (`/api/internal/ai/chat`) mají tentýž důvod jako `/api/v1/`,
  // a ještě o stupeň naléhavější. Přihlášení si řeší samy middlewarem
  // `authenticate`, takže se tím nic neotevírá.
  //
  // Bez tohohle řádku je streamovaný chat nedostupný OBĚMA směry. Nepřihlášený
  // dostane 307 na `/login`. Přihlášený je na tom hůř: požadavek propadne do
  // `intlMiddleware`, které mu doplní jazykovou předponu, cesta spadne do
  // stromu stránek pod `[locale]` a klientovi se vrátí HTML místo proudu.
  // Parser AI SDK pak hlásí rozbitý proud a příčina se hledá v adaptéru,
  // úplně jinde, než ve skutečnosti je.
  '/api/internal/',
];

/** Stránky aplikace, které jsou dostupné bez přihlášení. */
const ANONYMOUS_PAGES = [
  '/login',
  '/setup',
  '/forgot-password',
  '/reset-password',
  '/invitations/accept',
];

const intlMiddleware = createIntlMiddleware(routing);

function stripLocale(pathname: string): string {
  for (const locale of routing.locales) {
    if (pathname === `/${locale}`) return '/';
    if (pathname.startsWith(`/${locale}/`)) return pathname.slice(locale.length + 1);
  }
  return pathname;
}

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isAnonymousPage(pathname: string): boolean {
  return ANONYMOUS_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`));
}

function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Složí CSP. Tentýž řetězec musí jít do hlaviček POŽADAVKU i ODPOVĚDI,
 * viz `proxy()` níž.
 */
function buildCsp(nonce: string): string {
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

function applySecurityHeaders(response: NextResponse, csp: string, nonce: string): NextResponse {
  response.headers.set('content-security-policy', csp);
  response.headers.set('x-nonce', nonce);
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  response.headers.set('x-frame-options', 'DENY');
  response.headers.set(
    'permissions-policy',
    'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  );
  response.headers.set('strict-transport-security', 'max-age=63072000; includeSubDomains');
  return response;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const nonce = createNonce();
  const csp = buildCsp(nonce);
  const { pathname, search } = request.nextUrl;

  /**
   * CSP MUSÍ JÍT I DO HLAVIČEK POŽADAVKU, nejen do odpovědi.
   *
   * Next.js si z hlaviček požadavku vytáhne nonce a orazítkuje jím své
   * bootstrapové inline skripty. Když se hlavička nastaví jen na odpovědi,
   * prohlížeč sice dostane přísnou politiku, ale skripty žádný nonce nemají,
   * takže je zablokuje:
   *
   *   Executing inline script violates the following Content Security Policy
   *   directive 'script-src 'self' 'nonce-...''. The action has been blocked.
   *
   * Devětkrát na stránku, pokaždé jiný hash. Následek je nejhorší možný:
   * stránka se vykreslí ze serveru, vypadá hotově, a **nic na ní nefunguje**.
   * React se nenamountuje, takže žádné tlačítko, formulář ani navigace
   * nereagují. Naměřeno v produkční image na `/setup`: klik na výběr jazyka
   * proběhl, `data-state` zůstal `closed` a nabídka měla nula položek.
   *
   * V dev režimu se to neprojevilo, protože tam politika obsahuje
   * `'unsafe-eval'` a inline bootstrap má jiný tvar. Vada je tedy VÝHRADNĚ
   * produkční, což je nejhorší místo, kde ji mít.
   *
   * Hlavička `x-nonce` na odpovědi tady zůstává, ale je to jen doplněk pro
   * ladění: nikdo v aplikaci ji nečte a Next si nonce bere z požadavku.
   */
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('content-security-policy', csp);
  requestHeaders.set('x-nonce', nonce);
  const forward = { request: { headers: requestHeaders } };

  // 1. Veřejné a trackovací cesty: žádný jazyk, žádné přihlášení, žádná cache.
  if (isPublicPath(pathname)) {
    const response = NextResponse.next(forward);
    response.headers.set('cache-control', 'no-store, no-cache, must-revalidate');
    return applySecurityHeaders(response, csp, nonce);
  }

  const withoutLocale = stripLocale(pathname);

  // 2. Přihlášení. Proxy jen kontroluje přítomnost cookie, ověření dělá server.
  const hasSession = request.cookies.has(SESSION_COOKIE_NAME);
  if (!hasSession && !isAnonymousPage(withoutLocale)) {
    const target = request.nextUrl.clone();
    target.pathname = '/login';
    target.search = '';
    target.searchParams.set('next', `${withoutLocale}${search}`);
    return applySecurityHeaders(NextResponse.redirect(target), csp, nonce);
  }

  // 3. Jazyk. next-intl doplní nebo odebere prefix podle localePrefix.
  //
  // Požadavek se předává s doplněnými hlavičkami, aby se nonce dostal až
  // k Nextu i touhle větví. `next-intl` hlavičky požadavku propouští dál.
  const response = intlMiddleware(
    new NextRequest(request.nextUrl, { headers: requestHeaders }) as NextRequest,
  );
  return applySecurityHeaders(response as NextResponse, csp, nonce);
}

export const config = {
  // Jediný matcher pro celou aplikaci. Vynechává celý `_next`, favicon
  // a soubory s příponou, aby proxy nezdržovala doručení obrázků a fontů.
  //
  // Vynechává se CELÉ `_next`, ne jen `_next/static` a `_next/image`. Pod
  // `_next` nejsou žádná data pracovních prostorů, jsou to buildové artefakty
  // a vývojový kanál, takže tam autentizace nemá co chránit. Zato tam patří
  // `_next/webpack-hmr`, po kterém jede vývojový websocket. Ten při užším
  // vzoru procházel autentizací a bez session dostal přesměrování na přihlášení:
  //
  //   GET /_next/webpack-hmr  ->  307 na /login?next=%2F_next%2Fwebpack-hmr
  //
  // Přesměrování místo `101 Switching Protocols` znamená rozbitý handshake
  // a v konzoli `ERR_INVALID_HTTP_RESPONSE` na každé stránce.
  matcher: ['/((?!_next|favicon.ico|.*\\..*).*)'],
};
