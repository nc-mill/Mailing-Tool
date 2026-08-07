/**
 * ODKAZ V TEXTU SOUHLASU, bezpečně.
 *
 * Text u zaškrtávacího políčka musí umět odkázat na obchodní podmínky nebo na
 * zásady zpracování údajů, které leží na cizím webu, kam je formulář vložený.
 * Bez odkazu tam zbývá holá adresa k opsání, což u souhlasu podle GDPR nestačí:
 * člověk má mít možnost si podmínky přečíst, ne je hledat.
 *
 * SYROVÉ HTML SE SEM NEPOUŠTÍ, a není to opatrnost navíc. Ten text se vykresluje
 * na VEŘEJNÉ stránce, kterou si otevře kdokoli s odkazem, a zapisuje ho člen
 * projektu, tedy ne nutně ten, kdo za web odpovídá. Vložit sem značky rovnou jako
 * kus stránky by znamenalo, že kdokoli s právem upravit formulář umí na cizí web
 * podstrčit libovolný obsah. Přísná politika obsahu zastaví skript, ale `javascript:`
 * v odkazu ani podvodný text pod cizí značkou nezastaví.
 *
 * Rozpoznávají se DVA ZÁPISY téhož a schválně:
 *   `<a href="https://…">text</a>`  protože přesně tohle člověk zkusí nejdřív,
 *   `[text](https://…)`             protože je to kratší a snese se s prostým textem.
 * Kdyby uměl jen jeden, ten druhý by se na stránce ukázal jako holé znaky a
 * vypadalo by to jako vada produktu.
 *
 * Všechno ostatní zůstává TEXTEM, včetně `<b>`, `<script>` i osamocených lomených
 * závorek. Vykreslovací strana je pak povinná escapovat, protože sem chodí segmenty,
 * ne hotové HTML.
 */

/** Kus textu souhlasu: buď prostý text, nebo odkaz. Nikdy hotové HTML. */
export type ConsentSegment =
  { kind: 'text'; value: string } | { kind: 'link'; href: string; text: string };

/**
 * Povolené jsou JEN `http` a `https`. Sráží to `javascript:`, `data:` i `vbscript:`
 * a dělá to rozborem adresy, ne hledáním podřetězce: `java\tscript:` i
 * `JaVaScRiPt:` projdou textovým filtrem, ale `new URL()` je přečte správně.
 *
 * Relativní adresa se odmítá taky. Formulář se vkládá na CIZÍ web, takže `/podminky`
 * by mířilo na doménu toho webu jen náhodou; u vloženého rámu na naši vlastní.
 */
function safeHref(raw: string): string | null {
  try {
    const parsed = new URL(raw.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

const ANCHOR = /<a\s+href\s*=\s*["']([^"']+)["']\s*>(.*?)<\/a\s*>/gis;
const MARKDOWN = /\[([^\]]+)]\(([^)\s]+)\)/g;

/**
 * Rozloží text souhlasu na segmenty. Nikdy nevrací HTML a nikdy nevyhazuje výjimku:
 * na poškozeném zápisu vrátí celý vstup jako text, protože souhlas se musí ukázat
 * i tehdy, když se autor u zápisu odkazu překlepl.
 */
export function parseConsentText(text: string): ConsentSegment[] {
  // Nejdřív se z HTML tvaru udělá ten značkovací, aby zbyl JEDEN průchod a nemohly
  // se ty dva zápisy do sebe zamotat (odkaz uvnitř odkazu).
  const normalized = text.replace(ANCHOR, (_whole, href: string, label: string) => {
    const safe = safeHref(href);
    // Popisek se čistí od zbylých značek: `<a href="…"><b>text</b></a>` má dát
    // „text", ne „<b>text</b>", jinak by se ta `<b>` ukázala na stránce.
    const plain = label.replace(/<[^>]*>/g, '').trim();
    if (safe === null || plain === '') return plain;
    return `[${plain}](${safe})`;
  });

  const segments: ConsentSegment[] = [];
  let lastIndex = 0;
  for (const match of normalized.matchAll(MARKDOWN)) {
    const whole = match[0];
    const label = match[1]!;
    const safe = safeHref(match[2]!);
    const before = normalized.slice(lastIndex, match.index);
    if (before !== '') segments.push({ kind: 'text', value: before });
    if (safe === null) {
      // Nepovolená adresa NEMIZÍ, zůstane textem. Tichý zánik kusu souhlasu
      // by byl horší než viditelně divný zápis: souhlas je právní doklad.
      segments.push({ kind: 'text', value: whole });
    } else {
      segments.push({ kind: 'link', href: safe, text: label });
    }
    lastIndex = match.index + whole.length;
  }

  const tail = normalized.slice(lastIndex);
  if (tail !== '') segments.push({ kind: 'text', value: tail });
  return segments;
}

/** Escapování pro vykreslení do řetězce s HTML (náhled, vložený formulář). */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Text souhlasu jako HTML řetězec. Pro místa, která skládají stránku textově
 * (náhled formuláře); React si segmenty vykreslí sám.
 *
 * `rel="noopener noreferrer nofollow"` a `target="_blank"`: odkaz vede pryč
 * z formuláře, a kdyby se otevřel v témž okně, člověk by přišel o rozepsané údaje.
 */
export function consentTextToHtml(text: string): string {
  return parseConsentText(text)
    .map((segment) =>
      segment.kind === 'text'
        ? escapeHtml(segment.value)
        : `<a href="${escapeHtml(segment.href)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(segment.text)}</a>`,
    )
    .join('');
}
