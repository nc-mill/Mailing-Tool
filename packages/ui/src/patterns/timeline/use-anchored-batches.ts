'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * Načítání po dávkách bez skoku scrollu.
 *
 * Když se starší dávka připojí pod stávající obsah, výška kontejneru vzroste.
 * Prohlížeč sám o sobě scroll neposune, ale u os, které rostou nahoru,
 * i u návratu z kotvy to poskočí. Držíme si proto výšku před připojením
 * a po vykreslení scroll dorovnáme.
 */
export function useAnchoredBatches({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
}) {
  const previousHeight = useRef<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const beforeLoad = useCallback(() => {
    previousHeight.current = containerRef.current?.scrollHeight ?? null;
    setIsLoading(true);
  }, [containerRef]);

  const afterLoad = useCallback(() => {
    setIsLoading(false);
  }, []);

  useLayoutEffect(() => {
    if (isLoading || previousHeight.current === null) return;
    const container = containerRef.current;
    if (!container) return;
    const delta = container.scrollHeight - previousHeight.current;
    if (delta > 0 && container.scrollTop > 0) {
      container.scrollTop += delta;
    }
    previousHeight.current = null;
  }, [containerRef, isLoading]);

  return { beforeLoad, afterLoad, isLoading };
}
