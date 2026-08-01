'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

type Announcer = {
  /** Nepřerušuje čtení. Pro potvrzení a průběh. */
  polite: (message: string) => void;
  /** Přeruší čtení. Vyhrazeno pro skutečné chyby. */
  assertive: (message: string) => void;
};

const LiveRegionContext = createContext<Announcer | null>(null);

/**
 * Oblasti musí být v DOM **před** vložením textu, jinak se hlášení
 * neodešle (pravidlo 5.10). Proto jsou obě prázdné od začátku.
 */
export function LiveRegionProvider({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');

  const api = useMemo<Announcer>(
    () => ({
      polite: (message) => setPolite(message),
      assertive: (message) => setAssertive(message),
    }),
    [],
  );

  return (
    <LiveRegionContext.Provider value={api}>
      {children}
      <div aria-label={label} className="sr-only">
        <div role="status" aria-live="polite" aria-atomic="true">
          {polite}
        </div>
        <div role="alert" aria-live="assertive" aria-atomic="true">
          {assertive}
        </div>
      </div>
    </LiveRegionContext.Provider>
  );
}

export function useAnnouncer(): Announcer {
  const api = useContext(LiveRegionContext);
  if (!api) throw new Error('useAnnouncer se smí volat jen uvnitř LiveRegionProvider.');
  return api;
}

/** Stabilní obsluha pro `useProgressAnnouncer`. */
export function useProgressAnnouncement(format: (percent: number, label: string) => string) {
  const { polite } = useAnnouncer();
  return useCallback(
    (percent: number, label: string) => polite(format(percent, label)),
    [format, polite],
  );
}
