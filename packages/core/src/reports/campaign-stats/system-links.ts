import { sql } from 'drizzle-orm';
import { SYSTEM_CLICK_SUBTYPE, SYSTEM_LINK_KINDS, type SystemLinkKind } from '../../tracking/types';
import type { Tx, WorkspaceContext } from '../../tx';

export type SystemLinkClicks = Record<SystemLinkKind, number>;

/**
 * Kolik lidí kliklo na systémový odkaz v patičce: odhlášení, předvolby,
 * webová verze.
 *
 * VZNIKLO ZE STÍŽNOSTI. Zadavatel klikl v doručeném e-mailu na „Nastavit
 * předvolby" a report ukazoval nulu. Klik se přitom měřil; neměl se jen kde
 * ukázat, protože do `campaign_stats.clicks_*` se systémový proklik ZÁMĚRNĚ
 * nezapočítává, aby odhlášení nenafukovalo míru prokliku. Údaj tedy existoval
 * a nikdo ho nevydával.
 *
 * DO MÍRY PROKLIKU TO NESMÍ VSTOUPIT ANI TEĎ. Je to samostatné číslo vedle
 * čísel kampaně, ne jejich součást. Kdo to spojí, rozbije srovnatelnost
 * míry prokliku s jakýmkoli jiným nástrojem na trhu.
 *
 * PROČ SE NEVOLÁ `readSystemLinkClicks` Z `@mlain/core/tracking`. Ta funkce si
 * otevírá VLASTNÍ transakci se systémovým aktérem (`withTrackingTx`), což je
 * správně pro příjem kliku na veřejné cestě, ale ne pro čtení v reportu: report
 * má transakci v kontextu projektu už otevřenou a druhá, systémová, by obešla
 * kontext volajícího a v testech domény by sáhla mimo vloženou transakci.
 * Pravidlo se přesto NEKOPÍRUJE: podtyp i výčet druhů se importují z
 * `tracking/types`, takže existuje jedno místo, kde se dá změnit.
 */
export async function readCampaignSystemLinkClicks(
  tx: Tx,
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<SystemLinkClicks> {
  const counts = Object.fromEntries(SYSTEM_LINK_KINDS.map((kind) => [kind, 0])) as SystemLinkClicks;

  /*
   * `count(DISTINCT message_id)`, tedy KOLIK PŘÍJEMCŮ, ne kolik načtení stránky.
   * Stejné pravidlo jako u `readSystemLinkClicks` v doméně měření: příjemce,
   * který si předvolby otevřel třikrát, je pořád jeden člověk.
   */
  const { rows } = await tx.execute<{ kind: string | null; count: string }>(sql`
    SELECT metadata ->> 'system_link' AS "kind",
           count(DISTINCT message_id) AS "count"
      FROM message_events
     WHERE workspace_id = ${ctx.workspaceId}::uuid
       AND campaign_id  = ${campaignId}::uuid
       AND type    = 'click'
       AND subtype = ${SYSTEM_CLICK_SUBTYPE}
     GROUP BY 1
  `);

  for (const row of rows) {
    if (row.kind !== null && row.kind in counts) {
      counts[row.kind as SystemLinkKind] = Number(row.count);
    }
  }
  return counts;
}
