'use client';

import type { ThemeColorRole } from '@mlain/emails/document/types';
import { resolveTheme, type ResolvedTheme } from '@mlain/emails/theme/resolve';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { PREVIEW_WIDTHS } from '../../../config';
import type { Theme } from '../../../model/document-types';
import type { AssetSummary, EditorPorts } from '../../../ports/types';

/**
 * Kontext plátna: rozřešený motiv a knihovna obrázků.
 *
 * `resolveTheme` je TÁŽ funkce, kterou volá emitter při skládání e-mailu
 * (`packages/emails/src/theme/resolve.ts`). Plátno tím počítá barvy, velikosti
 * nadpisů, písma a šířku obsahu stejným kódem jako odeslaný e-mail, takže se
 * nemůžou rozejít. Je to čistá funkce bez závislosti na Node, ověřeno čtením.
 *
 * Druhá kopie téhle matematiky v editoru by byla přesně ten druh duplikace,
 * který se tiše rozjede: plátno by rok kreslilo starou paletu a nikdo by si
 * nevšiml, protože závazný náhled by byl pořád správně.
 */
export type CanvasContextValue = {
  theme: ResolvedTheme;
  /**
   * Mobilní zobrazení. Plátno v něm kreslí TATÁŽ pravidla, jaká emitter posílá
   * v `@media only screen and (max-width: contentWidth)` (`buildHeadCss`):
   * sloupce pod sebe, odsazení `theme.mobile.pad`, mobilní velikosti nadpisů,
   * tlačítko přes celou šířku, bloky s `hideOnMobile` pryč.
   */
  mobile: boolean;
  /** Šířka plochy, ve které e-mail leží: 375 px na mobilu, `contentWidth` jinak. */
  viewport: number;
  /**
   * Tmavý režim je ZAPNUTÝ A MOTIV HO PODPORUJE (`darkMode.strategy === 'auto'`).
   * Když motiv tmavý režim nemá, e-mailový klient barvy nepřebije a plátno
   * je nesmí přebít taky, jinak by slibovalo něco, co příjemce neuvidí.
   */
  darkActive: boolean;
  /**
   * Barva podle pravidel tmavého režimu z `buildHeadCss`.
   *
   * V e-mailu tmavý režim NEPŘEBARVUJE všechno: jsou to čtyři pravidla nad
   * třídami `.ml-canvas`, `.ml-content`, `.ml-text`, `.ml-muted` a `.ml-link`,
   * a ta přebijí i vlastní barvu zvolenou v panelu, protože nesou `!important`.
   * Barva tlačítka nebo oddělovače naopak zůstane. Plátno se drží téhož: kde
   * emitter třídu nedává, tam se nic nepřebarvuje.
   */
  darkOverride: (role: ThemeColorRole, light: string) => string;
  /**
   * Hodnoty pro dosazení do značek („Zobrazit jako"), nebo `null` pro štítky.
   * Do e-mailu jde dál `{{ … }}`, tohle je jen zobrazení na plátně.
   */
  values: Record<string, unknown> | null;
  /** Obrázky z knihovny podle id, kvůli vykreslení skutečného obrázku na plátně. */
  assets: Record<string, AssetSummary>;
  /** Otevře výběr obrázku pro daný blok. Nastavuje ho skořápka plátna. */
  pickAsset: ((blockId: string, key: string) => void) | null;
  /**
   * Doplní obrázek do mapy bez nového dotazu na server.
   *
   * Bez toho by čerstvě nahraný soubor na plátně chyběl: mapa se načte jednou
   * při otevření editoru a nahrání do ní nový záznam samo nepřidá. Uživatel
   * obrázek nahrál, dokument se v pořádku uložil, ale plátno mu hlásilo
   * „Tenhle obrázek už v knihovně není."
   */
  addAsset: (asset: AssetSummary) => void;
};

/**
 * Šířka plochy v mobilním zobrazení. Tatáž hodnota, jakou pro rám náhledu
 * používá `PREVIEW_WIDTHS.mobile`, aby plátno a náhled ukazovaly týž e-mail
 * ve stejně široké ploše.
 */
