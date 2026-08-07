import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { seedWorkspaceForCoreTests, type SeededWorkspace } from '../../../identity/test-helpers';
import { startPgHarness, type PgHarness } from '../../../test-support/pg-harness';
import { closePools, withWorkspace } from '../../../tx';
import { handlers } from './queue-handlers';

/**
 * DŮKAZ, že `contacts.cleanup_import_files` doopravdy doběhne.
 *
 * Vada byla v tom, že obsluha šla přes `perJob` a brala `job.data.workspaceId`,
 * jenže fronta je CRON s prázdným nákladem (`payloadFields: []` v registru).
 * `createSystemContext(undefined)` na tom skončil chybou `validation_failed`,
 * a to každou noc znovu. Nahrané soubory se tedy nesmazaly nikdy: ležely
 * v `DATA_DIR` dál i s adresami, které do nich zákazník nahrál.
 *
 * Test volá obsluhu přesně tak, jak ji volá pg-boss: dávkou s prázdným nákladem.
 */
let harness: PgHarness;
let seeded: SeededWorkspace;

beforeAll(async () => {
  harness = await startPgHarness();
  seeded = await seedWorkspaceForCoreTests();
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

describe('noční úklid souborů importu', () => {
  it('cronový tik s prázdným nákladem doběhne, ne validation_failed', async () => {
    await expect(
      handlers['contacts.cleanup_import_files']([
        { id: 'j1', name: 'contacts.cleanup_import_files', data: {} },
      ]),
    ).resolves.toBeUndefined();
  });

  it('import po termínu přijde o storage_key, nedotčený si ho nechá', async () => {
    const ids = await withWorkspace(seeded.ctx, async (tx) => {
      const rows = await tx.execute<{ id: string }>(sql`
        INSERT INTO imports (workspace_id, filename, storage_key, status, file_expires_at,
                             byte_size, content_sha256, idempotency_key)
        VALUES
          (${seeded.ctx.workspaceId}::uuid, 'stary.csv', 'stary-klic', 'completed',
           now() - interval '1 day', 10, decode(md5('stary'), 'hex'), 'idem-stary'),
          (${seeded.ctx.workspaceId}::uuid, 'novy.csv', 'novy-klic', 'completed',
           now() + interval '30 days', 10, decode(md5('novy'), 'hex'), 'idem-novy')
        RETURNING id
      `);
      return rows.rows.map((r) => r.id);
    });

    await handlers['contacts.cleanup_import_files']([
      { id: 'j2', name: 'contacts.cleanup_import_files', data: {} },
    ]);

    const keys = await withWorkspace(seeded.ctx, async (tx) => {
      const rows = await tx.execute<{ id: string; storage_key: string | null }>(sql`
        SELECT id, storage_key FROM imports WHERE id = ANY(${sql`ARRAY[${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}]`})
      `);
      return new Map(rows.rows.map((r) => [r.id, r.storage_key]));
    });

    expect(keys.get(ids[0]!)).toBeNull();
    expect(keys.get(ids[1]!)).toBe('novy-klic');
  });
});
