import { sql } from 'drizzle-orm';
import { createSystemContext } from '../../identity/context';
import { withWorkspace, type Tx } from '../../tx';
import type { WorkspaceContext } from '../../identity/types';

export type VerifyFieldIndexPayload = { workspaceId: string; fieldId: string };

/**
 * Prověří, že vlastní pole je dotazovatelné přes existující GIN index nad attributes,
 * a podle výsledku přepne index_state.
 *
 * ŽÁDNÉ DDL. Rozhodnutí R14: doména schéma nemění. Index idx_contacts__attributes_gin
 * nad `attributes jsonb_path_ops` zakládá migrace P03 pro všechny klíče naráz, takže
 * není co zakládat per pole. Dřívější znění tady spouštělo CREATE INDEX CONCURRENTLY
 * přes aplikační pool, což by skončilo na 42501, protože tabulku vlastní mlain_migrator.
 *
 * Prověrka je věcná, ne formální: ověřuje, že pole není archivované a že hodnoty pod
 * jeho klíčem jsou skalární nebo pole skalárů, tedy tvar, na kterém operátor @> funguje.
 * Vnořený objekt by index nepomohl a segment by u něj tiše prošel celou tabulku.
 */
export async function verifyFieldIndex(payload: VerifyFieldIndexPayload): Promise<void> {
  const ctx = createSystemContext(payload.workspaceId, 'contact_fields.verify_index');

  await withWorkspace(ctx, async (tx) => {
    const { rows: fields } = await tx.execute<{ key: string; archived_at: Date | null }>(sql`
      SELECT key, archived_at FROM contact_fields
       WHERE id = ${payload.fieldId} AND workspace_id = ${payload.workspaceId}::uuid
    `);
    if (fields.length === 0) return;
    const field = fields[0]!;

    if (field.archived_at !== null) {
      await setState(tx, ctx, payload, 'failed', false);
      return;
    }

    // jsonb_typeof nad hodnotou klíče. Zajímají nás jen tvary, na kterých @> funguje.
    const { rows: shapes } = await tx.execute<{ shape: string; total: number }>(sql`
      SELECT jsonb_typeof(attributes -> ${field.key}) AS shape, count(*)::int AS total
        FROM contacts
       WHERE workspace_id = ${payload.workspaceId}::uuid
         AND deleted_at IS NULL
         AND attributes ? ${field.key}
       GROUP BY 1
    `);
    const unsupported = shapes.filter((row) => row.shape === 'object');
    if (unsupported.length > 0) {
      await setState(tx, ctx, payload, 'failed', false);
      return;
    }

    await setState(tx, ctx, payload, 'ready', true);
  });
}

async function setState(
  tx: Tx,
  ctx: WorkspaceContext,
  payload: VerifyFieldIndexPayload,
  state: 'ready' | 'failed',
  indexed: boolean,
): Promise<void> {
  await tx.execute(sql`
    UPDATE contact_fields
       SET index_state = ${state}, indexed = ${indexed}, updated_at = now()
     WHERE id = ${payload.fieldId} AND workspace_id = ${ctx.workspaceId}::uuid
  `);
}
