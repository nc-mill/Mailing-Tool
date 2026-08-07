/**
 * POVRCH veřejné stránky tak, jak ho vidí editor.
 *
 * Typ i katalog proměnných se BEROU z `@mlain/emails/document/page-surfaces`,
 * ne opisují. Tabulku, co je na kterém povrchu k dispozici, vlastní validátor
 * dokumentu, a kdyby si ji editor držel podruhé, rozešly by se: paletka by
 * nabídla údaj, který uložení vzápětí odmítne, nebo hůř, nenabídla by údaj,
 * který je v pořádku, a uživatel by ho napsal ručně.
 *
 * Import je bezpečný i v prohlížeči: `page-surfaces.ts` je čistá funkce nad
 * dokumentem, bez databáze a bez IO. Doména `@mlain/core` sem nesmí.
 */
export {
  checkSurfaceVariables,
  variablesForSurface,
  type PageSurface,
} from '@mlain/emails/document/page-surfaces';

import type { PageSurface } from '@mlain/emails/document/page-surfaces';
import { variablesForSurface } from '@mlain/emails/document/page-surfaces';

/**
 * Povrch, se kterým editor pracuje, když mu ho volající NEDODAL.
 *
 * Je to `form_thanks`, tedy ten NEJUŽŠÍ: děkovací stránka je cíl přesměrování
 * bez tokenu, takže o návštěvníkovi neví nic a kontakt na ní k dispozici není.
 *
 * Volba je záměr, ne pohodlnost. Kdyby chybějící povrch znamenal „všechno je
 * dovoleno", projevila by se nezapojená propa až u návštěvníka, a to prázdným
 * místem uprostřed věty; přesně ta vada, kvůli které celé pravidlo vzniklo
 * (plán, oddíl 4.3). Takhle se projeví hláškou v editoru, kterou je vidět
 * hned a která se dá vystopovat k tomu, kdo editor otevřel.
 */
export const DEFAULT_PAGE_SURFACE: PageSurface = 'form_thanks';

/** Zná tenhle povrch kontakt? Rozhoduje o tom, jestli se nabídnou pole kontaktu. */
export function surfaceHasContact(surface: PageSurface): boolean {
  return variablesForSurface(surface).some((name) => name.startsWith('contact.'));
}

/**
 * Proměnné povrchu, které NEJSOU z kontaktu, tedy `workspace.*` a `data.*`.
 *
 * Pole kontaktu si paletka bere z katalogu polí projektu (jsou tam i vlastní
 * atributy, které tabulka povrchů nevyjmenovává), kdežto tyhle dodává aplikace
 * a nikde jinde než tady se o nich nedozví.
 */
export function surfaceNonContactVariables(surface: PageSurface): string[] {
  return variablesForSurface(surface).filter((name) => !name.startsWith('contact.'));
}
