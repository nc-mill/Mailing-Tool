'use client';

import { useEffect } from 'react';
import { UNLOAD_GUARD_MS } from '../config';
import type { EditorStore } from '../state/editor-store';

/**
 * Kritérium 7 části 6: dialog při odchodu se ukáže jen tehdy, když je neuložená změna mladší
 * než dvě sekundy, tedy dokud ji autosave nestihl odeslat. Jinak se neukazuje nikdy,
 * protože varování u operace, která na odchodu nezávisí, naučí uživatele zavírat všechna varování.
 */
export function useUnloadGuard(store: EditorStore, now: () => number = Date.now) {
  useEffect(() => {
    let dirtySince: number | null = null;
    const stop = store.subscribe(() => {
      const state = store.getState();
      if (state.isDirty && dirtySince === null) dirtySince = now();
      if (!state.isDirty) dirtySince = null;
    });
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtySince !== null && now() - dirtySince < UNLOAD_GUARD_MS) event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      stop();
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [now, store]);
}
