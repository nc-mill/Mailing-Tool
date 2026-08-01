'use client';

import { useEffect, useRef } from 'react';

/**
 * Živě se měnící číslo se do `aria-live` propíše až po ustálení
 * a jen jednou (kritérium 9). Jinak čtečka mluví při každém stisku klávesy.
 */
export function useDebouncedAnnouncement(
  value: string,
  announce: (value: string) => void,
  delayMs = 500,
): void {
  const initial = useRef(true);

  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      return;
    }
    const timer = setTimeout(() => announce(value), delayMs);
    return () => clearTimeout(timer);
  }, [announce, delayMs, value]);
}
