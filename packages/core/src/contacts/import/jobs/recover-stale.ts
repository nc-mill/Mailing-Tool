import { sql } from 'drizzle-orm';
import { ApiError } from '../../../errors/api-error';
import { importLogger } from '../logging';
import { withoutContext, type Tx } from '../../../tx';

export type RecoverPayload = { workspaceId: string; importId: string; phase: 'run' };

/**
 * Job má retryLimit = 0, takže obnovu řídí importér sám. Jediný signál živosti
 * je `imports.updated_at`, které zapisuje KAŽDÁ checkpointová transakce.
 *
 * Tenhle sken jde napříč projekty a platí pro něj rozhodnutí R18: `imports` má
 * politiku `ws_isolation`, takže bez systémového bypassu vrátí `withoutContext`
 * nula řádků a NEVRÁTÍ chybu. Zaseknuté importy by se nikdy neobnovily, projekt
 * by měl navždy obsazený `singletonKey` a nešel by v něm spustit ani jeden další
 * import, zatímco job by každou hodinu vesele hlásil `{ recovered: 0 }`.
 *
 * Strážce proto ticho odliší od prázdna: když v instanci existují uživatelé,
 * ale `imports` vrací nulu, je to zablokovaný sken, ne prázdná tabulka, a job
 * spadne hlasitě.
 */
export async function recoverStaleImports(
  opts: { staleMinutes: number },
  enqueue: (payload: RecoverPayload) => Promise<void>,
): Promise<number> {
  const rows = await withoutContext(async (tx: Tx) => {
    const { rows: seen } = await tx.execute<{ users: number; imports: number }>(sql`
      SELECT (SELECT count(*) FROM users)::int AS users,
             (SELECT count(*) FROM imports)::int AS imports`);
    const probe = seen[0];
    if (probe !== undefined && probe.users > 0 && probe.imports === 0) {
      throw new ApiError('service_unavailable', {
        params: { code: 'cross_workspace_scan_blocked', table: 'imports' },
      });
    }
    const { rows: stale } = await tx.execute<{ id: string; workspace_id: string }>(sql`
      SELECT id, workspace_id FROM imports
       WHERE status = 'importing'
         AND updated_at < now() - make_interval(mins => ${opts.staleMinutes})`);
    return stale;
  });
  for (const row of rows) {
    await enqueue({ workspaceId: row.workspace_id, importId: row.id, phase: 'run' });
  }
  importLogger().info({ recovered: rows.length }, 'stale imports requeued');
  return rows.length;
}
