import type { ReactElement, ReactNode } from 'react';
import type { VisibilityCondition } from '../document/types';
import { visibilityTags } from './visibility-tags';

/**
 * Komponenta viditelnosti. Čisté funkce bydlí vedle ve `visibility-tags.ts`
 * a jsou odtud reexportované, aby se vykreslovačům bloků nezměnila cesta
 * importu. Důvod dělení je popsaný tam.
 *
 * Jméno `visibility-tags` je schválně JINÉ, ne `visibility.ts`. Kdyby se ten
 * čistý soubor jmenoval stejně, přebil by při rozřešení `./visibility` tenhle
 * `.tsx` (přípona `.ts` se zkouší dřív) a komponenta `Visible` by z té cesty
 * zmizela. Vyzkoušeno omylem: 95 testů emitteru spadlo naráz.
 */
export { presenceKey, visibilityTags } from './visibility-tags';

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
