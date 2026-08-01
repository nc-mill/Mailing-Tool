'use client';

import { useMemo, useState } from 'react';
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
 * domény by se načetl. Obrázky z domény uživatele si zapne až obrazovka
 * editoru výslovným přepnutím, kdy o tom uživatel ví.
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

  const srcDoc = useMemo(() => {
    const csp =
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; script-src 'none'";
    const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
    const background = theme === 'dark' ? '#0b0f17' : '#ffffff';
    const color = theme === 'dark' ? '#e9edf3' : '#111827';
    const style = `<style>html,body{margin:0;background:${background};color:${color};color-scheme:${theme};}</style>`;

    if (html.includes('<head')) {
      return html.replace('<head>', `<head>${meta}${style}`);
    }
    return `<!doctype html><html><head>${meta}${style}</head><body>${html}</body></html>`;
  }, [html, theme]);

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

      <iframe
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

      {labels ? <p className="text-sm text-text-muted">{labels.blockedExternal}</p> : null}
    </div>
  );
}
