import { sql } from 'drizzle-orm';
import { createSystemContext } from '../../identity/context';
import { withWorkspace } from '../../tx';
import { BULK_BATCH_SIZE } from '../constants';

export type BulkTagPayload = {
  workspaceId: string;
  contactIds: string[];
  add: string[];
  remove: string[];
};

/**
 * Hromadné přiřazení a odebrání štítků po dávkách.
 *
 * Idempotence: přidání jde přes ON CONFLICT DO NOTHING nad primárním klíčem
 * contact_tags, odebrání je DELETE, který podruhé nemá co mazat. Druhý běh po pádu
 * workeru tedy skončí se stejným výsledkem jako první.
 *
 * ODCHYLKA OD PLÁNU, stejná jako u strip-attribute: místo `deps: { db }` bez kontextu
 * se transakce otevírá pod kontextem projektu z payloadu, jinak by RLS nepustila ani řádek.
 */
export async function bulkTag(
  payload: BulkTagPayload,
): Promise<{ tagged: number; untagged: number }> {
  const ctx = createSystemContext(payload.workspaceId, 'contacts.bulk_tag');
  let tagged = 0;
  let untagged = 0;

  for (let offset = 0; offset < payload.contactIds.length; offset += BULK_BATCH_SIZE) {
    const batch = payload.contactIds.slice(offset, offset + BULK_BATCH_SIZE);

    await withWorkspace(ctx, async (tx) => {
      if (payload.add.length > 0) {
        const result = await tx.execute<{ contact_id: string }>(sql`
          INSERT INTO contact_tags (contact_id, tag_id, workspace_id)
          SELECT c, t, ${payload.workspaceId}::uuid
            FROM unnest(${sql.param(batch)}::uuid[]) AS c
           CROSS JOIN unnest(${sql.param(payload.add)}::uuid[]) AS t
          ON CONFLICT (contact_id, tag_id) DO NOTHING
          RETURNING contact_id
        `);
        tagged += result.rows.length;
      }

      if (payload.remove.length > 0) {
        const result = await tx.execute<{ contact_id: string }>(sql`
          DELETE FROM contact_tags
           WHERE workspace_id = ${payload.workspaceId}::uuid
             AND contact_id = ANY(${sql.param(batch)}::uuid[])
             AND tag_id = ANY(${sql.param(payload.remove)}::uuid[])
          RETURNING contact_id
        `);
        untagged += result.rows.length;
      }
    });
  }

  return { tagged, untagged };
}
