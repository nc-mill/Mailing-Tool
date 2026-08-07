import type { Issue } from '../issue';
import { PAGE_ISSUE_CODES } from './profile';
import type { Document, VisibilityCondition } from './types';
import { pointerToDotted, richTextFieldsOf, urlFieldsOf, walkBlocks, walkRichText } from './walk';

/**
 * POVRCH je místo, kam se stránka vykreslí. NENÍ to druh šablony: všechny čtyři
 * povrchy jsou tentýž `kind = 'page'` a tentýž validační profil, liší se jenom
 * tím, co o návštěvníkovi vědí.
 *
 * O TOKEN JDE, ne o to, jak se povrch jmenuje:
 *
 * - `form_thanks` a `already_subscribed` jsou OBA cíl přesměrování po odeslání
 *   formuláře, tedy táž trasa `/f/{slug}/thanks`. Chodí se na ně BEZ TOKENU,
 *   takže o návštěvníkovi nevědí vůbec nic.
 * - `confirmed` a `unsubscribed` se otevírají z odkazu v e-mailu, token mají
 *   a přes něj znají kontakt.
 */
export type PageSurface = 'form_thanks' | 'confirmed' | 'already_subscribed' | 'unsubscribed';

/**
 * Odesílatel. Je to nastavení PROJEKTU, takže ho zná každý povrch: stránku
 * vykresluje náš server a projekt, do kterého patří, ví vždycky.
 *
 * Jména kořenů se neliší od e-mailu schválně. `workspace.sender_address` je
 * tatáž proměnná, kterou autor zná z patičky, a druhé pojmenování téhož údaje
 * (třeba `sender.address`) by znamenalo, že text zkopírovaný z e-mailu na
 * stránce mlčky zmizí.
 */
const SENDER = ['workspace.name', 'workspace.sender_address'] as const;

/**
 * Kontakt. Jména jsou z katalogu polí, tedy tatáž, jaká nabízí paletka
 * v editoru e-mailu. `contact.greeting` je hotové oslovení složené podle
 * nastavení projektu, ne surové křestní jméno; na stránce je to nejčastější
 * volba, proto v seznamu je.
 */
const CONTACT = [
  'contact.email',
  'contact.first_name',
  'contact.last_name',
  'contact.greeting',
] as const;

/**
 * Hodnoty, které povrchu dodá aplikace při vykreslení. Kořen `data` je tentýž,
 * jakým dostává potvrzovací e-mail svůj `{{ data.confirm_url }}`.
 */
const FORM_NAME = 'data.form_name';
const LIST_NAME = 'data.list_name';

/**
 * KATALOG PODLE POVRCHU. Tabulka je normativní, ne nápověda: co v ní není,
 * je chyba validace, ne prázdný řetězec (viz `checkSurfaceVariables`).
 *
 * `form_thanks` A `already_subscribed` nemají kontakt, protože obě bydlí na
 * děkovací trase, tedy na cíli přesměrování 303 bez tokenu. Mají naopak název
 * formuláře, protože formulář, ze kterého se přišlo, znají z adresy.
 *
 * `confirmed` a `unsubscribed` to mají obráceně: kontakt znají z tokenu, ale
 * název formuláře ne, protože odkaz v e-mailu o formuláři nic neříká a stránku
 * může vlastnit i seznam. Hodnota by tedy jednou byla a podruhé ne.
 *
 * OPRAVA 7. 8. 2026: `already_subscribed` tu původně mělo kontakt, protože plán
 * ho omylem zařadil mezi stránky otevírané z e-mailu. Fyzicky tam žádný kontakt
 * není, takže by `{{ contact.greeting }}` prošlo validací a u návštěvníka se
 * vykreslilo jako PRÁZDNO, tedy přesně ta vada, kvůli které tenhle katalog
 * vznikl. Našel to agent `stranky-trasy` při zapojování tras, ne kontrola plánu.
 *
 * Zvažovalo se místo toho dát té stránce token. Zamítnuto: token identifikující
 * člověka by se dostal do adresního řádku, do historie prohlížeče a do hlavičky
 * odkazující stránky, a to všechno kvůli větě „už jste přihlášeni".
 */
const VARIABLES: Record<PageSurface, readonly string[]> = {
  form_thanks: [...SENDER, FORM_NAME, LIST_NAME],
  already_subscribed: [...SENDER, FORM_NAME, LIST_NAME],
  confirmed: [...SENDER, LIST_NAME, ...CONTACT],
  unsubscribed: [...SENDER, LIST_NAME, ...CONTACT],
};

