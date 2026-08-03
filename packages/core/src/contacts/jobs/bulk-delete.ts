import { sql, type SQL } from 'drizzle-orm';
import { createSystemContext } from '../../identity/context';
import { withWorkspace } from '../../tx';
import { writeAudit } from '../audit';
import { BULK_BATCH_SIZE } from '../constants';
import { contactFilterConditions, type ContactBulkFilter } from '../repo/contacts-query';

export type BulkDeletePayload = {
  workspaceId: string;
  /** Výběr na stránce. Vylučuje se s `filter`. */
  contactIds?: string[];
  /** "Vše, co odpovídá filtru". Prázdný objekt znamená všechny kontakty projektu. */
  filter?: ContactBulkFilter;
  /** Kdo mazání objednal. Jde do metadat auditu, protože job běží pod systémovým aktérem. */
  requestedBy?: string;
};

/**
 * Hromadné měkké smazání kontaktů po dávkách.
 *
 * Dělá TOTÉŽ co `deleteContact(ctx, id, 'soft')` v `repo/contacts.ts`, jen dávkově:
 * nastaví `deleted_at`, status `deleted`, adresu nechá být a kontakt jde 30 dní obnovit.
 * Suppression se nemění a čekající zprávy se neruší, protože je neruší ani smazání
 * jednoho kontaktu; kdyby to hromadná cesta dělala navíc, byly by to dvě různá mazání
 * podle toho, kolik řádků uživatel označil.
 *
 * Idempotence: UPDATE je podmíněný na `deleted_at IS NULL`, takže druhý běh po pádu
 * workeru ovlivní nula řádků. Přesně to tvrdí `CONTACTS_QUEUES['contacts.bulk_delete']`.
 *
 * Kontext projektu se vyrábí z payloadu jedinou povolenou továrnou `createSystemContext`,
 * stejně jako u `strip-attribute` a `bulk-tag`. Handle bez kontextu by pod RLS nevrátil
 * ani řádek a job by ohlásil úspěch, přestože by nesmazal nic.
 */
export async function bulkDelete(payload: BulkDeletePayload): Promise<{ deleted: number }> {
  const ctx = createSystemContext(payload.workspaceId, 'contacts.bulk_delete');
  const ids = payload.contactIds;
  const filter = payload.filter;

  if (ids !== undefined && filter !== undefined) {
    throw new Error(
      'Náklad contacts.bulk_delete nese contactIds i filter naráz. Rozsah musí být právě ' +
        'jeden: výčet id, nebo filtr. Provést obojí by smazalo víc, než co uživatel potvrdil.',
    );
  }
  if (ids === undefined && filter === undefined) {
    throw new Error(
      'Náklad contacts.bulk_delete nenese ani contactIds, ani filter. Prázdný rozsah by ' +
        'se dal číst jako "všechno", a to je u nevratné operace ta nejhorší možná domněnka.',
    );
  }

  let deleted = 0;

  if (ids !== undefined) {
    for (let offset = 0; offset < ids.length; offset += BULK_BATCH_SIZE) {
      const batch = ids.slice(offset, offset + BULK_BATCH_SIZE);
      deleted += await deleteBatch(
        ctx,
        payload,
        sql`
          UPDATE contacts
             SET deleted_at = now(), status = 'deleted', updated_at = now()
           WHERE workspace_id = ${payload.workspaceId}::uuid
             AND id = ANY(${sql.param(batch)}::uuid[])
             AND deleted_at IS NULL
          RETURNING id
        `,
      );
    }
    return { deleted };
  }

  // Filtrová větev. Podmínky skládá TÝŽ kód jako seznam a počet kontaktů
  // (`contactFilterConditions`), takže se maže právě to, co uživatel viděl.
  const where = sql.join(contactFilterConditions(ctx, filter!), sql` AND `);

  // Průchod jde kurzorem přes id, ne přes OFFSET: (workspace_id, id) pokrývá index
  // idx_contacts__ws_id a dotaz nikdy neprochází cizí projekty. Kurzor je druhá
  // pojistka proti nekonečné smyčce vedle podmínky `deleted_at IS NULL` ve filtru.
  let cursor = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const page = await withWorkspace(ctx, async (tx) =>
      tx.execute<{ id: string }>(sql`
        SELECT c.id FROM contacts c
         WHERE ${where} AND c.id > ${cursor}::uuid
         ORDER BY c.id
         LIMIT ${BULK_BATCH_SIZE}
      `),
    );
    if (page.rows.length === 0) break;

    const batch = page.rows.map((row) => row.id);
    // Kurzor se posouvá za NEJVYŠŠÍ id dávky, ne za poslední řádek RETURNING:
    // pořadí RETURNING není zaručené. Tady je vstupem seřazený SELECT, takže by
    // stačil poslední prvek, ale maximum je stejně levné a nespoléhá na to.
    cursor = batch.reduce((max, id) => (id > max ? id : max), cursor);

    deleted += await deleteBatch(
      ctx,
      payload,
      sql`
        UPDATE contacts
           SET deleted_at = now(), status = 'deleted', updated_at = now()
         WHERE workspace_id = ${payload.workspaceId}::uuid
           AND id = ANY(${sql.param(batch)}::uuid[])
           AND deleted_at IS NULL
        RETURNING id
      `,
    );
  }

  return { deleted };
}

/**
 * Jedna dávka a její auditní záznam v JEDNÉ transakci.
 *
 * Audit se píše po dávkách, ne jednou na konec. Fronta má `retryLimit: 0`, takže job,
 * který zemře v půlce, se už nespustí: záznam na konci by u takového běhu nevznikl vůbec
 * a v auditu by nezbylo nic o kontaktech, které už smazané jsou. Po dávkách trail
 * odpovídá skutečnosti i po pádu.
 *
 * Jeden záznam na dávku, ne na kontakt: `contact.bulk_deleted` je akce nad množinou.
 * Padesát tisíc řádků v audit_log by o operaci neřeklo víc než deset.
 */
async function deleteBatch(
  ctx: ReturnType<typeof createSystemContext>,
  payload: BulkDeletePayload,
  statement: SQL,
): Promise<number> {
  return withWorkspace(ctx, async (tx) => {
    const result = await tx.execute<{ id: string }>(statement);
    if (result.rows.length === 0) return 0;

    await writeAudit(tx, ctx, {
      action: 'contact.bulk_deleted',
      targetType: 'contact',
      targetId: null,
      metadata: {
        deleted: result.rows.length,
        mode: 'soft',
        scope: payload.contactIds === undefined ? 'filter' : 'ids',
        ...(payload.requestedBy === undefined ? {} : { requested_by: payload.requestedBy }),
      },
    });
    return result.rows.length;
  });
}
