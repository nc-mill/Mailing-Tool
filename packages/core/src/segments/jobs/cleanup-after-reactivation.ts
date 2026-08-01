import { sql } from 'drizzle-orm';
import { ApiError } from '../../errors/api-error';
import { createSystemContext } from '../../identity/context';
import { segmentsLogger } from '../logging';
import { withWorkspace, type Tx } from '../../tx';

export type CleanupAction = 'unsubscribe_all' | 'tag_only' | 'delete';

export type CleanupPayload = {
  workspaceId: string;
  segmentId: string;
  action: CleanupAction;
  reactivatedTagId: string;
  actorRole?: 'owner' | 'admin' | 'editor' | 'viewer';
};

export type CleanupResult = { considered: number; skipped: number; affected: number };

/**
 * Poslední krok reaktivačního scénáře. Nevratná operace nad daty, která uživatel
 * roky sbíral, proto: mazat smí jen vlastník, kdo se ozval (má štítek), z úklidu
 * vypadá, a druhý běh nesmí nic udělat, protože `singletonKey` nic negarantuje.
 */
export const handler = async (job: { data: CleanupPayload }): Promise<CleanupResult> => {
  const { workspaceId, segmentId, action, reactivatedTagId, actorRole } = job.data;
  if (action === 'delete' && actorRole !== 'owner') {
    throw new ApiError('forbidden', {
      params: {
        code: 'forbidden',
        requiredPermission: 'contacts:delete',
        currentRole: actorRole ?? null,
      },
    });
  }
  const ctx = createSystemContext(workspaceId, 'contacts.cleanup_after_reactivation');

  return withWorkspace(ctx, async (tx: Tx) => {
    // Cílová množina jako fragment, ne jako řetězec s $n. Fragment se dá vložit
    // do většího dotazu a parametry si drží sám, takže nemůže dojít k posunu
    // číslování, když se okolní dotaz změní.
    const target = sql`
      SELECT sm.contact_id FROM segment_members sm
       WHERE sm.segment_id = ${segmentId}::uuid AND sm.workspace_id = ${workspaceId}::uuid
         AND NOT EXISTS (SELECT 1 FROM contact_tags ct
                          WHERE ct.contact_id = sm.contact_id AND ct.tag_id = ${reactivatedTagId}::uuid)`;

    const totals = await tx.execute<{ considered: number; skipped: number }>(sql`
      SELECT count(*)::int AS considered,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM contact_tags ct
                WHERE ct.contact_id = sm.contact_id AND ct.tag_id = ${reactivatedTagId}::uuid))::int AS skipped
        FROM segment_members sm
       WHERE sm.segment_id = ${segmentId}::uuid AND sm.workspace_id = ${workspaceId}::uuid`);

    let affected = 0;
    if (action === 'unsubscribe_all') {
      // Podmínka na status dělá z jobu idempotentní operaci: druhý běh
      // nenajde nic ve stavu 'active' a affected je nula.
      const { rows } = await tx.execute(sql`
        UPDATE contacts SET status = 'unsubscribed', updated_at = now()
         WHERE workspace_id = ${workspaceId}::uuid AND status = 'active'
           AND id IN (${target}) RETURNING id`);
      affected = rows.length;
    } else if (action === 'tag_only') {
      const { rows } = await tx.execute(sql`
        INSERT INTO contact_tags (contact_id, tag_id, workspace_id)
        SELECT contact_id, ${reactivatedTagId}::uuid, ${workspaceId}::uuid FROM (${target}) src
        ON CONFLICT DO NOTHING RETURNING contact_id`);
      affected = rows.length;
    } else {
      const { rows } = await tx.execute(sql`
        UPDATE contacts SET deleted_at = now()
         WHERE workspace_id = ${workspaceId}::uuid AND deleted_at IS NULL
           AND id IN (${target}) RETURNING id`);
      affected = rows.length;
    }

    const result = {
      considered: Number(totals.rows[0]?.considered ?? 0),
      skipped: Number(totals.rows[0]?.skipped ?? 0),
      affected,
    };
    segmentsLogger().info({ segmentId, action, ...result }, 'cleanup after reactivation finished');
    return result;
  });
};
