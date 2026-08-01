import type { LoopOutcome } from './loop';

/**
 * Krok 3 ma podminku WHERE status = 'queueing'. Proto se kampan pozastavena BEHEM
 * materializace vraci resume do queueing, ne do sending: kdyby sla do sending,
 * zasahl by tenhle UPDATE nula radku a kampan by navzdy zustala s nulovym total_count,
 * tedy s nesmyslnym ukazatelem prubehu a nefunkcnim uzaviracim pravidlem.
 */
export function shouldRunFinish(outcome: LoopOutcome): boolean {
  return outcome === 'completed';
}

export function resumeTarget(
  phase: 'collecting' | 'materializing' | 'done',
): 'queueing' | 'sending' {
  return phase === 'done' ? 'sending' : 'queueing';
}
