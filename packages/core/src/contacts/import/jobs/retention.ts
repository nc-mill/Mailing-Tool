import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../../../identity/types';
import { inWorkspaceTx } from '../db';
import { importLimits } from '../limits';
import { deleteUpload } from '../storage';

/**
 * Idempotence stojí na tom, že `storage_key` smí být NULL: po smazání souboru
 * řádek vypadne z výběru a druhý běh ho už nenabídne. S NOT NULL by job
 * donekonečna nabízel, co už smazal.
 */
export async function runRetention(ctx: WorkspaceContext): Promise<number> {
  const dataDir = importLimits().dataDir;
  return inWorkspaceTx(ctx, async (tx) => {
    const { rows } = await tx.execute<{ id: string; storage_key: string }>(sql`
      SELECT id, storage_key FROM imports
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND storage_key IS NOT NULL AND file_expires_at < now()`);
    for (const row of rows) {
      await deleteUpload(dataDir, row.storage_key);
      await tx.execute(sql`
        UPDATE imports SET storage_key = NULL, updated_at = now()
         WHERE id = ${row.id}::uuid AND workspace_id = ${ctx.workspaceId}::uuid`);
    }
    return rows.length;
  });
}
