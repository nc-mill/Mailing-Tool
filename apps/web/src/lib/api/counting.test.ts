// @vitest-environment node
//
// Databázový test, takže node, ne jsdom: v jsdom je `import.meta.url` adresa
// http a `fileURLToPath` v `packages/db/src/migrate.ts` na tom skončí chybou.
// Podrobnosti u téhož komentáře v test/api/pagination-integrity.test.ts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { pgErrorCode, withoutContext, closePools } from '@mlain/core/tx';
import { startPgHarness, type PgHarness } from '../../../test/api/pg-harness';
import { countWithTimeout, COUNT_TIMEOUT_MS } from './counting';

const SLOW_COUNT = sql`SELECT count(*) AS count FROM generate_series(1, 2000000000)`;

let harness: PgHarness;

beforeAll(async () => {
  harness = await startPgHarness();
}, 300_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

describe('countWithTimeout', () => {
  it('rychlý dotaz vrátí precision exact', async () => {
    const result = await withoutContext((tx) =>
      countWithTimeout(tx, sql`SELECT 42::bigint AS count`, sql`SELECT 0::bigint AS count`),
    );
    expect(result.count).toBe(42);
    expect(result.precision).toBe('exact');
    expect(result.stale).toBe(false);
    expect(new Date(result.computed_at).toString()).not.toBe('Invalid Date');
  });

  it('při překročení stropu spadne na odhad plánovače', async () => {
    const result = await withoutContext((tx) =>
      countWithTimeout(tx, SLOW_COUNT, sql`SELECT 1000::bigint AS count`),
    );
    expect(result.precision).toBe('estimated');
    expect(result.count).toBe(1000);
  }, 60_000);

  it('zrušený dotaz nese SQLSTATE 57014 na cause, ne na code', async () => {
    // Tenhle test hlídá to, na čem stojí celá náhradní cesta výše.
    // Kdyby countWithTimeout četl `err.code` přímo, dostal by undefined,
    // podmínka by byla vždy pravdivá, chyba by se vyhodila dál a uživatel
    // by místo přibližného počtu dostal 500. Test výše by to sice odhalil taky,
    // ale hlásil by "estimated !== exact", což na příčinu neukazuje.
    let caught: unknown;
    try {
      await withoutContext(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = 300`);
        await tx.execute(SLOW_COUNT);
      });
      expect.unreachable('dotaz měl být zrušen stropem');
    } catch (err) {
      caught = err;
    }
    expect(
      (caught as { code?: unknown }).code,
      'Drizzle chybu zabaluje, SQLSTATE na err.code NENÍ',
    ).toBeUndefined();
    expect(pgErrorCode(caught)).toBe('57014');
  }, 60_000);

  it('strop je 500 ms podle 4.3', () => {
    expect(COUNT_TIMEOUT_MS).toBe(500);
  });
});
