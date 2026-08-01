// @vitest-environment node
//
// Výchozí prostředí `apps/web` je jsdom (kvůli komponentním testům P05, P06
// a P12). Pro databázové testy nejde použít: v jsdom je `import.meta.url`
// adresa http, takže `fileURLToPath` v `packages/db/src/migrate.ts` skončí
// na "The URL must be of scheme file". A `migrate.ts` se natáhne při každém
// importu `@mlain/db`, tedy i skrz `@mlain/core/tx`. Anotace je per soubor,
// aby se nemuselo sahat do `vitest.config.ts`, který vlastní P01.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { withoutContext, closePools } from '@mlain/core/tx';
import { asMigrator, closeMigratorPool } from '@mlain/core/test-support/migrator';
import { buildPage, decodeCursor } from '../../src/lib/api/pagination';
import { startPgHarness, type PgHarness } from './pg-harness';

/**
 * Kritérium 33: stránkování přes celý seznam 10 000 položek po 50 vrátí každou
 * položku právě jednou i při souběžném vkládání nových. Testuje se na pomocné
 * tabulce, protože doménové tabulky vlastní jiné plány a tenhle test ověřuje
 * mechanismus, ne konkrétní zdroj.
 *
 * Příprava běží pod rolí `mlain_migrator`, ne pod aplikační rolí. `mlain_app`
 * má na schéma `public` jen USAGE a DML granty, žádné CREATE, takže
 * `CREATE SCHEMA` pod ní skončí na `permission denied for database` a kritérium
 * 33 by se nikdy neověřilo. Čtení uvnitř testu naopak zůstává pod `mlain_app`,
 * protože se testuje aplikační cesta.
 */
/**
 * Plán počítal s tím, že `created_at` z `tx.execute()` je `Date`, a volal na něm
 * `toISOString()`. Ověřeno spuštěním, že to neplatí: ovladač `node-postgres`
 * pod Drizzlem vrací `timestamptz` jako ŘETĚZEC, takže by test padl na
 * "r.created_at.toISOString is not a function". Hodnota se proto normalizuje
 * a obě podoby se snesou. Pro kurzor je to jedno, přetypování `::timestamptz`
 * si poradí s obojím.
 */
const isoOf = (value: string | Date): string =>
  value instanceof Date ? value.toISOString() : value;

describe('integrita kurzorového stránkování', () => {
  let harness: PgHarness;

  beforeAll(async () => {
    harness = await startPgHarness();
    await asMigrator(async (db) => {
      await db.query(`CREATE SCHEMA IF NOT EXISTS pagination_probe`);
      await db.query(`DROP TABLE IF EXISTS pagination_probe.items`);
      await db.query(`
        CREATE TABLE pagination_probe.items (
          id uuid PRIMARY KEY DEFAULT uuidv7(),
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await db.query(`
        INSERT INTO pagination_probe.items (created_at)
        SELECT now() - (g || ' seconds')::interval FROM generate_series(1, 10000) g
      `);
      await db.query(`
        CREATE INDEX idx_pagination_probe_items ON pagination_probe.items (created_at DESC, id DESC)
      `);
      // Bez grantu by aplikační role z pomocné tabulky nepřečetla nic a test
      // by hlásil prázdné stránkování místo chybějícího práva.
      await db.query(`GRANT USAGE ON SCHEMA pagination_probe TO mlain_app`);
      await db.query(`GRANT SELECT, INSERT ON pagination_probe.items TO mlain_app`);
    });
  }, 300_000);

  afterAll(async () => {
    await asMigrator((db) => db.query(`DROP SCHEMA IF EXISTS pagination_probe CASCADE`));
    await closeMigratorPool();
    await closePools();
    await harness?.stop();
  }, 120_000);

  it('projde 10 000 položek po 50 a každou vrátí právě jednou', async () => {
    const seen = new Set<string>();
    let cursor: { k: unknown[] } | null = null;
    let pages = 0;

    for (;;) {
      const current = cursor;
      const rows: Array<{ id: string; created_at: string | Date }> = await withoutContext(
        async (tx) => {
          const where = current
            ? sql`WHERE (created_at, id) < (${current.k[0]}::timestamptz, ${current.k[1]}::uuid)`
            : sql``;
          const result = await tx.execute<{ id: string; created_at: string | Date }>(sql`
              SELECT id::text AS id, created_at FROM pagination_probe.items
              ${where}
              ORDER BY created_at DESC, id DESC
              LIMIT 51
            `);
          return result.rows;
        },
      );

      const page = buildPage(rows, { limit: 50, order: 'created_at.desc' }, (r) => [
        isoOf(r.created_at),
        r.id,
      ]);
      for (const item of page.data) {
        expect(seen.has(item.id), `duplicitní položka ${item.id}`).toBe(false);
        seen.add(item.id);
      }
      pages += 1;

      // Souběžný zápis mezi stránkami: přesně ten případ, kvůli kterému offset selhává.
      // Nová položka má created_at = now(), tedy leží PŘED kurzorem, takže se do
      // procházení nedostane a zároveň nesmí posunout už načtené řádky.
      await withoutContext(async (tx) => {
        await tx.execute(sql`INSERT INTO pagination_probe.items (created_at) VALUES (now())`);
      });

      if (!page.pagination.next_cursor) break;
      cursor = decodeCursor(page.pagination.next_cursor, 'created_at.desc');
      expect(pages).toBeLessThan(300);
    }

    expect(seen.size).toBe(10000);
    expect(pages).toBe(200);
  }, 120_000);
});
