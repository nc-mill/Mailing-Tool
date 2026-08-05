import { withWorkspace, type Tx, type WorkspaceContext } from '../../tx';
import { rawSql } from './raw-sql';

/**
 * Odkaz tak, jak ho vrátila kompilace. `trackable` a další pole z `CompileMeta`
 * tenhle typ neopisuje: do tabulky se zapisují čtyři sloupce a širší typ by
 * sváděl k tomu, aby se sem doplňovalo, co v databázi nemá kam.
 */
export type CompiledLink = { id: string; url: string; position: number; label?: string | null };

export type CampaignLinkRow = {
  id: string;
  url: string;
  position: number;
  label: string | null;
};

/**
 * `id` i `position` se přebírají z `CompileMeta` DOSLOVA. P13 žádné ID nepočítá,
 * protože kontrakt kompilace předepisuje UUIDv5 odvozené z `CompileMeta.links`
 * a druhá kopie téhož algoritmu by se za půl roku rozešla. Následek rozejití je
 * nejtišší možný: proklik by se spároval s neexistujícím odkazem a report kliků
 * by byl prázdný, aniž by cokoliv spadlo. Viz rozhodnutí D17.
 */
function assertLinks(links: readonly CompiledLink[]): void {
  for (const link of links) {
    if (!link.id) {
      throw new Error('Odkaz nemá id z CompileMeta. P13 ho nedopočítává, viz rozhodnutí D17.');
    }
    if (link.position < 1) {
      throw new Error(`Neplatná pozice ${link.position}: pozice odkazů začínají od 1, ne od 0.`);
    }
  }
}

/**
 * Nahrazení odkazů kampaně uvnitř UŽ OTEVŘENÉ transakce.
 *
 * Existuje kvůli kompilaci: `campaign_links` a `campaigns.compile_meta` jsou dvě
 * kopie téhož seznamu a musí se zapsat jedním commitem. Kdyby se uložila jen
 * jedna, sender by porovnával značky proti metadatům, která neodpovídají řádkům
 * v `campaign_links`.
 */
export async function replaceCampaignLinksTx(
  tx: Tx,
  workspaceId: string,
  campaignId: string,
  links: readonly CompiledLink[],
): Promise<void> {
  assertLinks(links);
  await tx.execute(
    rawSql(`DELETE FROM campaign_links WHERE campaign_id = $1 AND workspace_id = $2`, [
      campaignId,
      workspaceId,
    ]),
  );
  for (const link of links) {
    await tx.execute(
      rawSql(
        `INSERT INTO campaign_links (id, workspace_id, campaign_id, url, position, label)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [link.id, workspaceId, campaignId, link.url, link.position, link.label ?? null],
      ),
    );
  }
}

export async function replaceCampaignLinks(
  ctx: WorkspaceContext,
  campaignId: string,
  links: readonly CompiledLink[],
): Promise<void> {
  // Kontrola se dělá PŘED otevřením transakce, aby neplatný vstup nezahodil
  // odkazy, které v tabulce už jsou: `DELETE` by proběhl a `INSERT` spadl.
  assertLinks(links);
  await withWorkspace(ctx, (tx) => replaceCampaignLinksTx(tx, ctx.workspaceId, campaignId, links));
}

export async function listCampaignLinks(
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<CampaignLinkRow[]> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<CampaignLinkRow>(
      rawSql(
        `SELECT id, url, position, label FROM campaign_links
          WHERE campaign_id = $1 AND workspace_id = $2 ORDER BY position`,
        [campaignId, ctx.workspaceId],
      ),
    );
    return r.rows;
  });
}
