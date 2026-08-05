'use client';

import { sampleFor } from '@mlain/emails/preview-data';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ContactSummary, PreviewData } from '../../ports/types';

/**
 * Nastavení ZOBRAZENÍ editoru: zařízení, tmavý režim a to, čí data se dosazují.
 *
 * Je to JEDINÝ zdroj pravdy. Dřív žilo v odděleném náhledu (`preview-toolbar.tsx`
 * a `audience-picker.tsx`) a plátno o něm nevědělo, takže uživatel skládal e-mail
 * v jednom prostředí a kontroloval ho v jiném. Teď ovládání sedí v hlavičce
 * u stavu ukládání a čte ho jak plátno, tak závazný náhled ze serveru. Druhá
 * kopie stavu by znamenala, že „Mobil" v hlavičce a „Mobil" v náhledu ukazují
 * každý něco jiného.
 */
export type ViewMode = 'desktop' | 'mobile' | 'text' | 'source';

/** Zobrazení, ve kterých se needituje: kreslí je server, ne plátno. */
export function isReadOnlyMode(mode: ViewMode): boolean {
  return mode === 'text' || mode === 'source';
}

export type Audience =
  /** Značky se kreslí jako štítky s popiskem. Výchozí stav při psaní. */
  | { kind: 'tokens' }
  | { kind: 'sample'; variant: 'default' | 'no_name' }
  | { kind: 'contact'; contact: ContactSummary };

export type ViewValue = {
  mode: ViewMode;
  setMode: (mode: ViewMode) => void;
  dark: boolean;
  setDark: (dark: boolean) => void;
  audience: Audience;
  setAudience: (audience: Audience) => void;
  /** Tvar, který bere `POST /templates/{id}/preview`. */
  previewData: PreviewData;
  /**
   * Kořen hodnot pro dosazení do značek na plátně, nebo `null` pro štítky.
   * Skládá se ze `sampleFor` z `@mlain/emails`, tedy z TÝCHŽ vzorových dat,
   * jaká dosazuje server. Kdyby si je editor vymyslel vlastní, ukazoval by
   * náhled něco jiného než plátno.
   */
  values: Record<string, unknown> | null;
};

const ViewContext = createContext<ViewValue | null>(null);

/**
 * Bez poskytovatele se vrací neutrální zobrazení: počítač, světle, štítky.
 *
 * Není to tolerance k chybě, je to vlastnost. Plátno i jeho části se vykreslují
 * i mimo skořápku (jednotkové testy, panel vlastností), a spadlé plátno kvůli
 * chybějícímu nastavení zobrazení by byla horší vada než chybějící přepínač.
 */
const NEUTRAL: ViewValue = {
  mode: 'desktop',
  setMode: () => {},
  dark: false,
  setDark: () => {},
  audience: { kind: 'tokens' },
  setAudience: () => {},
  previewData: { type: 'sample', variant: 'default' },
  values: null,
};

export function useView(): ViewValue {
  return useContext(ViewContext) ?? NEUTRAL;
}

/** Vzorová data existují jen česky a anglicky, ostatní jazyky padají na angličtinu. */
function sampleLanguage(language: string): 'cs' | 'en' {
  return language.split('-')[0] === 'cs' ? 'cs' : 'en';
}

export function ViewProvider({ language, children }: { language: string; children: ReactNode }) {
  const [mode, setMode] = useState<ViewMode>('desktop');
  const [dark, setDark] = useState(false);
  const [audience, setAudience] = useState<Audience>({ kind: 'tokens' });

  /*
   * `previewData` a `values` mají VLASTNÍ `useMemo` na `audience`.
   *
   * Kdyby vznikaly uvnitř společného výpočtu, měly by po každém překreslení
   * novou identitu a náhled by šel na server znovu při každém cvaknutí tmavého
   * režimu nebo přepnutí zařízení. Přesně to hlídá test „přepnutí tmavého
   * režimu nevolá server znovu".
   */
  const previewData = useMemo<PreviewData>(
    () =>
      audience.kind === 'contact'
        ? { type: 'contact', contactId: audience.contact.id }
        : { type: 'sample', variant: audience.kind === 'sample' ? audience.variant : 'default' },
    [audience],
  );

  const values = useMemo<Record<string, unknown> | null>(() => {
    const lang = sampleLanguage(language);
    if (audience.kind === 'tokens') return null;
    if (audience.kind === 'sample') {
      return sampleFor(lang, audience.variant) as unknown as Record<string, unknown>;
    }
    return {
      ...(sampleFor(lang, 'default') as unknown as Record<string, unknown>),
      // Systémové adresy a údaje o kampani zůstávají vzorové: odhlašovací
      // odkaz se pro cizí kontakt kvůli náhledu nepodepisuje. Stejné
      // rozhodnutí jako v `contactPreviewData` na serveru.
      contact: audience.contact.values,
    };
  }, [audience, language]);

  const value = useMemo<ViewValue>(
    () => ({ mode, setMode, dark, setDark, audience, setAudience, previewData, values }),
    [audience, dark, mode, previewData, values],
  );

  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
}
