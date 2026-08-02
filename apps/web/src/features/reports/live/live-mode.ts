export type LiveMode = 'sse' | 'polling';

/** Multiplexované protokoly, nad kterými limit šesti spojení v prohlížeči neplatí. */
const MULTIPLEXED = new Set(['h2', 'h3']);

/**
 * SSE se použije jen tam, kde je prokazatelně bezpečné. Nad HTTP/1.1 drží
 * prohlížeč nejvýš šest spojení na původ a trvale otevřený stream by je sežral:
 * uživatel se šesti kartami reportu by aplikaci zastavil úplně.
 *
 * Prázdná hodnota se vyhodnocuje jako "ne", tedy bezpečně směrem k dotazování.
 */
export function chooseLiveMode(nextHopProtocol: string | undefined): LiveMode {
  return MULTIPLEXED.has((nextHopProtocol ?? '').toLowerCase()) ? 'sse' : 'polling';
}

export function detectProtocol(): string | undefined {
  if (typeof performance === 'undefined') return undefined;
  const [navigation] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
  return navigation?.nextHopProtocol;
}

/** Intervaly z 3.13.2 části 5 a z 5.9 části 6. */
export function pollIntervalMs(status: string, options: { degraded?: boolean } = {}): number {
  if (options.degraded) return 15_000;
  return status === 'sending' || status === 'queueing' ? 3000 : 30_000;
}
