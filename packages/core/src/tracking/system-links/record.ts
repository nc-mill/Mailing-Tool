import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { withWorkspace, type WorkspaceContext } from '../../tx';
import { trackingLogger } from '../logging';
import { withTrackingTx } from '../repo/tx';
import { SYSTEM_CLICK_SUBTYPE, type SystemLinkKind } from '../types';

/**
 * Zápis prokliku na SYSTÉMOVÝ odkaz z patičky jako události kampaně.
 *
 * PROČ TO EXISTUJE. Zadavatel prokazatelně klikl v Gmailu na „Nastavit
 * předvolby" a v reportu se neobjevilo nic. Systémové odkazy totiž nevedou přes
 * `/t/c/`: nejsou v `campaign_links`, protože jejich cíl není adresa, ale
 * podepsaný token vydaný pro jednu konkrétní zprávu. Tudy se do měření dosud
 * nedostal ani jeden bajt. Přitom je to na vývojovém stroji jediná interakce
 * z Gmailu, která fyzicky dorazit MŮŽE: pixel stahuje proxy Googlu, které
 * `localhost` odesílatele nic neříká, kdežto systémový odkaz otevírá prohlížeč
 * příjemce na tomtéž stroji.
 *
 * Vztah k `recordCampaignUnsubscribe`: ten zapisuje `unsubscribe`, tedy že se
 * člověk OPRAVDU odhlásil. Tahle funkce zapisuje, že si odhlašovací stránku
 * jen otevřel. Jsou to dvě různé věci a na `/u/` můžou nastat obě: kdo si
 * stránku otevře a odejde, nechá po sobě jen systémový proklik.
 *
 * Do míry prokliku se událost NEZAPOČÍTÁVÁ, viz `SYSTEM_CLICK_SUBTYPE`.
 * Drží to `link_id = NULL`, nikoli podmínka v agregaci.
 */
export type RecordSystemLinkClickInput = {
  workspaceId: string;
  messageId: string;
  messageCreatedAt: Date;
  contactId: string;
  kind: SystemLinkKind;
};

export type RecordSystemLinkClickResult = { campaignId: string | null; recorded: boolean };

export async function recordSystemLinkClick(
  input: RecordSystemLinkClickInput,
): Promise<RecordSystemLinkClickResult> {
  const result = await withTrackingTx(
    { workspaceId: input.workspaceId, job: 'tracking.record_system_link_click' },
    async (tx) => {
      const { rows: messages } = await tx.execute<{
        campaignId: string | null;
        createdAt: Date;
      }>(sql`
        SELECT campaign_id AS "campaignId", created_at AS "createdAt"
          FROM messages
         WHERE id = ${input.messageId}::uuid
           AND workspace_id = ${input.workspaceId}::uuid
           -- Sekundová tolerance: token nese message_created_at v celých
           -- sekundách, kdežto sloupec má mikrosekundy. Stejně to dělá
           -- unsubscribe/record.ts a odchylka by se poznala až v produkci.
           AND created_at >= ${input.messageCreatedAt}::timestamptz - interval '1 second'
           AND created_at <  ${input.messageCreatedAt}::timestamptz + interval '2 seconds'
         LIMIT 1
      `);
      const message = messages[0];
      if (message === undefined || message.campaignId === null) return null;

      // Idempotence na dvojici (zpráva, druh odkazu). Centrum předvoleb běží na
      // vzoru POST-přesměrování-GET, takže jedno uložení formuláře vyrobí dvě
      // načtení stránky. Bez téhle podmínky by z jednoho kliknutí byly tři
      // události a časová osa kontaktu by tvrdila něco, co se nestalo.
      const { rows: inserted } = await tx.execute<{ id: string }>(sql`
        INSERT INTO message_events (
          id, workspace_id, message_id, message_created_at, campaign_id,
          contact_id, type, subtype, link_id, ts, source, metadata)
        SELECT ${uuidv7()}::uuid, ${input.workspaceId}::uuid, ${input.messageId}::uuid,
               ${message.createdAt}, ${message.campaignId}::uuid, ${input.contactId}::uuid,
               'click', ${SYSTEM_CLICK_SUBTYPE}, NULL, now(), 'tracking',
               ${JSON.stringify({ system_link: input.kind })}::jsonb
         WHERE NOT EXISTS (
                 SELECT 1 FROM message_events e
                  WHERE e.workspace_id = ${input.workspaceId}::uuid
                    AND e.message_id = ${input.messageId}::uuid
                    AND e.type = 'click'
                    AND e.subtype = ${SYSTEM_CLICK_SUBTYPE}
                    AND e.metadata ->> 'system_link' = ${input.kind})
        RETURNING id
      `);

      return { campaignId: message.campaignId, recorded: inserted.length > 0 };
    },
  );

  if (result === null) return { campaignId: null, recorded: false };

  if (result.recorded) {
    trackingLogger().debug(
      { workspace_id: input.workspaceId, campaign_id: result.campaignId, system_link: input.kind },
      'proklik na systémový odkaz připsán kampani',
    );
  }
  return result;
}

/**
 * Kolikrát se v kampani kliklo na systémový odkaz, po druzích.
 *
 * Čte se přímo z `message_events`, ne ze souhrnu: systémový proklik je řádově
 * vzácnější než otevření a vlastní sloupec v `campaign_stats` by za to nestál.
 * Počítá se `count(DISTINCT message_id)`, tedy „kolik příjemců", ne kolik
 * načtení stránky.
 */
export type SystemLinkClickCounts = Record<SystemLinkKind, number>;

export async function readSystemLinkClicks(
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<SystemLinkClickCounts> {
  const counts: SystemLinkClickCounts = { unsubscribe_page: 0, preferences: 0, webview: 0 };

  const rows = await withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ kind: string; count: string }>(sql`
        SELECT metadata ->> 'system_link'   AS "kind",
               count(DISTINCT message_id)   AS "count"
          FROM message_events
         WHERE workspace_id = ${ctx.workspaceId}::uuid
           AND campaign_id  = ${campaignId}::uuid
           AND type    = 'click'
           AND subtype = ${SYSTEM_CLICK_SUBTYPE}
         GROUP BY 1
      `);
    return rows;
  });

  for (const row of rows) {
    if (row.kind !== null && row.kind in counts) {
      counts[row.kind as SystemLinkKind] = Number(row.count);
    }
  }
  return counts;
}
