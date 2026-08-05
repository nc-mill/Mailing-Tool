import { withWorkspace, type WorkspaceContext } from '../../tx';
import { rawSql } from '../repo/raw-sql';

/**
 * Předčasné uvolnění rozesílky, tedy tlačítko „Odeslat teď".
 *
 * CO ODPOČET DOOPRAVDY JE. Není to okno na rozmyšlenou v prohlížeči. Je to
 * ODLOŽENÝ START NA SERVERU: `startMaterialization` spočítá `campaigns.release_at`
 * a materializace pak každou zprávu vloží s `next_attempt_at = release_at`
 * (`COALESCE($4, $3)` v `materializeBatch`). Claim dotaz senderu má podmínku
 * `m.next_attempt_at <= now()`, takže do té chvíle si zprávy prostě nikdo
 * nevezme. Publikum se přitom staví hned, takže po uplynutí okna se odesílá
 * rovnou, bez rozjezdu.
 *
 * CO DĚLÁ „ODESLAT TEĎ". Přesně dvě věci, obě v jedné transakci:
 *   1. posune `release_at` na `now()`, takže okno na vzetí zpět je pryč
 *      (`undoState` po tom vrací `canUndo: false`),
 *   2. přepíše `next_attempt_at` na `now()` u zpráv, které ještě čekají.
 * Sender si je vezme při nejbližším průchodu, tedy během jednotek sekund.
 * Nic dalšího se nestaví ani nepřepíná: stav kampaně zůstává `queueing` nebo
 * `sending`, jak byl.
 *
 * IDEMPOTENTNÍ. Druhé volání nemá co uvolnit a vrátí nuly. Podmínka
 * `next_attempt_at > now()` je tam právě proto: bez ní by tlačítko posunulo čas
 * i zprávám, kterým sender odložil další pokus po neúspěchu, a rozbilo by
 * odstup mezi pokusy.
 *
 * ZNÁMÁ HRANICE. Když se v tu chvíli ještě staví publikum, dostanou dávky
 * vložené AŽ POTOM původní `release_at`, protože si ho materializace přečetla
 * na začátku běhu. Takové zprávy odejdou v čase, který byl uživateli slíbený
 * od začátku, tedy nejpozději na konci okna. Netýká se to kampaní, u kterých má
 * tlačítko smysl: publikum se staví po pěti tisících kontaktech a okno má
 * v instalaci desítky sekund, takže se materializace do něj vejde.
 */
export async function releaseCampaignNow(
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<{ released: boolean; messages: number }> {
  return withWorkspace(ctx, async (tx) => {
    const campaign = await tx.execute(
      rawSql(
        `UPDATE campaigns
            SET release_at = now(), updated_at = now()
          WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
            AND status IN ('queueing','sending')
            AND release_at IS NOT NULL AND release_at > now()`,
        [campaignId, ctx.workspaceId],
      ),
    );

    // Zprávy se uvolňují I TEHDY, když se na kampani nic nezměnilo. Okno mohlo
    // mezitím uplynout samo, ale `next_attempt_at` u čekajících zpráv je pořád
    // ta stará hodnota, takže tenhle druhý UPDATE je ten, který doopravdy
    // rozhoduje o tom, kdy se začne odesílat.
    const messages = await tx.execute(
      rawSql(
        `UPDATE messages
            SET next_attempt_at = now(), updated_at = now()
          WHERE campaign_id = $1 AND workspace_id = $2
            AND kind = 'campaign'
            AND status = 'pending'
            AND next_attempt_at > now()`,
        [campaignId, ctx.workspaceId],
      ),
    );

    return {
      released: (campaign.rowCount ?? 0) > 0,
      messages: messages.rowCount ?? 0,
    };
  });
}
