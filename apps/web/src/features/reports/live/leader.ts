export type LeaderHandle = {
  isLeader: boolean;
  broadcast: (data: unknown) => void;
  onMessage: (handler: (data: unknown) => void) => void;
  /** Vůdce skončil. Následovník si musí otevřít vlastní spojení. */
  onLeaderGone: (handler: () => void) => void;
  release: () => void;
};

type ChannelLike = {
  postMessage: (data: unknown) => void;
  addEventListener: (type: 'message', handler: (event: { data: unknown }) => void) => void;
  close: () => void;
};

/** Testovací dvojník BroadcastChannel. Sdílená sběrnice je obyčejná mapa. */
export class FakeChannel implements ChannelLike {
  private handlers: Array<(event: { data: unknown }) => void> = [];

  constructor(
    private readonly name: string,
    private readonly bus: Map<string, FakeChannel[]>,
  ) {
    this.bus.set(name, [...(bus.get(name) ?? []), this]);
  }

  postMessage(data: unknown): void {
    for (const peer of this.bus.get(this.name) ?? []) {
      if (peer !== this) for (const handler of peer.handlers) handler({ data });
    }
  }

  addEventListener(_type: 'message', handler: (event: { data: unknown }) => void): void {
    this.handlers.push(handler);
  }

  close(): void {
    this.bus.set(
      this.name,
      (this.bus.get(this.name) ?? []).filter((peer) => peer !== this),
    );
  }
}

const CLAIM_WINDOW_MS = 150;

/**
 * Volba vůdce mezi kartami. Spojení drží jedna karta a ostatním výsledek
 * přeposílá, takže deset otevřených karet znamená jedno spojení, ne deset.
 *
 * Když BroadcastChannel není k dispozici, karta se prostě chová jako vůdce
 * a otevře si vlastní spojení. Nic se nerozbije, jen se ušetří míň.
 */
export async function electLeader(
  channelName: string,
  factory: (name: string) => ChannelLike | null = defaultFactory,
): Promise<LeaderHandle> {
  const channel = factory(`mlain-stats-${channelName}`);
  if (!channel) {
    return {
      isLeader: true,
      broadcast: () => {},
      onMessage: () => {},
      onLeaderGone: () => {},
      release: () => {},
    };
  }

  const handlers: Array<(data: unknown) => void> = [];
  const goneHandlers: Array<() => void> = [];
  let leaderSeen = false;
  let amLeader = false;

  channel.addEventListener('message', (event) => {
    const payload = event.data as { kind?: string; data?: unknown };
    // OPRAVA PROTI PLÁNU: vůdce MUSÍ odpovědět na každý pozdější nárok.
    // V plánu se `{ kind: 'leader' }` posílalo jen jednou, při volbě. Druhá
    // karta otevřená o minutu později tedy nikoho neslyšela a prohlásila se
    // vůdcem taky, takže by si obě otevřely vlastní spojení a kritérium 95
    // („nad HTTP/2 nejvýš jedno spojení na prohlížeč") by neplatilo.
    // Ověřeno testem, který na původním znění padal.
    if (payload?.kind === 'claim' && amLeader) channel.postMessage({ kind: 'leader' });
    if (payload?.kind === 'leader') leaderSeen = true;
    if (payload?.kind === 'resign') for (const handler of goneHandlers) handler();
    if (payload?.kind === 'data') for (const handler of handlers) handler(payload.data);
  });

  channel.postMessage({ kind: 'claim' });
  await new Promise((resolve) => setTimeout(resolve, CLAIM_WINDOW_MS));

  const isLeader = !leaderSeen;
  amLeader = isLeader;
  if (isLeader) channel.postMessage({ kind: 'leader' });

  return {
    isLeader,
    broadcast: (data) => channel.postMessage({ kind: 'data', data }),
    onMessage: (handler) => handlers.push(handler),
    onLeaderGone: (handler) => goneHandlers.push(handler),
    release: () => {
      // Zavření karty vůdce nesmí zbytek karet umlčet. Rezignace je ta
      // levná varianta; kdyby se zpráva ztratila, následovník se stejně
      // probere po hlídacím intervalu v `use-live-stats.ts`.
      if (amLeader) channel.postMessage({ kind: 'resign' });
      amLeader = false;
      channel.close();
    },
  };
}

function defaultFactory(name: string): ChannelLike | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  return new BroadcastChannel(name) as unknown as ChannelLike;
}
