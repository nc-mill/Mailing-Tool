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
};

/** Vlastnost, kterou nese každá komponenta emitteru. */
export type EmitterProps = {
  emitter: EmitterState;
};
