'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * Optimistická aktualizace s tvrdými hranicemi z 5.6.
 *
 * Používej jen tam, kde akce téměř vždy uspěje, selhání je bez následků
 * a rozsah je malý a lokální. Nikdy u změny publika kampaně, u blokovaných
 * adres, u testovacího e-mailu a u čehokoliv třídy A5.
 */
export function useOptimisticAction<T>({
  initial,
  apply,
  commit,
  onError,
}: {
  initial: T;
  /** Čistá funkce, která vyrobí optimistický stav. */
  apply: (state: T) => T;
  commit: () => Promise<void>;
  onError?: (error: unknown) => void;
}) {
  const [state, setState] = useState<T>(initial);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  /** Přesná podoba stavu před akcí, včetně pozice ve výpisu a označení řádků. */
  const snapshot = useRef<T>(initial);

  const perform = useCallback(async () => {
    snapshot.current = state;
    setError(null);
    setIsPending(true);
    setState((current) => apply(current));
    try {
      await commit();
    } catch (caught) {
      // Návrat přesně do podoby před akcí, ne přepočet.
      setState(snapshot.current);
      setError(caught);
      onError?.(caught);
      // Žádný automatický druhý pokus. Opakuje se jen na pokyn uživatele.
    } finally {
      setIsPending(false);
    }
  }, [apply, commit, onError, state]);

  return {
    state,
    setState,
    isPending,
    error,
    run: perform,
    retry: perform,
  };
}
