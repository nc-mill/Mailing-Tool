import type { AssetRef } from '../compile/types';
import type { RawSlotSink } from '../normalize/slots';
import type { ResolvedTheme } from '../theme/resolve';

/**
 * Stav skládání e-mailu. Prochází stromem jako obyčejná vlastnost `emitter`,
 * ne React kontextem: emitter je serverový šablonovací nástroj a `createContext`
 * je v Nextu klientské API, takže by ho serverová trasa nesměla vtáhnout.
 * Explicitní vlastnost navíc nemůže propadnout mezi souběžnými rendery,
 * což by u modulového zásobníku hrozilo (`render` z react-emailu je proudový
 * a strom se skládá až v pozdější úloze smyčky událostí).
 */
export type EmitterState = {
  theme: ResolvedTheme;
  raw: RawSlotSink;
  assets: Record<string, AssetRef>;
  assetBaseUrl: string;
  language: string;
  skippedBlockIds: Set<string>;
  trackClicks: boolean;
  /** Značka odkazu podle kontraktu 5, doplní ji collectLinks při normalizaci odkazů. */
  linkHref: (href: string, trackable: boolean) => string;
  /** Popisky dodávané produktem podle jazyka (patička, oddělovače). */
  t: (key: string) => string;
  /**
   * Nabízí projekt veřejné centrum předvoleb? `false` vyřadí odkaz „Nastavit předvolby"
   * z patičky. Je to nastavení PROJEKTU, ne šablony; šablona má vlastní přepínač
   * `showPreferences` a platí přísnější z těch dvou. Podrobně v `compile/types.ts`.
   *
   * Vynechání znamená ZAPNUTO. Nepovinné je schválně: `EmitterState` si ručně skládá
   * půltucet testů bloků, kterých se patička netýká, a povinné pole by je rozbilo,
   * aniž by to o chování patičky cokoli vypovídalo.
   */
  preferenceCenterEnabled?: boolean | undefined;
};

/** Vlastnost, kterou nese každá komponenta emitteru. */
export type EmitterProps = {
  emitter: EmitterState;
};
