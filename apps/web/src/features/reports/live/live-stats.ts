import type { FetchResult } from '../api-client';
import type { LiveMode } from './live-mode';

export type LiveSnapshot = { version: number; status: string } & Record<string, unknown>;

export type LiveState = {
  mode: LiveMode;
  attempts: number;
  degraded: boolean;
  connection: 'connected' | 'reconnecting' | 'disconnected';
  lastError: boolean;
};

export type MachineOptions = {
  mode: LiveMode;
  fetchSnapshot: (etag: string | null) => Promise<FetchResult<LiveSnapshot>>;
  openStream?: () => void;
};

/** Po třech neúspěších se na SSE do konce života stránky rezignuje. */
const MAX_STREAM_ATTEMPTS = 3;

/**
 * Stavový automat živých aktualizací. Je schválně mimo React, aby se dal
 * otestovat bez prohlížeče a bez jsdom.
 *
 * Pravidlo, které řídí celý návrh: obrazovka nesmí být závislá na spojení.
 * Když selže SSE i dotazování, čísla z prvního načtení zůstanou na obrazovce
 * a uživatel má tlačítko Obnovit.
 */
export class LiveStatsMachine {
  private subscribers: Array<(snapshot: LiveSnapshot) => void> = [];
  private etag: string | null = null;

  state: LiveState;

  constructor(private readonly options: MachineOptions) {
    this.state = {
      mode: options.mode,
      attempts: 0,
      degraded: false,
      connection: 'connected',
      lastError: false,
    };
  }

  subscribe(handler: (snapshot: LiveSnapshot) => void): () => void {
    this.subscribers.push(handler);
    return () => {
      this.subscribers = this.subscribers.filter((item) => item !== handler);
    };
  }

  onStreamError(): void {
    if (this.state.mode !== 'sse') return;
    this.state.attempts += 1;
    if (this.state.attempts >= MAX_STREAM_ATTEMPTS) {
      this.state.mode = 'polling';
      this.state.degraded = true;
      this.state.connection = 'connected';
      return;
    }
    this.state.connection = 'reconnecting';
  }

  onStreamMessage(snapshot: LiveSnapshot): void {
    this.state.connection = 'connected';
    this.state.lastError = false;
    this.emit(snapshot);
  }

  async pollOnce(): Promise<void> {
    try {
      const result = await this.options.fetchSnapshot(this.etag);
      this.state.connection = 'connected';
      this.state.lastError = false;
      if (result.status === 'not_modified') return;
      this.etag = result.etag;
      this.emit(result.data);
    } catch {
      this.state.connection = 'disconnected';
      this.state.lastError = true;
    }
  }

  private emit(snapshot: LiveSnapshot): void {
    for (const handler of this.subscribers) handler(snapshot);
  }
}
