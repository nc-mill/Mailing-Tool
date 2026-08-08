/**
 * Rozbor schématu odkazu, který SMÍ obsahovat Liquid.
 *
 * Proč to není jen `new URL(href).protocol`: konstruktor spadne na každém
 * odkazu s proměnnou, takže dřívější kontrola takový odkaz radši přeskočila.
 * Tím se ale přeskočila i ta část, kvůli které existuje, a `javascript:` stačilo
 * doplnit o `#{{ x }}`, aby prošlo. Schéma je přitom vlastnost ZAČÁTKU řetězce
 * a proměnná někde dál na něm nic nemění.
 *
 * Druhá půlka problému je pořadí zpracování: Liquid se u veřejné stránky
 * vykresluje AŽ NAD HOTOVÝM HTML. Konstrukce z atributu tedy zmizí a to, co
 * bylo kolem ní, se slepí dohromady. `{{ x }}javascript:alert(1)` je před
 * vykreslením neškodná relativní adresa a po něm hotové schéma. Proto se
 * schéma hledá ve dvou čteních téhož řetězce, ne v jednom.
 */

/** Povolená schémata podle části 3, kapitoly 3 specifikace obsahu. */
export const ALLOWED_LINK_SCHEMES: readonly string[] = ['https:', 'http:', 'mailto:', 'tel:'];

/** Systémový odkaz, který dosazuje sender. Celý href, ne jeho část. */
export const SYSTEM_URL_TAG = /^\{\{\s*(unsubscribe_url|preferences_url|webview_url)\s*\}\}$/;

/**
 * Jedna konstrukce Liquidu tak, jak ji čte tokenizer v kontraktech: od `{{`
 * nebo `{%` k PRVNÍMU odpovídajícímu zavření, bez ohledu na to, co je uvnitř.
 *
 * Dřívější znění `\{%[^%]*%\}` nenašlo konstrukci s procentem uvnitř, tedy
 * třeba `{% if x == "50%" %}`. Kontrola, která je poslední sítí před
 * vykreslením, musí vidět přesně to, co uvidí engine, jinak se dá obejít
 * jedním znakem navíc.
 */
export const LIQUID_CONSTRUCT = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g;

const SCHEME_START = /[a-zA-Z]/;
const SCHEME_CHAR = /[a-zA-Z0-9+.-]/;
/** Poslední znak, který prohlížeč z adresy vyhodí, než ji vyhodnotí. */
const LAST_STRIPPED_CODE = 0x20;

/**
 * Schéma tak, jak ho uvidí PROHLÍŽEČ, ne jak vypadá v souboru.
 *
 * Tabulátor, konec řádku i mezeru prohlížeč z adresy odstraní ještě před
 * vyhodnocením, takže `java<tab>script:` je pro něj `javascript:`. Kdyby se
 * tady nechaly, dala by se kontrola obejít jedním neviditelným znakem.
 *
 * Čte se jen po první dvojtečku. Cokoli jiného než písmeno na začátku a
 * povolený znak dál znamená, že schéma tam žádné není: relativní adresa
 * i odkaz začínající konstrukcí Liquidu skončí hned na prvním znaku.
 */
function schemeOf(value: string): string | null {
  let scheme = '';
  for (const char of value) {
    if ((char.codePointAt(0) ?? 0) <= LAST_STRIPPED_CODE) continue;
    if (char === ':') return scheme === '' ? null : `${scheme.toLowerCase()}:`;
    if (scheme === '' ? !SCHEME_START.test(char) : !SCHEME_CHAR.test(char)) return null;
    scheme += char;
  }
  return null;
}

/**
 * Zakázané schéma odkazu, nebo `null`, když je odkaz z tohohle pohledu v pořádku.
 *
 * „V pořádku" tu znamená POVOLENÉ NEBO ŽÁDNÉ. Relativní adresa a odkaz, jehož
 * začátek teprve dosadí proměnná, schéma nemají, takže se odsud pouštějí dál;
 * rozhoduje o nich volající podle svých vlastních pravidel.
 */
export function forbiddenSchemeOf(href: string): string | null {
  const trimmed = href.trim();
  if (SYSTEM_URL_TAG.test(trimmed)) return null;
  // Dvě čtení, protože obě situace jsou skutečné: schéma před konstrukcí
  // i schéma, které vznikne teprve jejím zmizením při vykreslení.
  for (const candidate of [trimmed, trimmed.replace(LIQUID_CONSTRUCT, '')]) {
    const scheme = schemeOf(candidate);
    if (scheme !== null && !ALLOWED_LINK_SCHEMES.includes(scheme)) return scheme;
  }
  return null;
}

/**
 * Hodnota do atributu `href`. Neznámé schéma degraduje na `#`.
 *
 * Je to POSLEDNÍ ZÁCHYTNÁ SÍŤ, ne hlavní obrana: odkaz se zakázaným schématem
 * má zastavit validace při uložení šablony. Kdyby ji ale někdo obešel starým
 * dokumentem, importem nebo chybou v bráně, do vykresleného atributu se
 * schéma stejně nedostane. `#` je schválně: odkaz zůstane odkazem, jen nikam
 * nevede, takže se rozbije jedno tlačítko a ne celá stránka.
 */
export function safeHref(href: string): string {
  return forbiddenSchemeOf(href) === null ? href : '#';
}
