'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  createToastStore,
  type ToastInput,
  type UndoableInput,
  type VisibleToast,
} from './toast-store';
import { ToastItem, type ToastLabels } from './toast-item';

type ToastApi = {
  info: (message: string, description?: string) => void;
  success: (message: string, description?: string) => void;
  /** Chyba se nikdy nezavře sama a nikdy nenese jedinou kopii informace. */
  error: (message: string, description?: string) => void;
  undoable: (input: UndoableInput) => void;
  raw: (input: ToastInput) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({
  children,
  labels,
}: {
  children: React.ReactNode;
  labels: ToastLabels;
}) {
  const storeRef = useRef<ReturnType<typeof createToastStore> | null>(null);
  if (storeRef.current === null) storeRef.current = createToastStore();
  const store = storeRef.current;

  useEffect(() => () => store.destroy(), [store]);

  const state = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getState(),
    () => store.getState(),
  );

  // Klávesnice: Esc zavře nejnovější, Alt + Z vrátí poslední vratnou akci.
  // Bez toho je „Vrátit zpět" funkce jen pro myš.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        store.dismissLatest();
        return;
      }
      if (event.altKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        store.undoLatest();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [store]);

  const api = useMemo<ToastApi>(
    () => ({
      info: (message, description) => store.push({ tone: 'info', message, description }),
      success: (message, description) => store.push({ tone: 'success', message, description }),
      error: (message, description) => store.push({ tone: 'error', message, description }),
      undoable: (input) => store.pushUndoable(input),
      raw: (input) => store.push(input),
    }),
    [store],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Kontejner je v DOM před prvním oznámením, jinak se hlášení
          čtečce neodešle (pravidlo 5.10). Levý dolní roh, ne pravý horní. */}
      <div
        aria-label={labels.notifications}
        className="pointer-events-none fixed bottom-20 left-4 z-[var(--z-toast)] flex flex-col-reverse gap-2"
      >
        {state.visible.map((toast: VisibleToast) => (
          <ToastItem
            key={toast.id}
            {...toast}
            labels={labels}
            onUndo={() => store.undoLatest()}
            onClose={() => store.dismiss(toast.id)}
            onPause={() => store.pause(toast.id)}
            onResume={() => store.resume(toast.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast se smí volat jen uvnitř ToastProvider.');
  return api;
}
