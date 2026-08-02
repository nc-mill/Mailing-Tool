/// <reference lib="dom" />
/*
 * Soubor pracuje s DOM API (linkedom je dodává v Node), takže potřebuje typy
 * z `lib.dom`. Deklaruje si je SÁM, tímhle řádkem, a ne přes tsconfig.
 *
 * Důvod: `packages/core` konzumuje i `apps/worker`, jehož typová kontrola
 * `lib.dom` nemá. Bez tohohle odkazu prošla kontrola balíčku samotného
 * a spadla až u konzumenta, na hláškách jako `Cannot find name 'Element'`
 * a `TS18046: 'node' is of type 'unknown'`. Zapnout `lib.dom` celému workeru
 * by byla horší cesta: dostal by k dispozici `window` a `document`, které
 * v serverovém procesu nikdy nebudou.
 */
import { parseHTML } from 'linkedom';

export const MAX_TEXT_CHARS = 4000;

const DROPPED_TAGS = ['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'object'];

export type ParsedDocument = { document: Document };

const HAS_BODY = /<body[\s>]/i;

/**
 * Parsuje HTML bez spouštění skriptů. `linkedom` skripty nikdy nespouští.
 *
 * ODCHYLKA OD PLÁNU, vynucená měřením. `parseHTML` v linkedomu na rozdíl od
 * prohlížeče NEDOPLŇUJE chybějící `<html>` a `<body>`: fragment zůstane
 * volně v dokumentu a `document.body` je prázdný. Plánované znění proto
 * vracelo prázdný řetězec pro každou stránku bez `<body>` a na úplně prázdném
 * vstupu shodilo `createTreeWalker` na chybějícím kořeni.
 *
 * Vstup bez `<body>` se proto obalí sám. Skutečné stránky značku mají,
 * takže je to opatření pro fragmenty a rozbité dokumenty.
 */
export function parseDocument(html: string): ParsedDocument {
  const source = HAS_BODY.test(html) ? html : `<html><body>${html}</body></html>`;
  const { document } = parseHTML(source);
  return { document: document as unknown as Document };
}

function isHidden(element: Element): boolean {
  if (element.hasAttribute('hidden')) return true;
  const style = (element.getAttribute('style') ?? '').toLowerCase().replaceAll(' ', '');
  return (
    style.includes('display:none') ||
    style.includes('visibility:hidden') ||
    style.includes('opacity:0') ||
    style.includes('font-size:0')
  );
}

/**
 * Do promptu jde jen zkrácený viditelný text: bez značek, bez komentářů, bez
 * obsahu `<script>` a `<style>` a bez hodnot atributů. Skryté prvky se
 * odstraňují, protože jsou typickým nosičem injektáže.
 */
export function extractVisibleText(parsed: ParsedDocument): string {
  const { document } = parsed;

  for (const tag of DROPPED_TAGS) {
    for (const node of Array.from(document.querySelectorAll(tag))) node.remove();
  }

  // Komentáře nesou injektáž stejně dobře jako skryté prvky.
  const walker = document.createTreeWalker(document, 128 /* NodeFilter.SHOW_COMMENT */);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  for (const comment of comments) comment.parentNode?.removeChild(comment);

  for (const element of Array.from(document.querySelectorAll('*'))) {
    if (isHidden(element)) element.remove();
  }

  /*
   * Text se skládá z jednotlivých textových uzlů spojených mezerou, ne
   * z `textContent` celého podstromu. `textContent` slepí sousední bloky
   * dohromady („Kolo ShopProdáváme kola.") a z dvou vět udělá jedno slovo,
   * což je pro odvození tónu horší vstup než pár mezer navíc.
   */
  const root = document.body ?? document.documentElement;
  if (root === null || root === undefined) return '';

  const textWalker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const pieces: string[] = [];
  while (textWalker.nextNode()) {
    const piece = textWalker.currentNode.nodeValue ?? '';
    if (piece.trim() !== '') pieces.push(piece);
  }

  return pieces.join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
}

/** Kandidáti na externí stylesheety, v pořadí výskytu. */
export function collectStylesheetUrls(parsed: ParsedDocument, baseUrl: string): string[] {
  const urls: string[] = [];
  for (const link of Array.from(parsed.document.querySelectorAll('link[rel~="stylesheet"]'))) {
    const href = link.getAttribute('href');
    if (href === null) continue;
    try {
      urls.push(new URL(href, baseUrl).toString());
    } catch {
      // Nepoužitelná adresa se přeskočí, extrakce kvůli ní nespadne.
    }
  }
  return urls;
}

/** Hodnota `<meta name="theme-color">`, tedy explicitní tvrzení o barvě značky. */
export function readThemeColor(parsed: ParsedDocument): string | undefined {
  const meta = parsed.document.querySelector('meta[name="theme-color"]');
  const content = meta?.getAttribute('content');
  return content === null || content === undefined || content.trim() === '' ? undefined : content;
}

/** CSS z prvků `style` a z atributů `style`. */
export function collectInlineCss(originalHtml: string): string {
  const fresh = parseHTML(originalHtml).document;
  const blocks = Array.from(fresh.querySelectorAll('style')).map((node) => node.textContent ?? '');
  const attributes = Array.from(fresh.querySelectorAll('[style]')).map(
    (node) => `x{${node.getAttribute('style') ?? ''}}`,
  );
  return [...blocks, ...attributes].join('\n');
}
