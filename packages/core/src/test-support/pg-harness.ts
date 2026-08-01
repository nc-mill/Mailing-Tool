/**
 * PostgreSQL 18 pro databázové testy. NENÍ součástí produkční cesty.
 *
 * ODCHYLKA OD PLÁNU, a je vědomá. Kapitola 0.9 plánu P04 počítá s příkazy
 * `pnpm --filter @mlain/core test:db` a `--filter @mlain/web test:db` a s tím,
 * že `DATABASE_URL` i `DATABASE_URL_MIGRATOR` už v prostředí jsou. Ani jeden
 * balíček ale takový skript nemá a projekty `unit`/`db` ve `vitest.config.ts`
 * taky ne. Obojí leží v souborech, které vlastní P01, a výjimka 0.3 plánu P04
 * dovoluje v `packages/core/package.json` sáhnout jen na `dependencies`
 * a `exports`, na `scripts` výslovně NE.
 *
 * Kontejner si proto zakládají testy samy a tenhle pomocník drží ten kód na
 * jednom místě. Tři kopie téhož bootstrapu (tx, apps/web, identity) by se
 * rozešly a rozdíl by se projevil jako záhadně padající test v jednom balíčku.
 *
 * Dělá přesně to, co `docker/initdb` v produkci: šest rolí, vlastnictví
 * schématu migrátorem a migrace pod `mlain_migrator`. Aplikační spojení jde
 * pod `mlain_app`, tedy pod rolí, na kterou RLS dopadá; pod vlastníkem
 * schématu by testy izolace byly falešně zelené.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { runMigrations } from '@mlain/db/migrate';

/** Role z `docker/initdb`. Migrace 0004 a 0005 je potřebují všechny. */
export const HARNESS_ROLES = [
  'mlain_migrator',
  'mlain_app',
  'mlain_sender',
  'mlain_gdpr',
  'mlain_maintenance',
  'mlain_backup',
] as const;

export type PgHarness = {
  /** URL pod rolí `mlain_app`, tedy to, co dostane `DATABASE_URL`. */
  appUrl: string;
  /** URL pod rolí `mlain_migrator`, tedy `DATABASE_URL_MIGRATOR`. */
  migratorUrl: string;
  host: string;
  port: number;
  stop: () => Promise<void>;
};

export type PgHarnessOptions = {
  /** false = databáze zůstane bez migrací, pro testy samotného runneru. */
  migrate?: boolean;
  /**
   * Založit měsíční oddíly. VÝCHOZÍ JE `true` a měnit to skoro nikdy nechceš.
   *
   * Devět tabulek je partitionovaných podle měsíce (`audit_log`,
   * `webhook_events`, `webhook_deliveries`, `messages`, `message_events`,
   * a další) a výchozí oddíl je podle P03 ZÁMĚRNĚ zakázaný. Bez oddílu pro
   * aktuální měsíc skončí každý zápis na „no partition of relation audit_log
   * found for row", což je hláška, která na příčinu vůbec neukazuje.
   *
   * Dřív tu bylo natvrdo `false`, opsané z `packages/db/test/global-setup.ts`.
   * Tam to dává smysl, protože jde o SDÍLENOU předmigrovanou šablonu, kterou
   * si každý test klonuje, a oddíly založené v době stavby šablony by na
   * přelomu měsíce zestárly. Tenhle harness ale startuje čerstvý kontejner na
   * každý soubor a oddíly se počítají z `new Date()` až při startu, takže
   * zestarat nemají jak. Nález od P04-B, ověřeno spuštěním.
   */
  partitions?: boolean;
};

export async function startPgHarness(options: PgHarnessOptions = {}): Promise<PgHarness> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase('mlain')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);

  const su = new Client({ host, port, database: 'mlain', user: 'postgres', password: 'postgres' });
  await su.connect();
  for (const role of HARNESS_ROLES) {
    await su.query(`CREATE ROLE ${role} LOGIN PASSWORD '${role}'`);
  }
  // Migrátor vlastní schéma. Bez vlastnictví na něj RLS nedopadá.
  await su.query(`ALTER SCHEMA public OWNER TO mlain_migrator`);
  await su.query(`GRANT CREATE, USAGE ON SCHEMA public TO mlain_migrator`);
  // Bez práva CREATE na DATABÁZI neprojde `CREATE SCHEMA drizzle` v runneru.
  await su.query(`GRANT CREATE ON DATABASE mlain TO mlain_migrator`);
  await su.end();

  const migratorUrl = `postgres://mlain_migrator:mlain_migrator@${host}:${port}/mlain`;
  const appUrl = `postgres://mlain_app:mlain_app@${host}:${port}/mlain`;

  if (options.migrate ?? true) {
    // Oddíly zakládá runner P03 sám (`ensureUpcomingPartitions(new Date(), 4)`),
    // a to pod migrátorem, tedy pod rolí, která smí DDL. Aplikační role schéma
    // nevlastní a `CREATE TABLE ... PARTITION OF` by pod ní skončila na
    // `permission denied` (kapitola 0.9).
    await runMigrations({ url: migratorUrl, ensurePartitions: options.partitions ?? true });
  }

  applyHarnessEnv({ appUrl, migratorUrl });

  return {
    appUrl,
    migratorUrl,
    host,
    port,
    stop: async () => {
      await container.stop();
    },
  };
}

/**
 * Nastaví prostředí, které čeká `loadConfig()`. Konfigurace se v `tx/index.ts`
 * čte líně, takže stačí, když je hotové dřív, než se otevře první transakce.
 *
 * `MODE` se přepisuje NATVRDO a je to nutné, ne opatrnost. Ověřeno spuštěním:
 * vitest si do `process.env.MODE` dosadí vlastní režim Vite, tedy `"test"`,
 * a přepíše i hodnotu zadanou v prostředí (`MODE=web pnpm vitest run` skončí
 * uvnitř testu s `MODE === "test"`). P01 má přitom `MODE` jako
 * `z.enum(['web','worker','sender','all'])`, takže by `loadConfig()` spadl
 * KAŽDÉMU testu, který se konfigurace dotkne. Přiřazení za běhu je proti tomu
 * spolehlivé, protože běží až po vitestu.
 *
 * `NODE_ENV` jde přes `Object.assign`, protože ho `@types/node` deklaruje
 * jako readonly a přímé přiřazení neprojde typovou kontrolou.
 */
export function applyHarnessEnv(urls: { appUrl: string; migratorUrl: string }): void {
  process.env['APP_URL'] ??= 'https://mlain.test';
  process.env['SECRET_KEY'] ??= `1:${Buffer.alloc(32, 7).toString('base64url')}`;
  process.env['DATA_DIR'] ??= '/tmp';
  process.env['MODE'] = 'web';
  Object.assign(process.env, { NODE_ENV: 'test' });
  process.env['DATABASE_URL'] = urls.appUrl;
  process.env['DATABASE_URL_MIGRATOR'] = urls.migratorUrl;
}
