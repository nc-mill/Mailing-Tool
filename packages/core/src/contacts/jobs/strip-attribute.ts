import { sql } from 'drizzle-orm';
import { createSystemContext } from '../../identity/context';
import { withWorkspace } from '../../tx';
import { ATTRIBUTE_STRIP_BATCH_SIZE } from '../constants';

export type StripAttributePayload = { workspaceId: string; key: string };

/**
 * Odstraní klíč z attributes po dávkách. Idempotentní: odebrání klíče, který tam
 * není, je operace bez efektu, takže druhý běh po pádu workeru nic nezkazí.
 *
 * Průchod jde přes (workspace_id, id) s kurzorem, ne přes OFFSET: index idx_contacts__ws_id
 * to pokrývá a dotaz nikdy neprochází cizí projekty.
 *
 * ODCHYLKA OD PLÁNU. Plán bral `deps: { db: Database }`, tedy handle bez kontextu projektu.
 * Nad tabulkou s RLS by takový dotaz vrátil nula řádků a job by tiše hlásil úspěch.
 * Kontext se proto vyrábí z payloadu jedinou povolenou továrnou `createSystemContext`.
 */
export async function stripAttribute(payload: StripAttributePayload): Promise<{ updated: number }> {
  const ctx = createSystemContext(payload.workspaceId, 'contacts.strip_attribute');
  let cursor = '00000000-0000-0000-0000-000000000000';
  let updated = 0;

  for (;;) {
    const batch = await withWorkspace(ctx, async (tx) =>
      tx.execute<{ id: string }>(sql`
        WITH page AS (
          SELECT id FROM contacts
           WHERE workspace_id = ${payload.workspaceId}::uuid
             AND id > ${cursor}::uuid
             AND attributes ? ${payload.key}
           ORDER BY id
           LIMIT ${ATTRIBUTE_STRIP_BATCH_SIZE}
        )
        UPDATE contacts c
           SET attributes = c.attributes - ${payload.key}, updated_at = now()
          FROM page
         WHERE c.id = page.id
        RETURNING c.id
      `),
    );

    if (batch.rows.length === 0) break;
    updated += batch.rows.length;
    // Dotaz aktualizuje jen řádky, které klíč mají, takže se kurzor musí posunout
    // za NEJVYŠŠÍ id dávky. Pořadí RETURNING není zaručené, proto maximum, ne poslední.
    cursor = batch.rows.reduce((max, row) => (row.id > max ? row.id : max), cursor);
  }

  return { updated };
}
