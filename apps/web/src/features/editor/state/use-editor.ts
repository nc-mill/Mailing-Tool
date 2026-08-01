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
