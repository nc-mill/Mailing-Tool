'use client';

import { createContext, useContext } from 'react';
import type { PageSurface } from '../../model/page-surface';

/**
 * Povrch, pro který se právě navrhuje veřejná stránka.
 *
 * PROČ KONTEXT, A NE PROPA. Platí tu totéž co u profilu šablony
 * (`template-profile.tsx`): nabídka personalizace visí na liště nad blokem
 * a prokousává se k ní přes `Canvas`, `inline-rich-text` a `toolbar`, tedy přes
 * tři obaly, kterých se povrch vůbec netýká. Do skořápky editoru se dostává
 * propou `pageSurface`, odtud dolů kontextem.
 *
 * VÝCHOZÍ HODNOTA JE `null`, ne některý povrch. Znamená „volající povrch
 * neurčil" a čte se jinak podle profilu: u e-mailu (`campaign`, `transactional`)
 * je to normální stav a povrch nikoho nezajímá, kdežto u profilu `page` je to
 * chybějící zapojení a bere se za něj nejužší povrch (`DEFAULT_PAGE_SURFACE`),
 * aby se vada projevila v editoru, a ne až prázdným místem u návštěvníka.
 */
const PageSurfaceContext = createContext<PageSurface | null>(null);

export const PageSurfaceProvider = PageSurfaceContext.Provider;

export function usePageSurface(): PageSurface | null {
  return useContext(PageSurfaceContext);
}
