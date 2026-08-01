import { sql } from 'drizzle-orm';
import { withTrackingTx } from './tx';

export type MessageEventInsert = {
  id: string;
  workspaceId: string;
  messageId: string;
  messageCreatedAt: Date;
  campaignId: string;
  contactId: string | null;
  type: 'open' | 'click';
  /** U otevření třída otevření, u kliku třída kliku. */
  subtype: string;
  ts: Date;
  linkId: string | null;
  metadata: Record<string, unknown>;
};

/**
 * Hodnota `message_events.source` pro všechno, co zapisuje tahle doména.
 * Sloupec je NOT NULL bez výchozí hodnoty a je to správně: výchozí hodnota
 * by tiše označila událost od providera za vlastní. Ostatní zapisovatelé
 * mají `ses_sns`, `smtp` a `internal`.
 */
const TRACKING_SOURCE = 'tracking';

/**
 * Jeden příkaz na dávku a projekt. Vrací ID skutečně vložených řádků,
 * ne délku vstupu: přírůstky do *_total se počítají z nich, jinak by dvojí
 * běh jobu čísla nafoukl.
 *
 * **Tři sloupce se schválně nevyjmenovávají.**
 * `received_at` doplní databáze (`DEFAULT now()`) a je to partiční klíč.
 * `rank` je generovaný sloupec odvozený z `type`, takže hodnota do něj
 * vložit **nejde** a pokus by skončil chybou 428C9. `recipient` je u otevření
 * a prokliku prázdný záměrně: je to e-mailová adresa a kopírovat ji na každý
 * řádek desetimilionové tabulky by znamenalo, že jí musí výmaz podle GDPR
 * projít znovu. Podmíněné omezení ji vyžaduje jen u doručovacích událostí,
 * které zapisuje sender.
 *
 * **Idempotence stojí na `WHERE NOT EXISTS`, ne na `ON CONFLICT`.**
 * Dřívější `ON CONFLICT (id, received_at) DO NOTHING` byl mrtvý kód:
 * `received_at` se mezi vkládanými sloupci neobjevuje, doplní se `now()`
 * a je pokaždé jiné, takže konfliktní cíl nemohl nikdy sepnout a opakovaný
 * běh vyráběl duplicity.
 *
 * Podmínka na `received_at` v poddotazu je kvůli prořezání oddílů: bez ní
 * by se hledalo ve všech 37 měsíčních oddílech. Hodina bohatě stačí, protože
 * opakovaný zápis téže dávky vzniká jen opakováním flushe, tedy během sekund.
 */
export async function insertMessageEvents(rows: readonly MessageEventInsert[]): Promise<string[]> {
  if (rows.length === 0) return [];

  // Buffer je společný pro celý proces, takže jedna dávka nese události
  // z několika projektů. Zapisuje se proto po projektech: transakce má právě
  // jeden workspace kontext a RLS by zbytek dávky odmítla na WITH CHECK.
  const byWorkspace = new Map<string, MessageEventInsert[]>();
  for (const row of rows) {
    const group = byWorkspace.get(row.workspaceId);
    if (group === undefined) byWorkspace.set(row.workspaceId, [row]);
    else group.push(row);
  }

  const insertedIds: string[] = [];
  for (const [workspaceId, group] of byWorkspace) {
    const ids = await withTrackingTx({ workspaceId, job: 'tracking.writer_flush' }, async (tx) => {
      const { rows: inserted } = await tx.execute<{ id: string }>(sql`
        INSERT INTO message_events (
          id, workspace_id, message_id, message_created_at, campaign_id,
          contact_id, type, subtype, ts, link_id, metadata, source)
        SELECT s.id, s.workspace_id, s.message_id, s.message_created_at, s.campaign_id,
               s.contact_id, s.type, s.subtype, s.ts, s.link_id, s.metadata, ${TRACKING_SOURCE}
          FROM unnest(
                 ${sql.param(group.map((r) => r.id))}::uuid[],
                 ${sql.param(group.map((r) => r.workspaceId))}::uuid[],
                 ${sql.param(group.map((r) => r.messageId))}::uuid[],
                 ${sql.param(group.map((r) => r.messageCreatedAt))}::timestamptz[],
                 ${sql.param(group.map((r) => r.campaignId))}::uuid[],
                 ${sql.param(group.map((r) => r.contactId))}::uuid[],
                 ${sql.param(group.map((r) => r.type))}::text[],
                 ${sql.param(group.map((r) => r.subtype))}::text[],
                 ${sql.param(group.map((r) => r.ts))}::timestamptz[],
                 ${sql.param(group.map((r) => r.linkId))}::uuid[],
                 ${sql.param(group.map((r) => JSON.stringify(r.metadata)))}::jsonb[]
               ) AS s(id, workspace_id, message_id, message_created_at, campaign_id,
                      contact_id, type, subtype, ts, link_id, metadata)
         WHERE NOT EXISTS (
                 SELECT 1 FROM message_events e
                  WHERE e.workspace_id = s.workspace_id
                    AND e.id = s.id
                    AND e.received_at >= now() - interval '1 hour')
        RETURNING id
      `);
      return inserted.map((row) => row.id);
    });
    insertedIds.push(...ids);
  }

  return insertedIds;
}
