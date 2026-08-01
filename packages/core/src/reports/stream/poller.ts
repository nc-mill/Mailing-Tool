import type { StatsCounts } from '../metrics/counts';
import { detectStaleVersion, statsFingerprint } from '../campaign-stats/fingerprint';

export type StatsSnapshot = {
  version: number;
  updatedAt: Date;
  counts: StatsCounts;
  status: string;
};

export type Subscriber = (snapshot: StatsSnapshot) => void;

export type PollerOptions = {
  intervalMs: number;
  load: (campaignId: string) => Promise<StatsSnapshot>;
  onStaleVersion?: (campaignId: string) => void;
};

type PollerState = {
  timer: ReturnType<typeof setInterval>;
  subscribers: Set<Subscriber>;
  last: StatsSnapshot | null;
  lastFingerprint: string | null;
};

/**
 * Jeden poller na kampaň, ne jeden na spojení. Sto otevřených streamů na
 * jednu kampaň tedy dělá jeden dotaz za interval. Poller se sám ukončí,
 * jakmile nemá odběratele.
 */
export class PollerRegistry {
  private readonly pollers = new Map<string, PollerState>();

  constructor(private readonly options: PollerOptions) {}

  get activeCampaigns(): number {
    return this.pollers.size;
  }

  subscribe(campaignId: string, subscriber: Subscriber): () => void {
    const state = this.pollers.get(campaignId) ?? this.start(campaignId);
    state.subscribers.add(subscriber);
    if (state.last) subscriber(state.last);

    return () => {
      state.subscribers.delete(subscriber);
      if (state.subscribers.size === 0) {
        clearInterval(state.timer);
        this.pollers.delete(campaignId);
      }
    };
  }

  private start(campaignId: string): PollerState {
    const state: PollerState = {
      subscribers: new Set(),
      last: null,
      lastFingerprint: null,
      timer: setInterval(() => void this.tick(campaignId), this.options.intervalMs),
    };
    this.pollers.set(campaignId, state);
    return state;
  }

  private async tick(campaignId: string): Promise<void> {
    const state = this.pollers.get(campaignId);
    if (!state) return;

    let snapshot: StatsSnapshot;
    try {
      snapshot = await this.options.load(campaignId);
    } catch {
      // Výpadek dotazu spojení nezabíjí. Klient dostane další zprávu, až se to povede.
      return;
    }

    if (state.last && detectStaleVersion(state.last, snapshot)) {
      this.options.onStaleVersion?.(campaignId);
    }

    const fingerprint = statsFingerprint(snapshot);
    state.last = snapshot;
    if (fingerprint === state.lastFingerprint) return;
    state.lastFingerprint = fingerprint;

    for (const subscriber of state.subscribers) subscriber(snapshot);
  }
}
