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
export function useExtractionPoll(
  extractionId: string | null,
  /**
   * Projekt, pod kterým se dotaz posílá.
   *
   * POVINNÝ, i když má výchozí hodnotu jen kvůli starším voláním v testech.
   * Autentizační middleware bere projekt z hlavičky `X-Workspace-Id`, protože
   * `/api/v1/**` žádný slug v cestě nemá. Bez ní se dotaz k obsluze nedostane
   * a vrátí 404 s `workspace_id: null` v logu.
   *
   * NAMĚŘENO 4. 8. 2026: založení běhu odpovědělo 202, běh v databázi doběhl do
   * stavu `succeeded` za čtyři sekundy, a obrazovka přesto po třiceti sekundách
   * napsala „Web neodpověděl včas", protože KAŽDÝ dotaz na stav vracel 404.
   * Chyběla tady jedna hlavička; POST ji posílal celou dobu.
   */
  workspaceId: string | null = null,
): {
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
          headers: {
            accept: 'application/json',
            ...(workspaceId === null ? {} : { 'X-Workspace-Id': workspaceId }),
          },
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
  }, [extractionId, workspaceId]);

  return { snapshot, elapsedMs, timedOut };
}
