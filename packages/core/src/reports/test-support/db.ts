import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '@mlain/db/schema';
import { unsafeWorkspaceContext } from '@mlain/db/unsafe-context';
import { startPgHarness, type PgHarness } from '../../test-support/pg-harness';
import type { Tx, WorkspaceContext } from '../../tx';

export type TestDatabase = {
  pool: Pool;
  url: string;
  stop: () => Promise<void>;
};

/**
 * Databáze pro testy reportů.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM. Plán počítal s vlastním kontejnerem
 * na testovací soubor (`new PostgreSqlContainer(...)` přímo tady). Rozhodnutí
 * R31 plánu P03 to mezitím obrátilo: `packages/core/vitest.config.ts` má
 * `globalSetup`, který nastartuje JEDEN server na celý běh a zmigruje šablonu
 * `mlain_template`. `startPgHarness()` z něj klonuje vlastní databázi příkazem
 * `CREATE DATABASE ... TEMPLATE`, tedy v desítkách milisekund a s úplnou
 * izolací mezi soubory. Vlastní kontejner na soubor by při souběhu balíčků
 * znamenal desítky databázových serverů a tutéž sadu migrací přehranou
 * pokaždé znovu.
 *
 * Pool jde pod rolí `mlain_migrator` schválně. Čtecí funkce reportů filtrují
 * projekt explicitně přes `workspace_id = ctx.workspaceId`, takže izolaci
 * v testu prokazuje ta podmínka, ne RLS. Fixtures navíc zakládají měsíční
 * oddíly, což je DDL a aplikační role na něj právo nemá.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const harness: PgHarness = await startPgHarness();
  const pool = new Pool({
    connectionString: harness.migratorUrl,
    max: 4,
    options: '-c timezone=UTC',
  });

  return {
    pool,
    url: harness.migratorUrl,
    stop: async () => {
      await pool.end();
      await harness.stop();
    },
  };
}

/**
 * Transakční handle pro testy.
 *
 * `Tx` je od rozhodnutí R34 v P03 `NodePgDatabase<typeof schema>`, tedy přímo
 * Drizzle handle. Žádné přetypování se tu proto neděje a dít nesmí: kdyby
 * `drizzle(...)` skutečnému typu neodpovídal, má to spadnout tady a ne až
 * v provozu na `tx.execute is not a function`.
 *
 * POZOR na tvar výsledku. `tx.execute(sql`...`)` vrací OBÁLKU (`pg.Result`),
 * ne pole. Vzor `await tx.execute(...) as unknown as Row[]` projde typovou
 * kontrolou i revizí a při prvním `rows[0]` vrátí `undefined`. Správně je
 * vždycky `const { rows } = await tx.execute(...)`.
 */
export function createTestTx(db: TestDatabase): Tx {
  return drizzle(db.pool, { schema });
}

/**
 * Kontext projektu pro testy (R23). Branded typ má jedinou továrnu a ta je
 * `unsafeWorkspaceContext`. Zápis `{ workspaceId } as WorkspaceContext` by
 * prošel typovou kontrolou, ale vyrobil by objekt **bez `actor`**, na kterém
 * `withWorkspace` z P03 spadne až za běhu při čtení `ctx.actor.type`.
 */
export function testContext(workspaceId: string): WorkspaceContext {
  return unsafeWorkspaceContext(workspaceId, { type: 'system', job: 'reports.test' });
}
