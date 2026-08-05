'use client';

import { createContext, useContext, useSyncExternalStore } from 'react';
import type { EditorState, EditorStore } from './editor-store';

const StoreContext = createContext<EditorStore | null>(null);

export const EditorStoreProvider = StoreContext.Provider;

export function useEditorStore(): EditorStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useEditorStore must be used inside EditorStoreProvider');
  return store;
}

export function useEditorState<T>(selector: (state: EditorState) => T): T {
  const store = useEditorStore();
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}

/** Odběr, který se nikdy neozve. Používá se, když provider chybí. */
const NEVER = (): (() => void) => () => {};

/**
 * Čtení stavu editoru TAM, KDE PROVIDER NEMUSÍ BÝT.
 *
 * `useEditorState` vyhodí výjimku mimo `EditorStoreProvider`, a to je správně
 * u panelů a plátna, které bez editoru nemají smysl. Ovládací prvky vlastností
 * ale mají druhý život: renderují se samostatně v testech (`controls.test.tsx`)
 * a `ColorControl` potřebuje motiv dokumentu jen k tomu, aby u role ukázal
 * skutečnou barvu. Bez motivu se dá vykreslit dál, jen s výchozí paletou.
 *
 * Padání by tady bylo horší než náhradní hodnota: chyba v klientské komponentě
 * neshodí ji, ale celý strom po nejbližší error boundary, takže by uživatel
 * místo panelu vlastností dostal „Aplikace se neočekávaně zastavila".
 */
export function useOptionalEditorState<T>(selector: (state: EditorState) => T, fallback: T): T {
  const store = useContext(StoreContext);
  const snapshot = (): T => (store === null ? fallback : selector(store.getState()));
  return useSyncExternalStore(store?.subscribe ?? NEVER, snapshot, snapshot);
}