/**
 * Povrchy jako BĚHOVÝ seznam, odvozený z katalogu.
 *
 * Typ sám o sobě nestačí: hodnota přicházející z adresy (`?surface=…`) je cizí
 * řetězec, který se musí ověřit za běhu, a `as PageSurface` by ověření jen
 * předstíralo. Odvozuje se z klíčů `VARIABLES`, ne z druhého ručního výčtu,
 * aby nemohl vzniknout povrch, který je v seznamu a v katalogu ne.
 */
export const PAGE_SURFACES = Object.keys(VARIABLES) as readonly PageSurface[];

/** Proměnné, které smí paletka na daném povrchu nabídnout. */
export function variablesForSurface(surface: PageSurface): readonly string[] {
  return VARIABLES[surface];
}

/** Kořen výrazu, tedy `contact` z `contact.attr.mesto | default: "x"`. */
function rootOf(expr: string): string {
  return (expr.split('|')[0] ?? '').trim().split('.')[0]?.trim() ?? '';
}

/** Cesta bez filtrů, tedy `contact.attr.mesto`. */
function pathOf(expr: string): string {
  return (expr.split('|')[0] ?? '').trim();
}

/**
 * Je proměnná na tomhle povrchu k dispozici?
 *
 * Kořen `contact` se posuzuje CELÝ, ne po jednotlivých polích: kontakt na
 * povrchu s tokenem je celý řádek z databáze včetně vlastních atributů, takže
 * `contact.attr.mesto` je platná proměnná, i když ji katalog povrchu nevyjmenuje.
 * Kořen `data` naopak vyjmenovaný JE, protože jeho obsah skládá aplikace ručně
 * a klíč, který do něj nikdo nedá, by se vykreslil jako prázdno.
 */
function availableOnSurface(path: string, surface: PageSurface): boolean {
  const root = path.split('.')[0] ?? '';
  const allowed = VARIABLES[surface];
  if (root === 'workspace' || root === 'contact') {
    return allowed.some((name) => name.startsWith(`${root}.`));
  }
  return allowed.includes(path);
}

const issue = (code: string, pointer: string, params: Record<string, string>): Issue => ({
  code,
  severity: 'error',
  pointer,
  path: pointerToDotted(pointer),
  params,
});

/**
 * Ověří dokument stránky proti povrchu, na kterém se vykreslí.
 *
 * NEDOSTUPNÁ PROMĚNNÁ JE CHYBA, ne prázdný výstup. Render jede se
 * `strictVariables: false`, takže by z chybějící hodnoty tiše udělal prázdný
 * řetězec: návštěvník by dostal „Děkujeme, " s čárkou a dírou za ní a nikdo
 * by se to nedozvěděl. Přesně tahle třída vady se v produktu projevila dvakrát
 * (prázdná adresa odesílatele v patičce, potvrzovací e-mail bez adresy),
 * proto se odmítá uložení.
 *
 * Kontroluje se i pole podmínky zobrazení: `{% if contact.attr.mesto %}` nad
 * povrchem bez kontaktu by blok schoval vždycky, což je stejně tichá vada jako
 * prázdný text, jen hůř viditelná.
 */
export function checkSurfaceVariables(doc: Document, surface: PageSurface): Issue[] {
  const issues: Issue[] = [];

  const check = (expr: string, pointer: string): void => {
    const path = pathOf(expr);
    if (path === '' || rootOf(expr).startsWith('_')) return;
    if (availableOnSurface(path, surface)) return;
    issues.push(issue(PAGE_ISSUE_CODES.variableNotOnSurface, pointer, { path, surface }));
  };

  for (const { block, pointer } of walkBlocks(doc)) {
    const condition = (block as { visibleWhen?: VisibilityCondition | null }).visibleWhen;
    if (condition) check(condition.field, `${pointer}/visibleWhen/field`);

    for (const field of richTextFieldsOf(block)) {
      const base = `${pointer}/props/${field.key}`;
      for (const { node, pointer: inlinePointer } of walkRichText(field.rich, base)) {
        if (node.t === 'var') check(node.expr, `${inlinePointer}/expr`);
        if (node.t === 'a') checkUrl(node.href, `${inlinePointer}/href`, check);
      }
    }

    for (const url of urlFieldsOf(block)) checkUrl(url.href, `${pointer}${url.pointer}`, check);
  }

  return issues;
}

/** Výstupní konstrukce v URL poli. Tag `{% %}` v odkazu nedává smysl. */
const LIQUID_OUTPUT = /\{\{([^}]*)\}\}/g;

function checkUrl(
  href: string,
  pointer: string,
  check: (expr: string, pointer: string) => void,
): void {
  for (const match of href.matchAll(LIQUID_OUTPUT)) check(match[1] ?? '', pointer);
}
