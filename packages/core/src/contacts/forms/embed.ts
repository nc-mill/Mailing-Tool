export type EmbedSnippets = {
  /**
   * Výchozí varianta. Skript vykreslí formulář přímo do stránky, bez jediného
   * pravidla stylu a s pojmenovanými úchyty, takže vzhled určuje hostitelský web.
   */
  script: string;
  /**
   * Pro redakční systémy, kde nejde vložit skript, a pro weby s vypnutým
   * JavaScriptem: uvnitř rámečku běží NAŠE stránka `/f/{slug}`, takže si nonce
   * i ochrany řeší sama.
   */
  iframe: string;
};

/**
 * Kód k vložení formuláře na cizí web.
 *
 * DVĚ VARIANTY, NE TŘI. Třetí bývala „čistě HTML formulář, funguje i bez
 * JavaScriptu" a MUSELA ZMIZET, protože tiše zahazovala data. Druhá vrstva
 * ochrany (`checkProtection`) vyžaduje nonce a `verifyNonce` ho váže na
 * formulář, na PREFIX IP odesílatele a na čas vydání. Statický HTML kód
 * zkopírovaný na cizí web nemá jak nonce získat: v okamžiku generování
 * neznáme IP návštěvníka a do vypršení TTL by stejně nedožil. Naměřeno na
 * instalaci doslova takhle:
 *
 *   POST /f/{ref}/submit  (urlencoded, bez nonce)  →  HTTP 303 na děkovací stránku
 *   form_submissions                               →  dropped / missing_nonce
 *
 * Návštěvník tedy viděl „děkujeme" a kontakt nevznikl. Tichá ztráta dat je
 * horší než chybějící varianta, a oba důvody, proč ta varianta existovala,
 * dnes plní zbylé dvě: plnou kontrolu nad vzhledem dává skriptová varianta
 * (holé značkování s úchyty `ml-form`, `ml-field`, …) a funkci bez JavaScriptu
 * na straně hostitele dává rámeček.
 *
 * Ani jedna varianta nenese CSS. Rámeček měl dřív `style="border:0"`; vzhled
 * si určuje web přes třídu `ml-embed-frame` jako u všeho ostatního.
 *
 * POZOR NA `slug`. Očekává se VEŘEJNÝ IDENTIFIKÁTOR z `publicFormRef(form)`, ne holý
 * `form.slug`. Veřejné adresy nesou projekt v sobě (viz `public/ids.ts`), takže odkaz
 * složený z holého slugu by na `/f/**` skončil generickou stránkou „odkaz neplatí"
 * a nikdo by nepoznal proč: formulář existuje, jen ho endpoint nemá podle čeho najít.
 */
export function buildEmbedSnippets(input: { appUrl: string; slug: string }): EmbedSnippets {
  const base = input.appUrl.replace(/\/$/, '');
  return {
    script:
      `<script async src="${base}/f/${input.slug}.js"></script>\n` +
      `<div data-ml-form="${input.slug}"></div>`,
    iframe:
      `<iframe src="${base}/f/${input.slug}" width="100%" height="320" ` +
      `class="ml-embed-frame" title="Přihlášení k odběru"></iframe>`,
  };
}
