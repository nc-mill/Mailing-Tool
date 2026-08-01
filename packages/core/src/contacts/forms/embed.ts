export type EmbedSnippets = {
  /** Výchozí varianta, nejlepší vzhled. Vykresluje do zapouzdřeného stromu. */
  script: string;
  /** Pro redakční systémy, kde nejde vložit skript. */
  iframe: string;
  /** Plná kontrola nad vzhledem, funguje bez JavaScriptu. */
  html: string;
};

/**
 * Tři varianty vložení podle 4.13.1 části 2.
 *
 * Skriptová varianta vykresluje formulář do zapouzdřeného stromu (shadow DOM), takže
 * styly hostitelské stránky nemohou rozbít vzhled a naopak. Skript sám o sobě nic
 * netrackuje a je oddělený od trackovacího SDK z části 5.
 *
 * Čistě HTML varianta funguje i s vypnutým JavaScriptem, jen bez ochrany časovou pastí
 * a bez nonce. Uživatel je na to při generování kódu upozorněný.
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
      `style="border:0" title="Přihlášení k odběru"></iframe>`,
    html:
      `<form action="${base}/f/${input.slug}/submit" method="post">\n` +
      `  <label for="ml-email">E-mail</label>\n` +
      `  <input id="ml-email" type="email" name="email" required>\n` +
      `  <div style="position:absolute;left:-9999px" aria-hidden="true">\n` +
      `    <input type="text" name="website" tabindex="-1" autocomplete="off">\n` +
      `  </div>\n` +
      `  <button type="submit">Přihlásit se k odběru</button>\n` +
      `</form>`,
  };
}
