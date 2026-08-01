// packages/db/src/repo/tx.ts
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool, PoolClient } from 'pg';
import type { WorkspaceContext } from '../context';
import * as schema from '../schema/index';

/**
 * Transakční handle. Je to DRIZZLE handle, ne syrový PoolClient (rozhodnutí R34).
 *
 * Syrový `pg.PoolClient` umí jen `client.query(text, params)`. Nemá `.select()`,
 * `.insert()` ani `.execute()`, takže by se proti němu nezkompilovala jediná
 * doménová funkce a padlo by to naráz v P04, P07, P10, P11, P13, P14 a P15.
 *
 * Handle se vyrábí obalením JEDNOHO vyhrazeného spojení, ne přes
 * `drizzle(pool).transaction()`. Ověřeno spuštěním a jsou pro to dva důvody:
 *   1. `drizzle(pool).transaction()` předá callbacku `NodePgTransaction`,
 *      ne `NodePgDatabase`, takže by neseděl typ, který deklaruje P04.
 *   2. Nad transakcí, kterou otevírá Drizzle, ztrácíme kontrolu nad spojením
 *      a nemůžeme po neúspěšném ROLLBACK zahodit rozbité spojení přes
 *      `release(true)`. To je ochrana, kterou tenhle plán mít musí: spojení
 *      vrácené do poolu s cizí otevřenou transakcí dostane další nájemce.
 */
export type Tx = NodePgDatabase<typeof schema>;

/**
 * POZOR na tvar výsledku. `tx.execute(sql`...`)` vrací OBÁLKU výsledku
 * (`pg.Result`), ne pole řádků. Ověřeno spuštěním: `Array.isArray(result)`
 * je `false` a řádky leží na `result.rows`.
 *
 * Vzor `const rows = await tx.execute(...) as unknown as Row[]` proto projde
 * typovou kontrolou i revizí a ZA BĚHU VRÁTÍ undefined při prvním `rows[0]`.
 * Správně je vždycky `const { rows } = await tx.execute(...)`.
 */

/** Kolik smí trvat dotaz a kolik paměti dostane na řazení a hash spojení. */
export type ReadOnlyOptions = {
  statementTimeoutMs: number;
  /**
   * Volitelný work_mem, například '64MB'. Náhled segmentu na něm stojí:
   * bez něj se řazení nad velkým publikem přelije na disk a tvrdý strop
   * doby běhu vyprší dřív, než dotaz doběhne (požadavek P11, 3.6).
   */
  workMem?: string;
};

/**
 * SET LOCAL NEJDE parametrizovat, hodnota se do příkazu vkládá textem.
 * Bez téhle kontroly by `workMem` z konfigurace nebo z požadavku byl
 * přímá cesta k injekci do příkazu, který běží pod aplikační rolí.
 */
function assertSafeWorkMem(value: string): void {
  if (!/^\d{1,6}(kB|MB|GB)$/.test(value)) {
    throw new Error(`work_mem '${value}' nemá povolený tvar, například '64MB'`);
  }
}

/**
 * Společné jádro všech obálek. Drží tři věci, které se nesmí opakovat
 * v každé z nich zvlášť, protože by se rozešly:
 *   - vyhrazené spojení a jeho úklid, včetně zahození rozbitého spojení,
 *   - Drizzle handle nad tím jedním spojením,
 *   - kontrola, že se kontext uvnitř transakce nezměnil.
 */
async function runInTransaction<T>(
  pool: Pool,
  begin: string,
  setup: (tx: Tx, client: PoolClient) => Promise<void>,
  expectedWorkspaceId: string | null,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  const tx = drizzle(client, { schema, casing: 'snake_case' }) as Tx;
  let broken = false;
  try {
    await client.query(begin);
    await setup(tx, client);
    const result = await fn(tx);
    if (expectedWorkspaceId !== null) {
      await assertContextUnchanged(client, expectedWorkspaceId);
    }
    await client.query('COMMIT');
    return result;
  } catch (error) {
    // Když ROLLBACK selže, je spojení v neznámém stavu a NESMÍ se vrátit
    // do poolu: další nájemce by dostal transakci a kontext předchozího.
    // client.release(true) ho zahodí a pool otevře nové.
    try {
      await client.query('ROLLBACK');
    } catch {
      broken = true;
    }
    throw error;
  } finally {
    client.release(broken || undefined);
  }
}

/**
 * Ověří, že se kontext uvnitř transakce nezměnil.
 *
 * `SET LOCAL` uvnitř transakce nikdo nezakáže, ani v režimu READ ONLY.
 * U cest, které spouštějí dynamicky sestavené SQL (náhled segmentu), by tedy
 * injekce mohla přepnout kontext na cizí projekt a přečíst cizí data.
 * Kontrola po doběhnutí callbacku je poslední místo, kde to jde zachytit
 * dřív, než výsledek opustí tuhle funkci: transakce se rollbackne a volající
 * dostane chybu, ne data.
 *
 * Chytá i druhý případ, na který by nikdo nemyslel: kdyby volající uvnitř
 * zavolal `tx.transaction()`, Drizzle by poslal vlastní BEGIN a COMMIT
 * a předčasně by potvrdil NAŠI transakci. Po takovém commitu je hodnota
 * ze `SET LOCAL` pryč (vrací prázdný řetězec, viz R21), takže se to tady
 * projeví jako změněný kontext a transakce se zruší.
 */
