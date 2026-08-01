'use client';

import { useEffect, useRef } from 'react';

const THRESHOLDS = [25, 50, 75, 100] as const;

/**
 * Průběžné hodnoty se čtečce **neoznamují každou sekundu** (kritérium 8).
 * Oznamuje se při 25, 50, 75 a 100 procentech a při změně stavu.
 */
export function useProgressAnnouncer({
  done,
  total,
  announce,
  label,
}: {
  done: number;
  total: number;
  announce: (percent: number, label: string) => void;
  label: string;
}): void {
  const reached = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (total <= 0) return;
    const percent = Math.floor((done / total) * 100);
    for (const threshold of THRESHOLDS) {
      if (percent >= threshold && !reached.current.has(threshold)) {
        reached.current.add(threshold);
        announce(threshold, label);
      }
    }
  }, [announce, done, label, total]);
}
