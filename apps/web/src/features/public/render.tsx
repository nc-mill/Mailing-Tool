import type { PublicBranding } from '@mlain/core/contacts';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { publicSecurityHeaders } from './security-headers';
import { PUBLIC_CSS } from './styles';

/**
 * Layout veřejných stránek pro příjemce. Je MIMO layout aplikace a řídí se jinými
 * pravidly, protože ho vidí cizí lidé, ne uživatelé nástroje.
 *
 * Pravidla z kapitoly 8.9 části 6, která se z něj nesmí ztratit:
 *   - funguje bez JavaScriptu (obyčejný formulář, POST, přesměrování 303),
 *   - načte se pod sto kilobajtů, protože se otevírá na mobilu a na pomalém připojení,
 *   - jazyk podle projektu nebo kontaktu, NE podle prohlížeče: příjemce dostal e-mail
 *     v češtině, tak čeká českou stránku,
 *   - neobsahuje navigaci do aplikace ani nic o projektu kromě jména odesílatele,
 *   - nese barvy projektu, protože odhlašovací stránka, která vypadá jako cizí,
 *     budí podezření na podvod,
 *   - kontrast a velikost písma stejné jako v aplikaci.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ NEXT.JS, A JE TO ODCHYLKA ZÁSADNÍ.
 *
 * Plán zakládal u `/u/[token]` a u `/s/c/[token]` SOUČASNĚ `page.tsx` i `route.ts`.
 * App Router to nedovolí: dvě obsluhy na jednom segmentu skončí chybou sestavení
 * „Conflicting route and page". Zároveň ale obojí potřebujeme: GET musí vykreslit
 * stránku a POST musí přijmout SYROVÉ tělo (`List-Unsubscribe=One-Click` podle RFC 8058
 * nebo `action=resend`), tedy tělo, které serverová akce Reactu nepozná, protože čeká
 * vlastní identifikátor akce.
 *
 * Řešení: každý veřejný povrch je JEDEN route handler, který si stránku vykreslí sám
 * přes `renderToStaticMarkup`. Vedlejší efekty jsou samé výhody:
 *   - do stránky se nedostane ani bajt JavaScriptu Reactu, takže rozpočet 100 kB
 *     není cíl, ale strop, který nejde překročit,
 *   - handler má plnou kontrolu nad stavovým kódem a hlavičkami, takže „vždy 200"
 *     a „nikdy přesměrování u one-click" jsou vynutitelné, ne přání,
 *   - odpadá hydratace, tedy i celá třída nesouladů mezi serverem a klientem
 *     u času a motivu.
 */
export function PublicLayout({
  children,
  branding,
  locale,
}: {
  children: ReactNode;
  branding: PublicBranding;
  locale: string;
}): ReactElement {
  const style =
    branding.brandColor === null
      ? undefined
      : ({ '--ml-brand-color': branding.brandColor } as CSSProperties);
  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Veřejné stránky nepatří do vyhledávačů: obsahují tokeny a týkají se konkrétních lidí. */}
        <meta name="robots" content="noindex, nofollow" />
        <title>{branding.senderName === '' ? 'Mlain Mailer' : branding.senderName}</title>
        {/*
          Styl je textový obsah značky, ne dangerouslySetInnerHTML: obsah je konstanta
          ze `styles.ts` a žádná hodnota z požadavku se do něj nedostane. Proto v něm
          nesmí být uvozovky ani ostré závorky, viz komentář v `styles.ts`.
        */}
        <style>{PUBLIC_CSS}</style>
      </head>
      <body>
        <div className="ml-public" style={style}>
          <main className="ml-public__card">
            {branding.senderName === '' ? null : <p className="ml-sender">{branding.senderName}</p>}
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}

export type RenderOptions = {
  branding: PublicBranding;
  locale: string;
  status?: number;
  headers?: Record<string, string>;
  /** Viz `embeddable` u `publicHtmlResponse`. Platí jen pro povrchy pod `/f/`. */
  embeddable?: boolean;
};

/**
 * Hotové HTML v odpovědi veřejné stránky.
 *
 * Oddělené od `renderPublicPage` schválně: navržená stránka z Builderu si celý
 * dokument včetně `<html>` vykresluje sama (`renderPageHtml`), ale hlavičky
 * musí mít TYTÉŽ. Kdyby si je skládala zvlášť, rozešly by se první opravou
 * udělanou jen na jednom místě, a jsou to hlavičky, na kterých stojí zákaz
 * indexace a zákaz uložení do sdílené cache.
 *
 * BEZPEČNOSTNÍ HLAVIČKY SE NASAZUJÍ TADY, U ZDROJE ODPOVĚDI, ne v proxy.
 * Proxy je v adresách s tečkou nenasadí (matcher je vynechává) a `/u/TOKEN.x`
 * je pro trasu tentýž odkaz jako `/u/TOKEN`, protože `sanitizePublicToken`
 * token na tečce jen uřízne. Podrobně v `security-headers.ts`.
 */
export function publicHtmlResponse(
  html: string,
  options: {
    status?: number;
    headers?: Record<string, string>;
    /**
     * Stránka se smí zobrazit v rámu na cizím webu. Zapíná se VÝHRADNĚ
     * u hostovaného formuláře `/f/{ref}` a jeho děkovací stránky, protože
     * rozhraní nabízí vložení přes `<iframe>`. Všude jinde by to znamenalo
     * dát útočníkovi rám nad odhlašovací stránkou příjemce.
     */
    embeddable?: boolean;
  } = {},
): Response {
  return new Response(html, {
    status: options.status ?? 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Stránka je vázaná na jeden token a nesmí ležet v žádné sdílené cache.
      'cache-control': 'no-store, no-cache, must-revalidate',
      'x-robots-tag': 'noindex, nofollow',
      ...publicSecurityHeaders(options.embeddable === true ? 'embeddable' : 'sealed'),
      ...options.headers,
    },
  });
}

/**
 * Vykreslí stránku do HTML a zabalí ji do odpovědi.
 *
 * Výchozí stav je 200 a NIKDY 404, ani u neplatného tokenu (kritérium 52). Rozdílný
 * kód by z veřejné stránky udělal nástroj na zjišťování, které kontakty existují.
 */
export async function renderPublicPage(
  node: ReactElement,
  options: RenderOptions,
): Promise<Response> {
  // Dynamický import je VYNUCENÝ Next.js: statický `import ... from 'react-dom/server'`
  // odmítne bundler hláškou „You're importing a component that imports react-dom/server".
  // Pravidlo míří na komponenty; tady jsme v route handleru, kde je vykreslení do řetězce
  // celý smysl, takže se import odkládá do běhu.
  const { renderToStaticMarkup } = await import('react-dom/server');
  const html = `<!doctype html>${renderToStaticMarkup(
    <PublicLayout branding={options.branding} locale={options.locale}>
      {node}
    </PublicLayout>,
  )}`;
  return publicHtmlResponse(html, {
    ...(options.status === undefined ? {} : { status: options.status }),
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    ...(options.embeddable === undefined ? {} : { embeddable: options.embeddable }),
  });
}
