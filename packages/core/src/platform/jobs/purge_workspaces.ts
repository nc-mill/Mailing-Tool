import { sql } from 'drizzle-orm';
import { withoutContext } from '../../tx';
import { RESTORE_WINDOW_DAYS } from '../../identity/workspace-service';

/**
 * 3.3: měkce smazaný workspace jde 30 dní obnovit, pak se maže tvrdě.
 * Smazání workspace je jediná operace, která maže data kaskádou.
 *
 * Job je idempotentní: opakovaný běh nad už smazaným projektem nic nenajde.
 */
export async function handler(): Promise<number> {
  return withoutContext(async (tx) => {
    const { rows } = await tx.execute(sql`
      DELETE FROM workspaces
       WHERE deleted_at IS NOT NULL
         AND deleted_at < now() - interval '${sql.raw(String(RESTORE_WINDOW_DAYS))} days'
       RETURNING id
    `);
    return rows.length;
  });
}