const MOBILE_VIEWPORT = PREVIEW_WIDTHS.mobile;

const CanvasContext = createContext<CanvasContextValue | null>(null);

export function useCanvas(): CanvasContextValue {
  const value = useContext(CanvasContext);
  if (!value) throw new Error('CanvasProvider chybí');
  return value;
}

/**
 * Hodnoty pro dosazení do značek, i mimo plátno.
 *
 * Štítek personalizace se kreslí na dvou místech: na plátně (`RichView`) a
 * v poli bohatého textu, které Tiptap montuje i v panelu vlastností. Druhé
 * z nich stojí mimo `CanvasProvider`, takže `useCanvas()` by tam vyhodilo
 * výjimku a shodilo celý panel. Proto vlastní hook, který mimo plátno vrací
 * `null` a značka se nakreslí jako popisek pole.
 */
export function useCanvasValues(): Record<string, unknown> | null {
  return useContext(CanvasContext)?.values ?? null;
}

/**
 * `addAsset`, které smí zavolat i ovládání STOJÍCÍ MIMO plátno.
 *
 * Panel vlastností se montuje vedle `CanvasProvider`, takže `useCanvas()` by
 * v něm vyhodil výjimku a shodil celý panel, stejně jako u `useCanvasValues`.
 * Mimo plátno se tedy nic nepřidává a vrací se prázdná funkce: mapa obrázků
 * patří plátnu a jinde není co aktualizovat.
 *
 * PROČ TO EXISTUJE: nahrání obrázku z panelu vlastností předávalo dál jen
 * `id`, kdežto výběr z plátna předává celý objekt a doplní ho do mapy. Panel
 * tedy uložil platné `id`, ale plátno ho ve své mapě nenašlo a na místě
 * obrázku napsalo „Tenhle obrázek už v knihovně není." Uživatel to četl jako
 * neúspěšné nahrání, přestože server vrátil 201 a soubor na disku byl.
 */
export function useAddAsset(): (asset: AssetSummary) => void {
  const add = useContext(CanvasContext)?.addAsset;
  return useCallback((asset: AssetSummary) => add?.(asset), [add]);
}

export function CanvasProvider({
  theme,
  ports,
  pickAsset,
  mobile = false,
  dark = false,
  values = null,
  children,
}: {
  theme: Theme;
  ports: EditorPorts | undefined;
  pickAsset: ((blockId: string, key: string) => void) | null;
  mobile?: boolean;
  dark?: boolean;
  values?: Record<string, unknown> | null;
  children: ReactNode;
}) {
  const resolved = useMemo(() => resolveTheme(theme), [theme]);
  const [assets, setAssets] = useState<Record<string, AssetSummary>>({});

  // Knihovna se načte jednou. Plátno potřebuje jen adresy, ne stránkování:
  // dokument smí odkazovat na obrázky, které v prvních padesáti nejsou, a pak
  // se místo obrázku ukáže zástupný rám. Lepší než blokovat vykreslení plátna.
  useEffect(() => {
    if (!ports) return;
    let active = true;
    void ports
      .listAssets()
      .then((list) => {
        if (!active) return;
        setAssets(Object.fromEntries(list.map((asset) => [asset.id, asset])));
      })
      .catch(() => {
        /* bez knihovny se kreslí zástupný rám, plátno funguje dál */
      });
    return () => {
      active = false;
    };
  }, [ports]);

  const addAsset = useCallback((asset: AssetSummary) => {
    setAssets((current) => ({ ...current, [asset.id]: asset }));
  }, []);

  const value = useMemo<CanvasContextValue>(() => {
    const darkActive = dark && resolved.darkModeEnabled;
    return {
      theme: resolved,
      assets,
      pickAsset,
      addAsset,
      mobile,
      viewport: mobile ? MOBILE_VIEWPORT : resolved.contentWidth,
      darkActive,
      darkOverride: (role, light) => (darkActive ? resolved.dark.roles[role] : light),
      values,
    };
  }, [addAsset, assets, dark, mobile, pickAsset, resolved, values]);

  return <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>;
}
