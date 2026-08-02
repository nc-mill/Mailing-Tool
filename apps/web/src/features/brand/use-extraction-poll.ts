'use client';

import { useEffect, useRef, useState } from 'react';

export const POLL_INTERVAL_MS = 1000;
export const SLOW_AFTER_MS = 10_000;
export const GIVE_UP_AFTER_MS = 30_000;

export type ExtractionSnapshot = {
  id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'blocked';
  error_code: string | null;
  brand_profile_id: string | null;
  result: { warnings?: string[] } | null;
};

/**
 * Rozhodnutí D4: průběh se nestreamuje, dotazuje se po sekundě. Žádná
 * obrazovka nesmí být závislá na živém spojení pro základní funkci, a stav
 * s uplynulým časem je všechno, co obrazovka 8.5.4 potřebuje.
 */
export function useExtractionPoll(extractionId: string | null): {
  snapshot: ExtractionSnapshot | null;
  elapsedMs: number;
  timedOut: boolean;
} {
  const [snapshot, setSnapshot] = useState<ExtractionSnapshot | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const startedAt = useRef<number>(Date.now());

  useEffect(() => {
    if (extractionId === null) return;
    startedAt.current = Date.now();
    setSnapshot(null);
    setTimedOut(false);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (cancelled) return;
      setElapsedMs(Date.now() - startedAt.current);
      try {
        const response = await fetch(`/api/v1/brand/extractions/${extractionId}`, {
          headers: { accept: 'application/json' },
        });
        if (response.ok) {
          const data = (await response.json()) as ExtractionSnapshot;
          if (cancelled) return;
          setSnapshot(data);
          if (data.status !== 'pending' && data.status !== 'running') return;
        }
      } catch {
        // Výpadek dotazu není chyba extrakce. Zkusíme to za sekundu znovu,
        // dokud nevyprší celkový rozpočet.
      }
      if (Date.now() - startedAt.current > GIVE_UP_AFTER_MS) {
        if (!cancelled) setTimedOut(true);
        return;
      }
      timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [extractionId]);

  return { snapshot, elapsedMs, timedOut };
}
