import type { ReactElement, ReactNode } from 'react';
import type { VisibilityCondition } from '../document/types';

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

export function Visible({
  when,
  children,
}: {
  // `| undefined` je kvůli exactOptionalPropertyTypes: `visibleWhen` je na bloku
  // nepovinné, takže sem chodí i jako undefined, ne jen chybějící.
  when?: VisibilityCondition | null | undefined;
  children: ReactNode;
}): ReactElement {
  if (!when) return <>{children}</>;
  const [open, close] = visibilityTags(when);
  return (
    <>
      {open}
      {children}
      {close}
    </>
  );
}
