import { sql } from 'drizzle-orm';
import { createSystemContext } from '../../identity/context';
import { withWorkspace } from '../../tx';

export type SeverLinksPayload = { workspaceId: string; contactId: string };

/**
 * Odstřihne vazbu na osobu v doménách, které tenhle plán nevlastní.
 *
 * Události se NEMAŽOU, jen se jim odebere contact_id. Nechávají si campaign_id, typ
 * a čas, takže agregované statistiky kampaní se výmazem nemění: kampaň, která včera
 * vykazovala 4 812 otevření, jich vykazuje 4 812 i po výmazu. Ztrácí se jen možnost
 * říct, kdo to byl.
 *
 * Je to vědomé rozhodnutí. Alternativa (smazat i události) by znamenala, že se čísla
 * v uzavřených reportech zpětně mění, a report, jehož čísla se mění, je k ničemu.
 * Zároveň událost bez vazby na osobu je statistický údaj, ne osobní údaj.
 *
 * Idempotence: každý příkaz je UPDATE podmíněný na contact_id, takže druhý běh
 * ovlivní nula řádků.
 *
 * ODCHYLKA OD PLÁNU, A JE TO OPRAVA, NE KOSMETIKA. Plán nechával job běžet obálkou
 * bez kontextu projektu (`withoutWorkspace`, v repozitáři `withoutContext`) s tím, že
 * `workspace_id` je v každém příkazu. Ověřeno spuštěním proti reálné databázi: takhle
 * job NEODSTŘIHNE NIC. Všechny čtyři tabulky mají politiku `ws_isolation`, permisivní
 * `maintenance_bypass` má jediná (`web_events`) a platí jen pro roli `mlain_maintenance`.
 * Bez nastaveného `mlain.workspace_id` tedy každý UPDATE ovlivní nula řádků a NEVRÁTÍ
 * CHYBU: job by hlásil úspěch a adresa vymazaného člověka by zůstala v plaintextu
 * ve sloupci `message_events.recipient`.
 *
 * Job proto běží pod kontextem projektu z payloadu. `workspace_id` zůstává i tak
 * v každém příkazu, takže se odstřižení nemůže dotknout cizího projektu ani omylem.
 */
export async function severContactLinks(
  payload: SeverLinksPayload,
): Promise<{ messages: number; webEvents: number; messageEvents: number; engagement: number }> {
  const placeholder = `erased+${payload.contactId}@erased.invalid`;
  const ctx = createSystemContext(payload.workspaceId, 'gdpr.sever_links');

  return withWorkspace(ctx, async (tx) => {
    // 1. Zprávy. contact_id se NEVYNULOVÁVÁ: messages.contact_id je podle rozhodnutí R3
    //    plánu P03 NOT NULL a cizí klíč na contacts neexistuje právě proto, aby vazbu
    //    odstřihl tenhle job. Dřívější znění tady mělo `SET contact_id = NULL`, což by
    //    skončilo na 23502 a shodilo celou transakci odstřižení. Osobní údaj nese
    //    email a render_data, a ty se anonymizují.
    const { rows: messages } = await tx.execute<{ id: string }>(sql`
      UPDATE messages
         SET email = ${placeholder},
             render_data = '{}'::jsonb
       WHERE workspace_id = ${payload.workspaceId}::uuid
         AND contact_id = ${payload.contactId}::uuid
         AND email <> ${placeholder}
      RETURNING id
    `);

    // 2. Události z prohlížeče. erased_at MUSÍ přibýt zároveň s vynulováním vazby:
    //    ck_web_events__subject žádá, aby byl vyplněný aspoň jeden z anonymous_id,
    //    contact_id, erased_at. Serverová událost má vyplněné jen contact_id, takže
    //    samotné vynulování skončí na 23514. Sloupcový GRANT UPDATE od P03 obsahuje
    //    erased_at právě kvůli tomuhle.
    const { rows: webEvents } = await tx.execute<{ id: string }>(sql`
      UPDATE web_events
         SET contact_id = NULL, erased_at = now()
       WHERE workspace_id = ${payload.workspaceId}::uuid
         AND contact_id = ${payload.contactId}::uuid
      RETURNING id
    `);

    // 3. Události zpráv. Sloupec recipient drží PŮVODNÍ e-mailovou adresu, takže bez
    //    tohohle příkazu by adresa vymazaná podle článku 17 zůstala v databázi uložená
    //    v plaintextu. P03 na to má sloupcový grant UPDATE (contact_id, erased_at,
    //    recipient), který dosud neměl konzumenta.
    const { rows: messageEvents } = await tx.execute<{ id: string }>(sql`
      UPDATE message_events
         SET contact_id = NULL, erased_at = now(), recipient = ${placeholder}
       WHERE workspace_id = ${payload.workspaceId}::uuid
         AND contact_id = ${payload.contactId}::uuid
      RETURNING id
    `);

    // 4. Agregovaný engagement. Řádek zůstává, mizí jen vazba na osobu.
    const { rows: engagement } = await tx.execute<{ message_id: string }>(sql`
      UPDATE message_engagement
         SET contact_id = NULL, erased_at = now()
       WHERE workspace_id = ${payload.workspaceId}::uuid
         AND contact_id = ${payload.contactId}::uuid
      RETURNING message_id
    `);

    // 5. Identity a agregace kontaktu se mažou celé, protože bez vazby na osobu
    //    nenesou žádnou statistickou hodnotu.
    await tx.execute(sql`
      DELETE FROM identities
       WHERE workspace_id = ${payload.workspaceId}::uuid
         AND contact_id = ${payload.contactId}::uuid
    `);
    await tx.execute(sql`
      DELETE FROM contact_engagement
       WHERE workspace_id = ${payload.workspaceId}::uuid
         AND contact_id = ${payload.contactId}::uuid
    `);

    return {
      messages: messages.length,
      webEvents: webEvents.length,
      messageEvents: messageEvents.length,
      engagement: engagement.length,
    };
  });
}
