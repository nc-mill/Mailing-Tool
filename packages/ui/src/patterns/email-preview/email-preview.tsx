'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/button';
import { cn } from '../../lib/cn';

export type EmailPreviewLabels = {
  widthDesktop: string;
  widthMobile: string;
  themeLight: string;
  themeDark: string;
  blockedExternal: string;
};

const WIDTHS = { desktop: 640, mobile: 375 } as const;

/** Pod 480 px se náhled počítá jako mobilní. Používá se jen pro `data-width`. */
function widthNameOf(pixels: number): 'desktop' | 'mobile' {
  return pixels < 480 ? 'mobile' : 'desktop';
}

/**
 * Náhled e-mailu v izolovaném rámci.
 *
 * `sandbox=""` bez jediné výjimky znamená: žádné skripty, žádné formuláře,
 * žádná navigace, cizí původ. HTML v náhledu je uživatelský obsah,
 * takže se k němu chováme jako k cizímu. **Výjimka `allow-same-origin`
 * se nepřidá**: vrátila by rámci původ aplikace a izolaci oslabila bez
 * jakéhokoli zisku, protože skripty stejně neběží.
 *
 * CSP uvnitř `srcdoc` navíc zakáže odchozí požadavky, takže se náhledem
 * nedá vystopovat, kdo si ho otevřel, a platí slib o nulové komunikaci
 * s cizím cloudem. Samotný atribut `sandbox` by to neuměl: obrázek z cizí
 * domény by se načetl.
 *
 * OBRÁZKY Z VLASTNÍ INSTALACE SE ZOBRAZUJÍ, CIZÍ NE.
 *
 * `img-src data:` samotné znamenalo, že náhled NIKDY neukázal obrázek
 * z knihovny médií, a to je vada, ne přísnost. Emitter skládá adresu jako
 * `<ASSET_BASE_URL>/a/<public_id>/<varianta>.<přípona>` (viz
 * `packages/emails/src/emitter/assets.ts`), tedy absolutní `http(s)` odkaz,
 * který `img-src data:` zakáže. V náhledu pak byla na místě obrázku rozbitá
 * dlaždice, přestože adresa fungovala; ověřeno v prohlížeči proti běžící
 * instalaci, kde `GET /a/…/w600.png` vracelo 200 a `image/png`.
 *
 * Povoluje se proto PŮVOD SAMOTNÉ APLIKACE, nic víc. Slib o nulové komunikaci
 * s cizím cloudem tím zůstává v platnosti doslova: náhled sáhne jen na server,
 * který ho právě vydal a který o uživateli stejně ví všechno. Obrázek vložený
 * do bloku Vlastní HTML z cizí domény se dál nenačte, což je přesně stav,
 * pro který existuje popisek `blockedExternal`.
 *
 * Původ se dosazuje AŽ PO PŘIPOJENÍ KOMPONENTY (`useEffect`), ne během
 * vykreslení. `window.location.origin` čtený v `useMemo` by na serveru
 * neexistoval, takže by se první klientské vykreslení rozešlo se serverovým
 * a React by hlásil neshodu při hydrataci.
 *
 * RÁM SE PROTO VLOŽÍ AŽ S HOTOVOU `srcdoc`, NIKDY DŘÍV. Tohle je oprava
 * prázdného náhledu, ne kosmetika: Chromium nechá rám, kterému se `srcdoc`
 * změní bezprostředně po vložení do stránky, NEVYKRESLENÝ. Dokument se
 * rozparsuje a obsah je v DOM, ale rám zůstane prázdný bílý obdélník
 * (`document.body.getBoundingClientRect()` vrací nuly, tedy žádné rozvržení).
 * Naměřeno v prohlížeči proti běžící instalaci: rám editoru byl prázdný,
 * zatímco čerstvě vložený rám s TÝMŽ `srcdoc` se vykreslil správně (výška
 * těla 1929 px). Závod je nedeterministický, jednou padne změna v témže tiku,
 * podruhé až v mikroúloze, takže se na časování nedá spoléhat.
 *
 * Dokud původ neznáme, kreslí se místo rámu prázdné místo stejné velikosti,
 * aby obrazovka neposkočila. Uživatel to nepozná, efekt proběhne hned po
 * připojení, ale rám dostane konečnou `srcdoc` už při vzniku.
 *
 * **Šířka a tmavý režim jdou řídit zvenčí.** Editor šablon má přepínače
 * ve vlastní liště nástrojů a nabízí navíc textovou verzi a zdroj. Když
 * `labels` chybí, komponenta vlastní přepínače nevykreslí, takže uživatel
 * nikdy neuvidí dvě sady stejných tlačítek.
 */
