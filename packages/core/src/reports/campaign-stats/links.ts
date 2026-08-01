import { sql } from 'drizzle-orm';
import type { Tx, WorkspaceContext } from '../../tx';

export type CampaignLinkStat = {
  linkId: string;
  url: string;
  label: string | null;
  position: number;
  clicksTotal: number;
  clicksUnique: number;
  clicksHuman: number;
  share: number;
  /** Dva odkazy na tutéž adresu (obrázek a text pod ním) jsou dva řádky, ne chyba. */
  duplicateUrl: boolean;
};

const MAX_LINKS = 200;

export async function readCampaignLinks(
  tx: Tx,
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<CampaignLinkStat[]> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT l.id       AS link_id,
           l.url,
           l.label,
           l.position,
           coalesce(s.clicks_total, 0)  AS clicks_total,
           coalesce(s.clicks_unique, 0) AS clicks_unique,
           coalesce(s.clicks_human, 0)  AS clicks_human
      FROM campaign_links l
      LEFT JOIN campaign_link_stats s
             ON s.link_id = l.id
            AND s.campaign_id = l.campaign_id
            AND s.workspace_id = l.workspace_id
     WHERE l.workspace_id = ${ctx.workspaceId}
       AND l.campaign_id  = ${campaignId}
     ORDER BY coalesce(s.clicks_human, 0) DESC, l.position ASC
     LIMIT ${MAX_LINKS}
  `);

  const parsed = rows.map((row) => ({
    linkId: String(row['link_id']),
    url: String(row['url']),
    label: row['label'] === null || row['label'] === undefined ? null : String(row['label']),
    position: Number(row['position'] ?? 0),
    clicksTotal: Number(row['clicks_total'] ?? 0),
    clicksUnique: Number(row['clicks_unique'] ?? 0),
    clicksHuman: Number(row['clicks_human'] ?? 0),
  }));

  const totalHuman = parsed.reduce((sum, link) => sum + link.clicksHuman, 0);
  const urlCounts = new Map<string, number>();
  for (const link of parsed) urlCounts.set(link.url, (urlCounts.get(link.url) ?? 0) + 1);

  return parsed.map((link) => ({
    ...link,
    share: totalHuman > 0 ? link.clicksHuman / totalHuman : 0,
    duplicateUrl: (urlCounts.get(link.url) ?? 0) > 1,
  }));
}
