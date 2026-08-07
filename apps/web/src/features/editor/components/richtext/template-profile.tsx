'use client';

import type { ValidationProfile } from '@mlain/emails/document/profile';
import { createContext, useContext } from 'react';

/**
 * Profil kontroly dokumentu tak, jak ho vidí nabídka personalizace.
 *
 * PROČ KONTEXT, A NE DALŠÍ PROPA. `templateKind` už skořápka editoru má a panel
 * vlastností ho dostává propou. Nabídka personalizace ale visí na liště nad
 * blokem, kam se prokousává přes `Canvas`, `inline-rich-text` a `toolbar`, tedy
 * přes tři obaly, kterých se to netýká. Katalog polí má z téhož důvodu kontext
 * hned vedle (`field-labels.tsx`).
 *
 * VÝCHOZÍ HODNOTA JE `campaign`, protože to je přísnější profil: kořen `data`
 * v něm povolený není (`rootsForTemplateKind`), takže nabídka bez poskytovatele
 * radši neukáže značku, kterou by validátor odmítl, než aby ji ukázala všude.
 */
const TemplateProfileContext = createContext<ValidationProfile>('campaign');

export const TemplateProfileProvider = TemplateProfileContext.Provider;

export function useTemplateProfile(): ValidationProfile {
  return useContext(TemplateProfileContext);
}
