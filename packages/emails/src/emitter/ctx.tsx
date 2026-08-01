import { createContext, useContext } from 'react';
import type { AssetRef } from '../compile/types';
import type { RawSlotSink } from '../normalize/slots';
import type { ResolvedTheme } from '../theme/resolve';

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

const EmitterContext = createContext<EmitterState | null>(null);

export const EmitterProvider = EmitterContext.Provider;

export function useEmitter(): EmitterState {
  const value = useContext(EmitterContext);
  if (!value) throw new Error('Emitter components must be rendered inside EmitterProvider.');
  return value;
}