export function EmailPreview({
  html,
  title,
  width: widthProp,
  dark: darkProp,
  labels,
  imageOrigins,
  className,
}: {
  html: string;
  /** Přístupný název rámce. Nikdy prázdný, čtečka podle něj rámec pojmenuje. */
  title: string;
  /** Řízená šířka: pixely, nebo pojmenovaná hodnota. */
  width?: number | 'desktop' | 'mobile';
  /** Řízený tmavý režim náhledu, nezávislý na režimu aplikace. */
  dark?: boolean;
  /** Když chybí, komponenta vlastní přepínače nevykreslí. */
  labels?: EmailPreviewLabels;
  /**
   * Původy, ze kterých se v náhledu smí načíst obrázek, navíc k `data:`.
   *
   * Když se nezadá, povolí se původ samotné aplikace. Zadává se jen tehdy,
   * když instalace vydává obrázky z jiné domény než aplikaci, tedy když se
   * `ASSET_BASE_URL` liší od `APP_URL` (typicky CDN před úložištěm).
   * Prázdné pole zakáže i vlastní původ a vrátí přísný stav `img-src data:`.
   */
  imageOrigins?: readonly string[];
  className?: string;
}) {
  const [ownWidth, setOwnWidth] = useState<'desktop' | 'mobile'>('desktop');
  const [ownDark, setOwnDark] = useState(false);

  const controlledWidth = widthProp !== undefined;
  const controlledDark = darkProp !== undefined;

  const widthPixels = controlledWidth
    ? typeof widthProp === 'number'
      ? widthProp
      : WIDTHS[widthProp]
    : WIDTHS[ownWidth];

  const widthName = controlledWidth
    ? typeof widthProp === 'number'
      ? widthNameOf(widthProp)
      : widthProp
    : ownWidth;

  const isDark = controlledDark ? darkProp : ownDark;
  const theme = isDark ? 'dark' : 'light';

  const [selfOrigin, setSelfOrigin] = useState<string | null>(null);
  useEffect(() => setSelfOrigin(window.location.origin), []);

  // Když původy určuje volající, nemá na co čekat a rám se vloží hned.
  const originResolved = imageOrigins !== undefined || selfOrigin !== null;

  const allowedImages = useMemo(() => {
    if (imageOrigins !== undefined) return imageOrigins;
    return selfOrigin === null ? [] : [selfOrigin];
  }, [imageOrigins, selfOrigin]);

  const srcDoc = useMemo(() => {
    // Uvozovky se z původu zahazují: hodnota jde do atributu `content`, který
    // se skládá řetězcem, a apostrof by direktivu ukončil. Původ je `scheme://
    // host[:port]`, takže se tím o nic nepřichází.
    const images = ['data:', ...allowedImages.map((origin) => origin.replace(/["'\s;]/g, ''))]
      .filter((source) => source !== '')
      .join(' ');
    const csp = `default-src 'none'; img-src ${images}; style-src 'unsafe-inline'; font-src 'none'; script-src 'none'`;
    const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
    const background = theme === 'dark' ? '#0b0f17' : '#ffffff';
    const color = theme === 'dark' ? '#e9edf3' : '#111827';
    const style = `<style>html,body{margin:0;background:${background};color:${color};color-scheme:${theme};}</style>`;

    /*
     * TMAVÝ REŽIM SE SIMULUJE ATRIBUTY `data-ogsc` a `data-ogsb`, ne jen barvou
     * rámu. Emitter píše tmavou paletu dvakrát: jednou do
     * `@media (prefers-color-scheme:dark)` a jednou do pravidel
     * `[data-ogsc] .ml-text`, protože Outlook.com svoje tmavé zobrazení hlásí
     * právě těmi atributy na kořeni dokumentu.
     *
     * Media dotaz uvnitř rámu ovlivnit nejde: řídí ho nastavení systému, ne
     * stránka, a `color-scheme:dark` na `html` ho nepřepne. Přepínač tedy sám
     * o sobě jen ztmavil pozadí rámu, které e-mail vzápětí přetřel vlastním
     * bílým `background-color`, takže se nezměnilo NIC VIDITELNÉHO. Sáhnutím
     * po `[data-ogsc]` se použije tmavá paleta, kterou si e-mail sám napsal.
     *
     * Zůstává jeden rozdíl proti skutečnému tmavému klientu: prohození světlého
     * a tmavého loga visí jen na media dotazu, takže se v náhledu neprojeví.
     */
    const darkHooks = theme === 'dark' ? ' data-ogsc="" data-ogsb=""' : '';

    if (html.includes('<head')) {
      return html
        .replace(/<html\b/i, `<html${darkHooks}`)
        .replace('<head>', `<head>${meta}${style}`);
    }
    return `<!doctype html><html${darkHooks}><head>${meta}${style}</head><body>${html}</body></html>`;
  }, [html, theme, allowedImages]);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {labels ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setOwnWidth('desktop')}>
            {labels.widthDesktop}
          </Button>
          <Button variant="secondary" onClick={() => setOwnWidth('mobile')}>
            {labels.widthMobile}
          </Button>
          <Button variant="secondary" onClick={() => setOwnDark((current) => !current)}>
            {isDark ? labels.themeLight : labels.themeDark}
          </Button>
        </div>
      ) : null}

      {originResolved ? (
        <iframe
          /*
           * KLÍČ JE `srcdoc` SCHVÁLNĚ, ať se rám při každé změně obsahu vyrobí
           * znovu. Kdyby se `srcdoc` měnila na už vloženém rámu, hrozí tentýž
           * závod Chromia, kvůli kterému byl náhled prázdný: změna, která
           * dorazí dřív, než se předchozí `srcdoc` stihne načíst, nechá rám
           * nevykreslený. Nový element dostane konečnou hodnotu ještě před
           * vložením do stránky, takže se načítá právě jednou. Rám se překreslí
           * tak jako tak, jinou pozici posuvníku tím uživatel neztrácí.
           */
          key={srcDoc}
          title={title}
          // Bez jediné výjimky. Viz komentář nad komponentou.
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={srcDoc}
          data-width={widthName}
          data-preview-theme={theme}
          style={{ width: widthPixels }}
          className="h-[36rem] max-w-full rounded-[var(--radius-surface)] border border-border bg-surface"
        />
      ) : (
        <div
          aria-hidden="true"
          data-testid="email-preview-placeholder"
          style={{ width: widthPixels }}
          className="h-[36rem] max-w-full rounded-[var(--radius-surface)] border border-border bg-surface"
        />
      )}

      {labels ? <p className="text-sm text-text-muted">{labels.blockedExternal}</p> : null}
    </div>
  );
}
