import { trackingLogger } from '../logging';
import { selectAllTrackingDomains, type TrackingDomainRow } from '../repo/tracking-domains.repo';

export type TrackingDomainCacheOptions = {
  refreshMs: number;
  load?: () => Promise<TrackingDomainRow[]>;
};

/** Malá písmena, bez schématu, bez portu, bez tečky na konci. */
export function normalizeHost(value: string): string {
  let host = value.trim().toLowerCase();
  const schemeEnd = host.indexOf('://');
  if (schemeEnd !== -1) host = host.slice(schemeEnd + 3);
  const pathStart = host.search(/[/?#]/);
  if (pathStart !== -1) host = host.slice(0, pathStart);
  const portStart = host.lastIndexOf(':');
  if (portStart > host.lastIndexOf(']')) host = host.slice(0, portStart);
  if (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

export function originHost(origin: string | undefined | null): string | null {
  if (origin === undefined || origin === null || origin === '' || origin === 'null') return null;
  const host = normalizeHost(origin);
  return host === '' ? null : host;
}

type Entry = { host: string; includeSubdomains: boolean };

export class TrackingDomainCache {
  #byWorkspace = new Map<string, Entry[]>();
  #timer: NodeJS.Timeout | null = null;
  readonly #options: TrackingDomainCacheOptions;

  constructor(options: TrackingDomainCacheOptions) {
    this.#options = options;
  }

  async refresh(): Promise<void> {
    const load = this.#options.load ?? selectAllTrackingDomains;
    try {
      const rows = await load();
      const next = new Map<string, Entry[]>();
      for (const row of rows) {
        const list = next.get(row.workspaceId) ?? [];
        list.push({ host: normalizeHost(row.host), includeSubdomains: row.includeSubdomains });
        next.set(row.workspaceId, list);
      }
      this.#byWorkspace = next;
    } catch (error) {
      // Selhání obnovy neshodí redirect, jen se použije poslední známý stav.
      trackingLogger().warn({ err: error }, 'tracking_domain_cache_refresh_failed');
    }
  }

  start(): void {
    if (this.#timer !== null) return;
    void this.refresh();
    this.#timer = setInterval(() => void this.refresh(), this.#options.refreshMs);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer === null) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  /**
   * Shoda musí být na celý host nebo na hranici tečky. Prosté endsWith by pustilo
   * `zlyblog.example.cz` na pravidlo pro `blog.example.cz`, což je únik identity
   * na cizí web, tedy přesně to, čemu tahle kontrola brání.
   */
  isAllowed(workspaceId: string, host: string): boolean {
    const entries = this.#byWorkspace.get(workspaceId);
    if (entries === undefined) return false;
    const target = normalizeHost(host);
    return entries.some((entry) => {
      if (entry.host === target) return true;
      return entry.includeSubdomains && target.endsWith(`.${entry.host}`);
    });
  }

  hasAnyDomain(workspaceId: string): boolean {
    return (this.#byWorkspace.get(workspaceId)?.length ?? 0) > 0;
  }
}
