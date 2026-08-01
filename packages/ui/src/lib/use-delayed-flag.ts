'use client';

import { useEffect, useRef, useState } from 'react';

const SHOW_AFTER_MS = 300;
const MIN_VISIBLE_MS = 400;

/**
 * Indikátor načítání se nezobrazí u operace kratší než 300 ms
 * a jakmile se zobrazí, zůstane aspoň 400 ms (pravidlo 14.4).
 */
export function useDelayedFlag(active: boolean): boolean {
  const [visible, setVisible] = useState(false);
  const shownAt = useRef<number | null>(null);

  useEffect(() => {
    if (active) {
      const timer = setTimeout(() => {
        shownAt.current = Date.now();
        setVisible(true);
      }, SHOW_AFTER_MS);
      return () => clearTimeout(timer);
    }

    if (shownAt.current === null) {
      setVisible(false);
      return;
    }

    const elapsed = Date.now() - shownAt.current;
    const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);
    const timer = setTimeout(() => {
      shownAt.current = null;
      setVisible(false);
    }, remaining);
    return () => clearTimeout(timer);
  }, [active]);

  return visible;
}
