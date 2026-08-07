'use client';

import {
  DEFAULT_SAMPLE_GREETING,
  sampleFor,
  type SampleGreetingSettings,
} from '@mlain/emails/preview-data';
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
  /**
   * VĚTA, KTEROU VYDÁ ZNAČKA `contact.greeting`, ať se zrovna dosazuje, nebo ne.
   *
   * Nález z provozu: „Když tam vložím Oslovení, tak vlastně nevím, jak vypadá.
   * Je tam v šabloně mailu napsáno jen ‚Oslovení'. Ale bude to vypadat jak?
   * Dobrý den Honzo? Nebo Krásný den Honzo?" U jména si výsledek domyslí každý,
   * u oslovení ne: je to hotová věta ze zdvořilostní formule a pátého pádu.
   *
   * Liší se od `values` ve dvou věcech, a obě jsou schválně:
   *
   * 1. Je vyplněná i v režimu „Značky", kde se na plátně kreslí štítky a `values`
   *    je `null`. Uživatel skládá e-mail právě v něm, takže právě tam potřebuje
   *    vědět, co značka vyrobí; kdyby na to musel přepnout zobrazení, byl by to
   *    tentýž problém o jeden klik dál.
   * 2. Nikdy se nevymýšlí. U konkrétního kontaktu je to jeho SKUTEČNÉ oslovení
   *    ze sloupce `contacts.greeting`, jinak vzorové z `sampleFor`, které skládá
   *    `buildGreeting`, tedy tentýž kód, jaký větu složí při odeslání.
   */
  greetingExample: string | null;
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
  // Mimo poskytovatele není známý jazyk dokumentu, a příklad oslovení v cizím
  // jazyce by lhal víc, než kdyby nebyl vůbec. Rozhraní ho v tom případě vynechá.
  greetingExample: null,
};

export function useView(): ViewValue {
  return useContext(ViewContext) ?? NEUTRAL;
}

/** Vzorová data existují jen česky a anglicky, ostatní jazyky padají na angličtinu. */
function sampleLanguage(language: string): 'cs' | 'en' {
  return language.split('-')[0] === 'cs' ? 'cs' : 'en';
}

/**
 * NASTAVENÍ OSLOVENÍ PATŘÍ PROJEKTU, ne dokumentu, takže se do editoru musí
 * přinést zvenčí.
 *
 * Bez něj skládal editor vzorovou větu pořád podle vykání a křestního jména
 * (výchozí hodnoty nového projektu), takže plátno v projektu s tykáním
 * slibovalo „Dobrý den, Jano" u e-mailu, který odejde s „Ahoj Jano". Chybějící
 * hodnota se proto nahrazuje TÝMIŽ výchozími hodnotami, jaké má nový projekt:
 * je to pravda všude, kde si je nikdo nezměnil, a nikde nevyrábí třetí znění.
 */
export function ViewProvider({
  language,
  greeting = DEFAULT_SAMPLE_GREETING,
  children,
}: {
  language: string;
  greeting?: SampleGreetingSettings | undefined;
  children: ReactNode;
}) {
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
      return sampleFor(lang, audience.variant, greeting) as unknown as Record<string, unknown>;
    }
    return {
      ...(sampleFor(lang, 'default', greeting) as unknown as Record<string, unknown>),
      // Systémové adresy a údaje o kampani zůstávají vzorové: odhlašovací
      // odkaz se pro cizí kontakt kvůli náhledu nepodepisuje. Stejné
      // rozhodnutí jako v `contactPreviewData` na serveru.
      contact: audience.contact.values,
    };
  }, [audience, greeting, language]);

  /*
   * Příklad oslovení se počítá i pro režim „Značky", ve kterém `values` zůstává
   * `null`. Bere se z TÉHOŽ místa, ze kterého by se dosadil: u konkrétního
   * kontaktu z jeho vlastních hodnot, jinak ze vzorových dat, která skládá
   * `buildGreeting`. Žádný natvrdo napsaný příklad, který by se rozešel.
   */
  const greetingExample = useMemo<string | null>(() => {
    const lang = sampleLanguage(language);
    const source =
      audience.kind === 'contact'
        ? audience.contact.values
        : sampleFor(lang, audience.kind === 'sample' ? audience.variant : 'default', greeting)
            .contact;
    const example = (source as Record<string, unknown>)['greeting'];
    return typeof example === 'string' && example !== '' ? example : null;
  }, [audience, greeting, language]);

  const value = useMemo<ViewValue>(
    () => ({
      mode,
      setMode,
      dark,
      setDark,
      audience,
      setAudience,
      previewData,
      values,
      greetingExample,
    }),
    [audience, dark, greetingExample, mode, previewData, values],
  );

  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
}
