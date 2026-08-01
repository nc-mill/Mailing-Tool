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
 *
 * JEDEN KONTEJNER NA CELÝ BĚH (rozhodnutí R31 plánu P03). Dřív startovalo
 * `startPgHarness()` vlastní kontejner při KAŽDÉM zavolání a volá ho 23
 * testovacích souborů, takže jeden běh balíčku znamenal 23 databázových
 * serverů a 23krát přehranou tutéž sadu migrací. Naměřeno: při souběhu víc
 * balíčků vyskočil počet kontejnerů na 74 a zátěž stroje na 29.
 *
 * Dnes má funkce dvě cesty a rozhoduje mezi nimi to, jestli běh má
 * `globalSetup`, který sdílený server ohlásil:
 *
 *  1. SDÍLENÝ SERVER (`packages/core`, viz `global-setup.ts` vedle). Kontejner
 *     už běží, role existují a šablona `mlain_template` je zmigrovaná. Soubor
 *     dostane VLASTNÍ databázi příkazem `CREATE DATABASE ... TEMPLATE`, což je
 *     otázka desítek milisekund. `TEMPLATE` kopíruje tabulky, politiky RLS
 *     I granty, takže izolace mezi soubory zůstává úplná; ověřeno spuštěním,
 *     protože bez grantů by testy oprávnění byly falešně zelené.
 *  2. VLASTNÍ KONTEJNER (`apps/web`, který tenhle modul reexportuje a vlastní
 *     `globalSetup` nemá; ten soubor leží mimo rozsah téhle změny). Chová se
 *     přesně jako dřív: čerstvý kontejner, šest rolí, migrace, jedna databáze.
 */
import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { inject } from 'vitest';
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

/**
 * Předmigrovaná šablona na sdíleném serveru. Zakládá ji `global-setup.ts`,
 * testovací soubory si z ní klonují vlastní databázi.
 */
export const TEMPLATE_DB = 'mlain_template';

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
   * Na sdíleném serveru nese oddíly rovnou šablona, takže je klon dostane
   * zadarmo. Zestarat nemají jak: `ensureUpcomingPartitions` zakládá aktuální
   * měsíc a tři dopředu a šablona žije jen po dobu jednoho běhu.
   */
  partitions?: boolean;
};

export async function startPgHarness(options: PgHarnessOptions = {}): Promise<PgHarness> {
  const server = sharedServer();
  return server === null ? startOwnContainer(options) : startOnSharedServer(server, options);
}

/**
 * Host a port sdíleného serveru z `globalSetup`, nebo null, když žádný není.
 *
 * `inject()` čte kontext, který dodal `globalSetup` běhu. V `apps/web` žádný
 * takový `globalSetup` není, takže vrátí `undefined`; mimo běžícího workera
 * vitestu (což se nemá stát, harness se volá z `beforeAll`) umí i vyhodit
 * chybu, proto try/catch. Obojí znamená totéž: sdílený server není, postará
 * se o sebe volající sám.
 *
 * Typ `inject` se tu schválně uvolňuje na `(key: string) => unknown`. Klíče
 * `corePgHost` a `corePgPort` deklaruje `global-setup.ts` rozšířením
 * `ProvidedContext`, jenže ten soubor je součástí typové kontroly jen
 * v `packages/core`. `apps/web` tenhle modul reexportuje a jeho `tsc` tu
 * deklaraci nevidí, takže by na přesně typovaném `inject('corePgHost')`
 * spadl na neznámý klíč. Hodnoty se stejně kontrolují za běhu.
 */
const injectProvided = inject as unknown as (key: string) => unknown;

function sharedServer(): { host: string; port: number } | null {
  try {
    const host = injectProvided('corePgHost');
    const port = injectProvided('corePgPort');
    if (typeof host !== 'string' || typeof port !== 'number') return null;
    return { host, port };
  } catch {
    return null;
  }
}

let databaseCounter = 0;

