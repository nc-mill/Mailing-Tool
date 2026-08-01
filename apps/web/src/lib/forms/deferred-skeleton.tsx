'use client';

import type { ReactNode } from 'react';
import { useDelayedFlag } from '@mlain/ui/lib/use-delayed-flag';

/**
 * Kritérium 80 kapitoly 15.6 části 6: indikátor se nezobrazí u operace kratší
 * než 300 ms a jakmile se zobrazí, zůstane aspoň 400 ms. Logiku vlastní P05,
 * tohle je jen obal pro `loading.tsx` segmentů.
 */
export function DeferredSkeleton({ children }: { children: ReactNode }) {
  // Prodleva 300 ms a minimum 400 ms jsou modulové konstanty v P05,
  // ne parametry. Hook bere jediný argument.
  const visible = useDelayedFlag(true);
  return visible ? <>{children}</> : null;
}
