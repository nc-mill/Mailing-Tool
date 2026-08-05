import type { VisibilityCondition } from '../document/types';

/**
 * Čistá část viditelnosti bloků, BEZ JSX.
 *
 * Oddělené od komponenty `Visible` schválně. `text/emit.ts` skládá textovou
 * podobu e-mailu a potřebuje odsud jedinou funkci, `visibilityTags`. Dokud obojí
 * bydlelo v `visibility.tsx`, tahal si textový emitor přes ten import celý JSX
 * soubor, a typová kontrola `apps/worker`, která JSX zapnuté nemá ani ho
 * nepotřebuje, na tom padala:
 *
 *   packages/emails/src/text/emit.ts(3,32): error TS6142: Module
 *   '../emitter/visibility' was resolved to '…/visibility.tsx',
 *   but '--jsx' is not set.
 *
 * Je to stejná dělicí čára jako u `ctx.ts`: co nepotřebuje React, nesmí ho
 * vtáhnout, protože závislost na něm se pak přenáší do spotřebitelů, kteří
 * s vykreslováním nemají nic společného.
 *
 * Jméno souboru NESMÍ být `visibility.ts`: přebilo by při rozřešení `./visibility`
 * sousední `.tsx` a komponenta `Visible` by z té cesty zmizela.
 */

/**
 * Klíč do pomocné mapy `_present`: cesta pole s tečkami nahrazenými dvěma podtržítky.
 * Dva segmenty i u vlastního pole, takže se zůstává pod kontraktním limitem tří segmentů.
 */
export function presenceKey(field: string): string {
  return field.split('.').join('__');
}

/**
 * Emitovaná konstrukce neobsahuje uvozovku, literál `blank`, literál `empty`
 * ani operátor porovnání, tedy nic ze zakázaných konstrukcí. Nález K4 se tím
 * obchází úplně a past prázdného řetězce se zavírá v datech, ne v šabloně.
 */
export function visibilityTags(condition: VisibilityCondition): [string, string] {
  switch (condition.op) {
    case 'present':
      return [`{% if _present.${presenceKey(condition.field)} %}`, '{% endif %}'];
    case 'blank':
      return [`{% unless _present.${presenceKey(condition.field)} %}`, '{% endunless %}'];
    case 'true':
      return [`{% if ${condition.field} %}`, '{% endif %}'];
    case 'false':
      return [`{% unless ${condition.field} %}`, '{% endunless %}'];
  }
}
