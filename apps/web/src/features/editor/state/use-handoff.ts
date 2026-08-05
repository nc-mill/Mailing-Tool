'use client';

import { createContext, useContext } from 'react';

/**
 * Předání práce z editoru někam dál.
 *
 * Editor je od téhle chvíle KROK KAMPANĚ, ne samostatná obrazovka, na kterou se
 * odbočuje. Pruh nad hlavičkou (`chrome` ve `EditorShell`) proto potřebuje umět
 * dvě věci, které samy patří editoru: dopsat rozdělaný dokument a odejít na
 * jinou adresu tak, aby obsah v kampani odpovídal tomu, co má uživatel před
 * očima. Kdyby to dělal odchozí pruh sám, vznikla by druhá cesta k zápisu.
 *
 * Editor přitom o kampaních dál NIC NEVÍ. Dostane hotové uzly a půjčí jim tyhle
 * dvě funkce; co je na druhé straně odkazu, ho nezajímá.
 */
export type EditorHandoff = {
  /**
   * Dopsat, převzít, odejít. Uloží rozdělané změny, převezme obsah do kampaně
   * (když editor ví, do které) a teprve pak odejde na `href`. Neúspěch převzetí
   * odchod ZASTAVÍ a ohlásí ho na obrazovce; tichý odchod by v kampani nechal
   * starší obsah, než jaký uživatel vidí.
   */
  leave: (href: string) => void;
  /** Dopsat rozdělané změny a počkat, až jsou zapsané. Nikam neodchází. */
  flush: () => Promise<void>;
  /** Běží odchod nebo zápis? Tlačítka podle toho nespouštějí akci podruhé. */
  busy: boolean;
};

const HandoffContext = createContext<EditorHandoff | null>(null);

export const EditorHandoffProvider = HandoffContext.Provider;

/**
 * Vyhazuje mimo editor schválně. Pruh, který si myslí, že umí uložit obsah,
 * a přitom visí mimo editor, by tiše zahazoval práci; to se musí poznat hned
 * při vykreslení, ne až po prvním kliknutí.
 */
export function useEditorHandoff(): EditorHandoff {
  const value = useContext(HandoffContext);
  if (value === null) {
    throw new Error('useEditorHandoff se dá volat jen uvnitř EditorShell.');
  }
  return value;
}
