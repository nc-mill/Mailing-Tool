import type { CampaignLinkRow } from '../repo/messages.repo';
import { selectCampaignLinksByLinkId } from '../repo/messages.repo';
import { TtlLru } from './lru';

export type LinkCacheOptions = {
  capacity: number;
  ttlMs: number;
  /** Vrátí všechny odkazy kampaně, do které patří zadané link_id. */
  load?: (workspaceId: string, linkId: string) => Promise<CampaignLinkRow[]>;
};

/**
 * Cache campaign_links. Klíčem je link_id, ale plní se po celých kampaních:
 * kdo klikl na jeden odkaz v mailu, klikne pravděpodobně i na další.
 * Pozice odkazu je součástí položky, protože se sleduje, na který odkaz
 * v mailu se kliklo, a po překompilování šablony už by se nedohledala.
 */
export class LinkCache {
  readonly #lru: TtlLru<string, CampaignLinkRow | null>;
  readonly #load: (workspaceId: string, linkId: string) => Promise<CampaignLinkRow[]>;

  constructor(options: LinkCacheOptions) {
    this.#lru = new TtlLru({ capacity: options.capacity, ttlMs: options.ttlMs });
    this.#load =
      options.load ??
      ((workspaceId, linkId) => selectCampaignLinksByLinkId({ workspaceId, linkId }));
  }

  /**
   * Klíčem cache je dvojice projekt a odkaz, ne samotný odkaz.
   *
   * Cache je společná pro celý proces a `campaign_links.id` je UUID, takže
   * bez projektu v klíči by odkaz nahraný jedním projektem obsloužil klik
   * s tokenem jiného projektu. Token sice `link_id` podepisuje, ale podepisuje
   * i `workspace_id`, a shodnout se musí obojí. Zároveň je to workspace,
   * který dotazu dodá RLS kontext.
   */
  async get(workspaceId: string, linkId: string): Promise<CampaignLinkRow | null> {
    const key = `${workspaceId}:${linkId}`;
    const cached = this.#lru.get(key);
    if (cached !== undefined) return cached;

    return this.#lru.getOrLoad(key, async () => {
      const rows = await this.#load(workspaceId, linkId);
      this.#lru.setMany(rows.map((row) => [`${workspaceId}:${row.id}`, row] as const));
      return rows.find((row) => row.id === linkId) ?? null;
    });
  }
}
