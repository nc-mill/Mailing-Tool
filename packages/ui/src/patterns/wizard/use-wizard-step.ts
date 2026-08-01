'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Krok průvodce **patří do URL** (tvrdý požadavek K3). Bez toho nejde
 * poslat kolegovi odkaz na konkrétní krok a tlačítko zpět v prohlížeči
 * vyskočí z celého průvodce místo o krok zpět.
 *
 * Hook si vystačí s History API a událostí `popstate`, takže `packages/ui`
 * nezávisí na routeru Nextu a jde použít i mimo něj. Next od verze 14.1
 * nativní `pushState` do svého stavu sám promítá, takže se s ním nepere.
 */
export function useWizardStep({
  steps,
  param = 'step',
  defaultStepId,
}: {
  steps: readonly { id: string }[];
  param?: string;
  defaultStepId?: string;
}) {
  const fallback = defaultStepId ?? steps[0]?.id ?? '';

  const read = useCallback(() => {
    if (typeof window === 'undefined') return fallback;
    const value = new URLSearchParams(window.location.search).get(param);
    // Neznámý krok z ručně upravené adresy nesmí vyrobit prázdnou obrazovku.
    return value !== null && steps.some((step) => step.id === value) ? value : fallback;
  }, [fallback, param, steps]);

  const [current, setCurrent] = useState(read);

  useEffect(() => {
    const onPopState = () => setCurrent(read());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [read]);

  const goToStep = useCallback(
    (stepId: string, options: { replace?: boolean } = {}) => {
      if (!steps.some((step) => step.id === stepId)) return;
      // Ostatní parametry v adrese zůstávají, průvodce vlastní jen svůj.
      const url = new URL(window.location.href);
      url.searchParams.set(param, stepId);
      window.history[options.replace === true ? 'replaceState' : 'pushState']({}, '', url);
      setCurrent(stepId);
    },
    [param, steps],
  );

  // Když krok v adrese nebyl, dopíše se hned, aby byl odkaz sdílitelný
  // od první vteřiny. Nahrazením, aby to nezaložilo položku historie.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get(param) === null) {
      goToStep(fallback, { replace: true });
    }
  }, [fallback, goToStep, param]);

  return { current, goToStep };
}