/** Vlastní databáze na sdíleném serveru, ve výchozím stavu klon šablony. */
async function startOnSharedServer(
  server: { host: string; port: number },
  options: PgHarnessOptions,
): Promise<PgHarness> {
  const { host, port } = server;
  const migrate = options.migrate ?? true;
  const partitions = options.partitions ?? true;
  // Šablona je zmigrovaná VČETNĚ oddílů. Kdo si vyžádá jinou kombinaci, musí
  // dostat databázi stavěnou na míru, jinak by ta volba tiše nic neznamenala.
  const fromTemplate = migrate && partitions;
  // Náhodný konec jména je pojistka, ne ozdoba. Vitest pouští soubory v jednom
  // procesu za sebou a s výchozím `isolate: true` dostane každý soubor čerstvý
  // modul, takže se čítač vrátí na nulu. Kdyby některý soubor svou databázi
  // neuklidil, další by narazil na „database already exists" a hlásil by úplně
  // jinou chybu, než jaká se stala.
  const database = `mlain_t${process.pid}_${(databaseCounter += 1)}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;

  const su = await superuser(host, port);
  try {
    await su.query(
      fromTemplate
        ? `CREATE DATABASE ${database} TEMPLATE ${TEMPLATE_DB}`
        : `CREATE DATABASE ${database}`,
    );
    // Bez práva CREATE na DATABÁZI neprojde `CREATE SCHEMA drizzle` v runneru.
    await su.query(`GRANT CREATE ON DATABASE ${database} TO mlain_migrator`);
  } finally {
    await su.end();
  }

  if (!fromTemplate) await giveSchemaToMigrator(host, port, database);

  const urls = harnessUrls(host, port, database);
  if (!fromTemplate && migrate) {
    await runMigrations({ url: urls.migratorUrl, ensurePartitions: partitions });
  }

  applyHarnessEnv(urls);

  return {
    ...urls,
    host,
    port,
    stop: async () => {
      const admin = await superuser(host, port);
      try {
        // FORCE ukončí spojení, která test nezavřel. Bez něj by DROP čekal
        // do vypršení hooku a spadl by na „database is being accessed".
        await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      } finally {
        await admin.end();
      }
    },
  };
}

/**
 * Vlastní kontejner pro jeden harness. Cesta pro balíčky bez `globalSetup`.
 * Je to původní chování, beze změny.
 */
async function startOwnContainer(options: PgHarnessOptions): Promise<PgHarness> {
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

  const urls = harnessUrls(host, port, 'mlain');

  if (options.migrate ?? true) {
    // Oddíly zakládá runner P03 sám (`ensureUpcomingPartitions(new Date(), 4)`),
    // a to pod migrátorem, tedy pod rolí, která smí DDL. Aplikační role schéma
    // nevlastní a `CREATE TABLE ... PARTITION OF` by pod ní skončila na
    // `permission denied` (kapitola 0.9).
    await runMigrations({ url: urls.migratorUrl, ensurePartitions: options.partitions ?? true });
  }

  applyHarnessEnv(urls);

  return {
    ...urls,
    host,
    port,
    stop: async () => {
      await container.stop();
    },
  };
}

function harnessUrls(
  host: string,
  port: number,
  database: string,
): { appUrl: string; migratorUrl: string } {
  return {
    migratorUrl: `postgres://mlain_migrator:mlain_migrator@${host}:${port}/${database}`,
    appUrl: `postgres://mlain_app:mlain_app@${host}:${port}/${database}`,
  };
}

async function superuser(host: string, port: number): Promise<Client> {
  const client = new Client({
    host,
    port,
    database: 'postgres',
    user: 'postgres',
    password: 'postgres',
  });
  await client.connect();
  return client;
}

/**
 * Vlastnictví schématu migrátorem v čerstvé, NEklonované databázi. U klonu
 * šablony to řešit netřeba, `CREATE DATABASE ... TEMPLATE` vlastnictví kopíruje.
 */
async function giveSchemaToMigrator(host: string, port: number, database: string): Promise<void> {
  const fresh = new Client({ host, port, database, user: 'postgres', password: 'postgres' });
  await fresh.connect();
  try {
    await fresh.query(`ALTER SCHEMA public OWNER TO mlain_migrator`);
    await fresh.query(`GRANT CREATE, USAGE ON SCHEMA public TO mlain_migrator`);
  } finally {
    await fresh.end();
  }
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