async function assertContextUnchanged(client: PoolClient, expected: string): Promise<void> {
  const { rows } = await client.query<{ w: string | null }>(
    `SELECT NULLIF(current_setting('mlain.workspace_id', true), '') AS w`,
  );
  // Chybějící řádek je stejně podezřelý jako změněná hodnota, takže se bere
  // jako změna kontextu a transakce padá. Tichá varianta by tady byla horší.
  const seen = rows[0]?.w ?? null;
  if (seen !== expected) {
    throw new Error(
      `kontext projektu se uvnitř transakce změnil z ${expected} na ${seen}; ` +
        'transakce se ruší a výsledek se nevydává',
    );
  }
}

/**
 * Otevře transakci a nastaví mlain.workspace_id na dobu jejího trvání.
 * Třetí argument set_config je `true`, tedy SET LOCAL: hodnota platí do konce
 * transakce a nepřenese se na další dotaz ze stejného spojení v poolu.
 *
 * Bez transakce se dotaz nespustí a repository vrstva ji vždy otevírá.
 */
export async function withWorkspace<T>(
  pool: Pool,
  ctx: WorkspaceContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return runInTransaction(
    pool,
    'BEGIN',
    async (_tx, client) => {
      await client.query(`SELECT set_config('mlain.workspace_id', $1, true)`, [ctx.workspaceId]);
      if (ctx.actor.type === 'user') {
        await client.query(`SELECT set_config('mlain.user_id', $1, true)`, [ctx.actor.userId]);
      }
    },
    ctx.workspaceId,
    fn,
  );
}

/**
 * Transakce BEZ workspace kontextu, jen s mlain.user_id. Existuje pro dvě
 * operace nad workspaces, které kontext z principu nemají: výpis projektů
 * aktéra (kontextů je víc než jeden) a založení projektu (kontext ještě
 * neexistuje). Používají ji jen repo/workspaces-global.ts a repo/audit-global.ts.
 *
 * mlain.user_id nastavuje výhradně už ověřená session, NIKDY hodnota
 * z requestu. Kdo ho nenastaví, nevidí nic, protože current_setting(..., true)
 * vrátí NULL.
 */
export async function withUser<T>(
  pool: Pool,
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return runInTransaction(
    pool,
    'BEGIN',
    async (_tx, client) => {
      await client.query(`SELECT set_config('mlain.user_id', $1, true)`, [userId]);
    },
    null,
    fn,
  );
}

/**
 * Transakce ÚPLNĚ BEZ kontextu: ani projekt, ani uživatel.
 *
 * Je pro cesty, které žádného aktéra nemají a mít nemůžou: přihlášení
 * (čte `users`, zapisuje `sessions`), rate limiting nad `rate_limits`,
 * čtení `system_settings` při startu a migrační a údržbové joby.
 *
 * NENÍ to zadní vrátka. Kontext se nenastaví, takže na každé tabulce s RLS
 * vrátí dotaz NULA ŘÁDKŮ a zápis skončí chybou row-level security. Použitelná
 * je výhradně nad tabulkami z TABLES_WITHOUT_RLS. Ověřeno spuštěním: pod rolí
 * bez kontextu vrátí `SELECT` z `contacts` nula řádků, zatímco `rate_limits`
 * čte i zapisuje normálně.
 *
 * Tohle je ta varianta, kterou P04 čeká pod jménem `withoutContext`
 * a bez které si každý volající vyráběl vlastní obcházku.
 */
export async function withoutContext<T>(pool: Pool, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runInTransaction(
    pool,
    'BEGIN',
    async () => {
      /* žádný kontext */
    },
    null,
    fn,
  );
}

/**
 * Transakce jen pro čtení s tvrdým stropem doby běhu. Používá ji náhled
 * segmentu, který spouští dynamicky sestavené SQL: chyba v kompilátoru nesmí
 * mít možnost zapsat. Strop 3 s spoléhá na chybu 57014 query_canceled.
 *
 * Ověřeno spuštěním, že `SET LOCAL work_mem` i `SET LOCAL statement_timeout`
 * uvnitř `BEGIN READ ONLY` skutečně platí a po commitu se hodnota vrací
 * na původní. READ ONLY zakazuje zápis, ne nastavování parametrů.
 */
export async function withReadOnly<T>(
  pool: Pool,
  ctx: WorkspaceContext,
  options: ReadOnlyOptions,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (options.workMem !== undefined) assertSafeWorkMem(options.workMem);
  return runInTransaction(
    pool,
    'BEGIN READ ONLY',
    async (_tx, client) => {
      await client.query(`SET LOCAL statement_timeout = ${Math.trunc(options.statementTimeoutMs)}`);
      if (options.workMem !== undefined) {
        await client.query(`SET LOCAL work_mem = '${options.workMem}'`);
      }
      await client.query(`SELECT set_config('mlain.workspace_id', $1, true)`, [ctx.workspaceId]);
    },
    ctx.workspaceId,
    fn,
  );
}

/**
 * Kód chyby PostgreSQL, ať přišla odkudkoli (rozhodnutí R35).
 *
 * Ověřeno spuštěním na drizzle-orm 0.44 a pg 8.22 a je to past, na kterou
 * se nedá přijít čtením:
 *   - chyba z Drizzle je `DrizzleQueryError`, kde je `error.code`
 *     **undefined** a kód `23505` leží na `error.cause.code`;
 *   - chyba ze syrového `pool.query` má kód přímo na `error.code`
 *     a žádné `cause` nemá.
 *
 * Každé ošetření kolize napsané jen podle jednoho z těch dvou vzorů se tedy
 * NIKDY neprovede a projde přitom typovou kontrolou i revizí. Proto jeden
 * pomocník a žádné přímé sahání na `code`.
 */
export function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === 'string') return direct;
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause === 'object' && cause !== null) {
    const nested = (cause as { code?: unknown }).code;
    if (typeof nested === 'string') return nested;
  }
  return undefined;
}
