import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { seedWorkspace } from '../test/support/db';
import { withCrossWorkspaceTx, withTrackingTx } from './tx';

describe('transakční obal domény', () => {
  it('withTrackingTx nastaví mlain.workspace_id, takže RLS pustí řádky projektu', async () => {
    const workspaceId = await seedWorkspace();
    const seen = await withTrackingTx({ workspaceId, job: 'tracking.test' }, async (tx) => {
      const { rows } = await tx.execute<{ ws: string | null }>(
        sql`SELECT current_setting('mlain.workspace_id', true) AS ws`,
      );
      return rows[0]!.ws;
    });
    expect(seen).toBe(workspaceId);
  });

  it('withCrossWorkspaceTx kontext nenastavuje', async () => {
    const seen = await withCrossWorkspaceTx('tracking.test', async (tx) => {
      const { rows } = await tx.execute<{ ws: string | null }>(
        sql`SELECT current_setting('mlain.workspace_id', true) AS ws`,
      );
      return rows[0]!.ws;
    });
    expect(seen === null || seen === '').toBe(true);
  });

  it('tx.execute vrací QueryResult s .rows, ne pole', async () => {
    // Pojistka proti vzoru `const rows = await tx.execute(...); rows[0]`,
    // který projde typovou kontrolou a za běhu vždycky vrátí undefined.
    const result = await withCrossWorkspaceTx('tracking.test', (tx) =>
      tx.execute<{ n: number }>(sql`SELECT 42::int AS n`),
    );
    expect(Array.isArray(result)).toBe(false);
    expect(result.rows[0]!.n).toBe(42);
    expect((result as unknown as unknown[])[0]).toBeUndefined();
  });

  it('pole se do šablony předává přes sql.param, holé pole je record', async () => {
    // Ověřeno spuštěním: `${ids}::uuid[]` drizzle rozloží na ($1, $2, $3),
    // což je record, a dotaz skončí chybou 42846.
    const ids = ['0192f3a0-1c2d-7e50-8a1b-2c3d4e5f6071', '0192f3a0-1c2d-7e50-8a1b-2c3d4e5f6072'];
    const ok = await withCrossWorkspaceTx('tracking.test', async (tx) => {
      const { rows } = await tx.execute<{ id: string }>(
        sql`SELECT unnest(${sql.param(ids)}::uuid[]) AS id`,
      );
      return rows.map((r) => r.id);
    });
    expect(ok).toEqual(ids);

    await expect(
      withCrossWorkspaceTx('tracking.test', (tx) => tx.execute(sql`SELECT unnest(${ids}::uuid[])`)),
    ).rejects.toThrow();
  });
});
