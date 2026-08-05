import { trackingLogger } from '../logging';
import { TtlLru } from '../click/lru';
import { selectAllowedOrigins, type AllowedOrigin } from '../repo/tracking-domains.repo';
import type { WorkspaceContext } from '../../tx';

export type { AllowedOrigin };

export type TrackingDomainCacheOptions = {
  /** Jak dlouho platí seznam domén jednoho projektu. */
  ttlMs: number;
  /** Kolik projektů se drží naráz. Položka je pár hostů, takže tisíc stačí. */
  capacity?: number;
  /** Načtení domén JEDNOHO projektu v jeho kontextu. Testy si sem dají svoje. */
  load?: (ctx: WorkspaceContext) => Promise<AllowedOrigin[]>;
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

/**
 * Shoda musí být na celý host nebo na hranici tečky. Prosté `endsWith` by
 * pustilo `zlyblog.example.cz` na pravidlo pro `blog.example.cz`, což je únik
 * identity na cizí web, tedy přesně to, čemu tahle kontrola brání.
 *
 * Jediná implementace pro obě cesty: příjem událostí `/e/**` ji volá nad
 * hlavičkou `Origin`, proklik `/t/c/` nad hostem uloženého odkazu. Dvě kopie
 * téhle podmínky by dřív nebo později začaly rozhodovat každá jinak.
 */
export function originMatches(allowed: readonly AllowedOrigin[], host: string): boolean {
  const target = normalizeHost(host);
  return allowed.some((entry) => {
    const allowedHost = normalizeHost(entry.host);
    if (allowedHost === target) return true;
    return entry.includeSubdomains && target.endsWith(`.${allowedHost}`);
  });
}

/**
 * Povolené domény po projektech, s TTL a single flight.
 *
 * DŘÍVE TO BYLA JEDNA GLOBÁLNÍ MAPA, kterou na časovači plnil dotaz přes celou
 * tabulku. Ten dotaz běžel bez kontextu projektu, takže ho politika
 * `ws_isolation` na `tracking_domains` odstřihla a vracel VŽDY NULA ŘÁDKŮ.
 * Chyba se nikde neprojevila: mapa byla prázdná, `isAllowed` vracelo `false`
 * a proklik z e-mailu tím pádem NIKDY nepřipojil `ml_token`. Návštěva webu se
 * proto nikdy nespojila s kontaktem a vypadalo to jen jako „nikdo neklikl".
 *
 * Teď se čte líně, pro jeden projekt, v jeho kontextu. Projekt je v obou
 * volajících cestách už ověřený (podepsaný token u prokliku, veřejný klíč
 * u příjmu), takže se `WorkspaceContext` vyžaduje v podpisu a cizí projekt
 * nejde podstrčit řetězcem.
 */
export class TrackingDomainCache {
  readonly #byWorkspace: TtlLru<string, AllowedOrigin[]>;
  readonly #load: (ctx: WorkspaceContext) => Promise<AllowedOrigin[]>;

  constructor(options: TrackingDomainCacheOptions) {
    this.#byWorkspace = new TtlLru({ capacity: options.capacity ?? 1_000, ttlMs: options.ttlMs });
    this.#load = options.load ?? selectAllowedOrigins;
  }

  async isAllowed(ctx: WorkspaceContext, host: string): Promise<boolean> {
    return originMatches(await this.#origins(ctx), host);
  }

  async #origins(ctx: WorkspaceContext): Promise<AllowedOrigin[]> {
    try {
      return await this.#byWorkspace.getOrLoad(ctx.workspaceId, () => this.#load(ctx));
    } catch (error) {
      // Selhání načtení nesmí shodit přesměrování. Bez seznamu se identita
      // NEPŘEDÁ, což je bezpečná strana chyby, a v logu je vidět proč.
      trackingLogger().warn({ err: error }, 'tracking_domain_cache_load_failed');
      return [];
    }
  }
}
