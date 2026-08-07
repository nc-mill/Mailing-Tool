import type { ReactElement, ReactNode } from 'react';
import type { EmitterProps } from './ctx';
import { buildHeadCss } from './head-css';
import { rawText } from './raw';

/**
 * OBAL VEŘEJNÉ STRÁNKY. Vychází z `EmailShell` a liší se přesně tím, čím se
 * web liší od e-mailu. Bloky uvnitř zůstávají tytéž, včetně tabulkového
 * rozvržení: prohlížeč ho zvládá a druhý emitor jen kvůli čistotě značek by
 * znamenal dvě místa, která se časem rozejdou.
 *
 * Co tady NENÍ a proč:
 *
 * - PREHEADER. Je to text, který schránka ukáže v seznamu zpráv vedle předmětu.
 *   Na stránce žádný seznam zpráv není, takže by to byl jen skrytý odstavec,
 *   který nikdo nikdy neuvidí a vyhledávač ho vezme jako maskovaný text.
 * - META `color-scheme` A `supported-color-schemes`. Jsou to pokyny poštovním
 *   klientům, aby si HTML nepřebarvily po svém. Prohlížeč se jimi řídí jinak:
 *   `color-scheme` na stránce přebarví i formulářové prvky a posuvníky, tedy
 *   věci, o kterých motiv dokumentu nic neví.
 * - PODMÍNĚNÝ BLOK PRO OUTLOOK (`MSO_HEAD_BLOCK`) a jmenné prostory VML. Word
 *   engine žádnou stránku nevykresluje, takže je to jen mrtvý balast v hlavičce.
 * - TABULKOVÁ OBÁLKA NA ŠÍŘKU OKNA. Nahrazuje ji vycentrovaný `<main>`
 *   s `max-width`. Sekce si svou tabulku kreslí samy, takže se nic neztratí.
 *
 * PROČ HOLÉ ZNAČKY, a ne `Html`, `Head` a `Body` z react-emailu jako u e-mailu:
 * `Body` obaluje obsah vlastní tabulkou na šířku okna a `Head` přidává
 * `Content-Type` a `x-apple-disable-message-reformatting`, tedy přesně to,
 * čeho se stránka zbavuje. Zůstat u komponent a pak to odstraňovat z hotového
 * řetězce by znamenalo, že nová verze knihovny výstup tiše změní.
 *
 * ŽÁDNÝ ODKAZ NA EXTERNÍ SOUBOR. Styly jdou do `<style>` v hlavičce a inline,
 * skript nikde. Veřejné stránky jedou pod přísnou politikou obsahu, která by
 * `<link rel="stylesheet">` i `<script src>` zablokovala, takže by se stránka
 * s externím souborem rozsypala až u návštěvníka, ne u nás.
 */
export function PageShell({
  language,
  title,
  children,
  emitter,
}: {
  language: string;
  title: string;
  // Nepovinné kvůli `createElement`: sekce se předávají variadickými argumenty,
  // které typová signatura `createElement` do objektu props nezapočítá.
  children?: ReactNode;
} & EmitterProps): ReactElement {
  const { theme } = emitter;
  return (
    <html lang={language}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        {/* Stránka je odpověď na jednorázovou akci návštěvníka, ne obsah pro
            vyhledávače. Bez `noindex` by se do indexu dostaly děkovací stránky
            i s texty, které autor psal pro jednoho člověka. */}
        <meta name="robots" content="noindex,nofollow" />
        <title>{title}</title>
        {/* Obsah <style> jde raw slotem ze stejného důvodu jako u e-mailu:
            React text uvnitř <style> escapuje a `"Segoe UI"` by se rozpadlo
            na `&quot;`, což prohlížeč uvnitř stylu nedekóduje. */}
        <style>{rawText(emitter, buildHeadCss(theme))}</style>
      </head>
      <body
        id="body"
        className="ml-body ml-canvas"
        style={{
          margin: 0,
          padding: 0,
          width: '100%',
          backgroundColor: theme.light.roles['surface.canvas'],
          color: theme.light.roles['text.default'],
          fontFamily: theme.fonts.body,
        }}
      >
        {/* Vycentrovaný kontejner místo tabulky na šířku okna. `maxWidth` je
            šířka obsahu z motivu, takže stránka drží tutéž míru jako e-mail
            a autor nemusí návrh přeskládat, když ho z e-mailu zkopíruje. */}
        <main
          style={{
            margin: '0 auto',
            maxWidth: `${theme.contentWidth}px`,
            width: '100%',
          }}
        >
          {children}
        </main>
      </body>
    </html>
  );
}
