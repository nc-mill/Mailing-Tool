/**
 * Jediné místo v monorepu, které drží aplikační pool. NIC JINÉHO nedělá.
 *
 * Transakční logiku (BEGIN, set_config, Drizzle handle nad vyhrazeným spojením,
 * kontrola nezměněného kontextu, zahození rozbitého spojení) vlastní P03
 * a tenhle soubor ji NEOPAKUJE. Kdyby si ji P04 napsal znovu, byly by to dvě
 * implementace téhož a ta druhá by neměla ani kontrolu kontextu, ani
 * `release(true)` po neúspěšném ROLLBACK.
 *
 * Adaptér tedy řeší jedinou nepohodlnost: obálky P03 berou `pool` prvním
 * argumentem, protože `packages/db` žádný singleton nedrží a držet ho nemá.
 * Bez tohohle souboru by ho musel protahovat každý volající.
 *
 * Co se tu ZÁMĚRNĚ NEDĚLÁ:
 *   - nepřejmenovávají se obálky. `withoutContext` se jmenuje `withoutContext`.
 *     Dvě jména pro jednu funkci jsou zdroj rozporu.
 *   - nemění se typy. `Tx` je typ z `@mlain/db`, jen se reexportuje.
 *   - neobaluje se handle podruhé. `Tx` z P03 UŽ JE `NodePgDatabase`
 *     (jeho rozhodnutí R34), takže volat nad ním `drizzle()` by bylo obalení
 *     Drizzle do Drizzle.
 *   - nepíše se vlastní `pgErrorCode`. P03 ho exportuje a jeho verze pokrývá
 *     i chybu ze syrového `pool.query`, kde kód leží přímo na `error.code`.
 */
import type { Pool } from 'pg';
import {
  createPool,
  pgErrorCode,
  withReadOnly as dbWithReadOnly,
  withUser as dbWithUser,
  withWorkspace as dbWithWorkspace,
  withoutContext as dbWithoutContext,
  type ReadOnlyOptions,
  type Tx,
  type WorkspaceContext,
} from '@mlain/db';
import { loadConfig, type MlainConfig } from '../config/index';

/**
 * Transakční handle a čtení SQLSTATE se reexportují, aby doménové soubory
 * měly jednu adresu a nemusely sahat do `@mlain/db` kvůli typu.
 * Je to REEXPORT, ne druhá definice.
 */
export { pgErrorCode, type ReadOnlyOptions, type Tx, type WorkspaceContext };

/**
 * ODCHYLKA OD PLÁNU: plán psal `import { config } from '@mlain/core/config'`.
 * P01 žádný takový singleton neexportuje, vystavuje jen `loadConfig()`,
 * a je to správně: modul, který si konfiguraci načte při importu, nejde
 * naimportovat bez kompletního prostředí, takže by shodil každý jednotkový
 * test, který se ho jen dotkne. Konfigurace se proto čte líně a jednou.
 */
let configSingleton: MlainConfig | null = null;

function config(): MlainConfig {
  configSingleton ??= loadConfig();
  return configSingleton;
}

let appPoolSingleton: Pool | null = null;
let readOnlyPoolSingleton: Pool | null = null;

/** Aplikační pool. Vzniká při prvním použití, aby import modulu neotvíral spojení. */
export function appPool(): Pool {
  appPoolSingleton ??= createPool(config().DATABASE_URL, 'app', 10);
  return appPoolSingleton;
}

/** Pool s vynuceným default_transaction_read_only. Používá ho withReadOnly. */
export function readOnlyPool(): Pool {
  readOnlyPoolSingleton ??= createPool(config().DATABASE_URL, 'readOnly', 5);
  return readOnlyPoolSingleton;
}

/** Zavře oba pooly. Volá se při vypnutí procesu a v afterAll databázových testů. */
export async function closePools(): Promise<void> {
  const pools = [appPoolSingleton, readOnlyPoolSingleton].filter((p): p is Pool => p !== null);
  appPoolSingleton = null;
  readOnlyPoolSingleton = null;
  configSingleton = null;
  await Promise.all(pools.map((p) => p.end()));
}

/**
 * Transakce v kontextu projektu. Obálka P03 nastaví `mlain.workspace_id` vždy
 * a `mlain.user_id` u aktéra typu `user`, takže doménová služba NIKDY nevolá
 * `set_config` ručně. Po doběhnutí callbacku P03 ověří, že se kontext uvnitř
 * transakce nezměnil, a při neshodě transakci zruší.
 */
export function withWorkspace<T>(ctx: WorkspaceContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return dbWithWorkspace(appPool(), ctx, fn);
}

/**
 * Transakce jen s `mlain.user_id`, bez kontextu projektu. Pro dvě operace,
 * které kontext z principu nemají: výpis projektů aktéra a založení projektu (3.6).
 */
export function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return dbWithUser(appPool(), userId, fn);
}

/**
 * Transakce ÚPLNĚ BEZ kontextu, ani projekt, ani uživatel. Pro přihlašovací
 * cesty, ověření API klíče, přijetí pozvánky, rate limiting, čtení
 * `system_settings` při startu a první spuštění instalace.
 *
 * NEJSOU to zadní vrátka: bez kontextu vrátí dotaz na každé tabulce s RLS nula
 * řádků a zápis skončí chybou. Použitelná je nad tabulkami z `TABLES_WITHOUT_RLS`.
 */
export function withoutContext<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return dbWithoutContext(appPool(), fn);
}

/**
 * Transakce jen pro čtení s tvrdým stropem doby běhu a volitelným `work_mem`.
 *
 * `options` je objekt, ne holé číslo, právě kvůli `work_mem`: náhled segmentu
 * v P11 na něm stojí, protože bez něj se řazení nad velkým publikem přelije
 * na disk a strop vyprší dřív, než dotaz doběhne. Kdyby adaptér bral jen
 * `statementTimeoutMs`, neměl by P11 tu hodnotu kudy předat.
 */
export function withReadOnly<T>(
  ctx: WorkspaceContext,
  options: ReadOnlyOptions,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return dbWithReadOnly(readOnlyPool(), ctx, options, fn);
}
