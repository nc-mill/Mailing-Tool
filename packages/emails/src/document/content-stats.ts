import type { Document } from './types';
import { walkBlocks } from './walk';

/**
 * Kolik obsahu dokument doopravdy nese.
 *
 * VZNIKLO Z VADY Z INSTALACE. Kampaň „Test kampaň (kopie)" odešla na tři adresy
 * a v schránce dorazil e-mail, ve kterém nebylo nic než patička: odkazy Odhlásit
 * se z odběru, Nastavit předvolby a Zobrazit v prohlížeči. V databázi to sedělo
 * přesně tak, jak to odešlo (`compiled_text` měl 166 znaků a byly to ty tři
 * odkazy), takže to nebyla vada odesílání ani vykreslování. Dokument měl jednu
 * sekci a v ní JEDINÉHO potomka typu `footer`, tedy přesně tvar, jaký vydá
 * `emptyDocument` při založení nového obsahu kampaně.
 *
 * Nikdo se přitom neptal, JESTLI tam něco je. Kontrola před odesláním hlídala
 * `compiled_html` (bylo, patička se zkompiluje jako každý jiný blok) a odkaz na
 * odhlášení (byl, právě z té patičky), takže prázdný e-mail prošel oběma branami.
 *
 * Odsud pravidlo: patička není obsah. Stejně tak není obsah nic, co samo o sobě
 * nenese sdělení, viz `CONTENT_BLOCK_TYPES` níž.
 */

/**
 * Typy bloků, které se počítají jako OBSAH e-mailu.
 *
 * Je to jediný zdroj pravdy pro celý repozitář. Dotaz v `campaigns/api/service.ts`
 * si z něj skládá seznam pro SQL, aby nevznikla druhá kopie pravidla, která by se
 * s touhle rozešla; rozdíl by se projevil tím, že obrazovka kampaně tvrdí „obsah
 * je", zatímco kontrola před odesláním hlásí „e-mail je prázdný".
 */
export const CONTENT_BLOCK_TYPES = [
  'heading',
  'text',
  'image',
  'button',
  'social',
  'html',
] as const;

/**
 * Typy bloků, které se za obsah NEPOČÍTAJÍ, a proč.
 *
 *  - `footer` je systémová patička (adresa odesílatele a odkazy na odhlášení,
 *    předvolby a webovou verzi). Do každého e-mailu ji vkládá nástroj, ne autor,
 *    a e-mail, ve kterém není nic než ona, nemá důvod komukoli odejít.
 *  - `section`, `columns`, `column` a `repeat` jsou nosníky rozvržení. Prázdná
 *    sekce vykreslí prázdný pruh; obsah je až to, co je v ní.
 *  - `divider` a `spacer` jsou výplň. Čára a mezera nic nesdělují.
 *
 * PREHEADER V SEZNAMU NENÍ, protože to není blok: leží v `meta.previewText`
 * dokumentu, respektive v `campaigns.preheader`. Do počtu obsahových bloků se
 * tedy nedostane už z principu a vyplněný preheader sám o sobě z prázdného
 * e-mailu neudělá odeslatelný.
 */
export const NON_CONTENT_BLOCK_TYPES = [
  'section',
  'columns',
  'column',
  'repeat',
  'footer',
  'divider',
  'spacer',
] as const;

const CONTENT_TYPES = new Set<string>(CONTENT_BLOCK_TYPES);

/**
 * Je hodnota použitelná jako dokument?
 *
 * Bere `unknown`, protože design chodí z jsonb sloupce a volající ho typují jen
 * přetypováním. Rozbitý tvar se počítá jako nula obsahových bloků, nikdy nepadá:
 * chybu tvaru hlásí validace dokumentu, tahle funkce jen počítá.
 */
function blocksOf(design: unknown): Document | null {
  const doc = design as Document | null;
  if (doc === null || typeof doc !== 'object') return null;
  return Array.isArray(doc.blocks) ? doc : null;
}

/**
 * Počet obsahových bloků v celé hloubce dokumentu, včetně bloků ve sloupcích
 * a v cyklech.
 *
 * Počítá se TYP bloku, ne jeho výplň: nadpis, do kterého uživatel zatím nic
 * nenapsal, je rozdělaná práce, ne prázdný e-mail. Uživatel ten blok v editoru
 * vidí a ví o něm, kdežto o tom, že za patičkou nic není, se dozvěděl až ze
 * své schránky.
 */
export function countContentBlocks(design: unknown): number {
  const doc = blocksOf(design);
  if (doc === null) return 0;
  let count = 0;
  for (const visit of walkBlocks(doc)) {
    if (CONTENT_TYPES.has(visit.block.type)) count += 1;
  }
  return count;
}

/** Má dokument aspoň jeden obsahový blok? */
export function hasContentBlocks(design: unknown): boolean {
  return countContentBlocks(design) > 0;
}

/**
 * Stav obsahu ve třech hodnotách, protože „kampaň obsah nemá" a „obsah je
 * prázdný" jsou dvě různé věci a uživatel s každou dělá něco jiného.
 *
 *  - `missing`: dokument vůbec není (kampaň si ho ještě nezaložila ani nepřevzala),
 *  - `empty`: dokument je, ale není v něm jediný obsahový blok,
 *  - `ok`: dokument nese aspoň jeden obsahový blok.
 */
export type ContentState = 'missing' | 'empty' | 'ok';

export function contentStateOf(design: unknown): ContentState {
  if (blocksOf(design) === null) return 'missing';
  return countContentBlocks(design) > 0 ? 'ok' : 'empty';
}
