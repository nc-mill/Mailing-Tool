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
 * Dělá přesně to, co `docker/initdb` v produkci: šest rolí, vlastnictví
 * schématu migrátorem a migrace pod `mlain_migrator`. Aplikační spojení jde
 * pod `mlain_app`, tedy pod rolí, na kterou RLS dopadá; pod vlastníkem
 * schématu by testy izolace byly falešně zelené.
 *
 * JEDEN KONTEJNER NA CELÝ STROJ, ne na běh a už vůbec ne na soubor.
 *
 * Vývoj toho čísla je naměřený, ne odhadnutý. Původně startoval harness vlastní
 * kontejner při KAŽDÉM zavolání, a volá ho přes dvacet testovacích souborů:
 * jeden běh `packages/core` znamenal 23 kontejnerů, 49 přehrání téže sady
 * migrací a při souběhu víc agentů 74 kontejnerů a zátěž stroje 29. Pak byl
 * kontejner jeden na běh, jenže agentů běží pět, takže jich na stroji bylo
 * pět až deset. Dnes je jeden na celý stroj: jmenuje se `mlain-test-pg`
 * a sdílí ho každý běh vitestu, který tenhle modul použije.
 *
 * Sdílený je ale JEN KONTEJNER. Každý testovací soubor si dál bere VLASTNÍ
 * databázi z předmigrované šablony přes `CREATE DATABASE ... TEMPLATE`
 * (rozhodnutí R31 plánu P03), takže izolace zůstává úplná: `TEMPLATE` kopíruje
 * tabulky, politiky RLS I granty. Ověřeno spuštěním, ne odvozeno; bez grantů
 * by testy oprávnění byly falešně zelené.
 *
 * TŘI VĚCI, KTERÉ SDÍLENÍ MEZI BĚHY VYNUCUJE a bez kterých by to tiše lhalo:
 *
 *  1. Kontejner NIKDO nezastavuje. `stop()` na harnessu zahazuje jen svou
 *     databázi. Kdyby ho zastavoval každý běh, sebral by ho ostatním uprostřed
 *     práce. `ryuk` ho taky neuklidí, a je to schválně: testcontainers dává
 *     session label jen kontejnerům BEZ `withReuse()`, s reuse ho vynechá.
 *     Úklid je tedy ruční, viz `tools/dev/uklizec-kontejneru.sh`.
 *  2. Šablona je adresovaná OBSAHEM migrací, ne pevným jménem. Kontejner žije
 *     dýl než jedna sada migrací a plán P03 rozhodnutím R39 mění migrace NA
 *     MÍSTĚ, ne novým souborem. Šablona pojmenovaná natvrdo by tedy po úpravě
 *     0001 zůstala stará a testy by běžely nad neaktuálním schématem, aniž by
 *     cokoli spadlo. Jméno proto nese otisk obsahu `packages/db/migrations`.
 *  3. Bootstrap běží pod výhradním poradním zámkem a všechno v něm je
 *     PODMÍNĚNÉ. Pět agentů startuje naráz a druhé `CREATE ROLE mlain_app`
 *     nebo druhé `CREATE DATABASE` by spadlo.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { getContainerRuntimeClient } from 'testcontainers';
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
 * Jméno sdíleného kontejneru. Podle něj ho harness najde, když už běží, takže
 * druhý běh nestartuje druhý server.
 *
 * NENÍ to `mlain-dev-pg`. Ten na portu 55432 je vývojová databáze, na které
 * běží aplikace, a testy na ni nesmí sáhnout.
 */
export const SHARED_CONTAINER_NAME = 'mlain-test-pg';

/** Předpona šablon. Za ní jde otisk migrací, viz `templateDatabase()`. */
export const TEMPLATE_DB_PREFIX = 'mlain_tpl_';

/**
 * Poradní zámek nad databází `postgres`. Drží ho ten, kdo staví role a šablonu,
 * aby to pět souběžných agentů nedělalo pětkrát naráz. Session-scoped, takže se
 * pustí i při pádu procesu; to je jeho hlavní výhoda proti zámkové tabulce.
 *
 * Hodnota je o jedna vedle `MIGRATION_ADVISORY_LOCK_ID` z `@mlain/db/migrate`,
 * schválně: jsou to dva různé zámky a nesmí se potkat.
 */
const BOOTSTRAP_LOCK_ID = 7264150402;

/**
 * Složka s migracemi. Relativní cesta napříč balíčky je tu vědomá: `@mlain/db`
 * svou složku migrací v `exports` nevystavuje a ten soubor vlastní P03. Kdyby
 * se rozpadlo uspořádání monorepa, spadne to hlasitě už při stavbě šablony.
 */
const MIGRATIONS_DIR = fileURLToPath(new URL('../../../db/migrations', import.meta.url));

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
   * Oddíly nese rovnou šablona, takže je klon dostane zadarmo.
   */
  partitions?: boolean;
};

export async function startPgHarness(options: PgHarnessOptions = {}): Promise<PgHarness> {
  const server = injectedServer() ?? (await ensureSharedServer());
  return startOnServer(server, options);
}

export type PgServer = { host: string; port: number };

/**
 * Sdílený server pro celý stroj. Slib je uložený v modulu, takže dva testovací
 * soubory v jednom procesu nespustí hledání dvakrát; druhý si počká na tentýž.
 */
let sharedServerStart: Promise<PgServer> | undefined;

export function ensureSharedServer(): Promise<PgServer> {
  sharedServerStart ??= startSharedServer();
  return sharedServerStart;
}

async function startSharedServer(): Promise<PgServer> {
  const server = (await findRunningContainer()) ?? (await createSharedContainer());
  await waitForServer(server);
  await ensureBootstrap(server);
  return server;
}

/**
 * Najde běžící kontejner podle JMÉNA, ne podle hashe konfigurace.
 *
 * `withReuse()` páruje kontejnery přes label s hashem `createOpts`, což je
 * křehké přesně v týhle situaci: pět agentů může mít v pracovní kopii různě
 * starou verzi tohohle souboru, hash by se lišil a druhý běh by místo připojení
 * spadl na „name is already in use". Jméno je proti tomu stabilní.
 */
async function findRunningContainer(): Promise<PgServer | null> {
  const client = await getContainerRuntimeClient();
  // `all: true` je nutné, ne opatrnost: `client.container.list()` vrací jen
  // BĚŽÍCÍ kontejnery, jenže zastavený kontejner drží jméno dál. Bez tohohle
  // by pokus o založení skončil na konfliktu jména, přestože stačí ten, co už
  // existuje, nastartovat.
  const containers = await client.container.dockerode.listContainers({ all: true });
  const found = containers.find((c) =>
    c.Names.some((name) => name.replace(/^\//, '') === SHARED_CONTAINER_NAME),
  );
  if (found === undefined) return null;

  const handle = client.container.getById(found.Id);
  if (found.State !== 'running') {
    await client.container.start(handle);
  }
  const inspected = await client.container.inspect(handle);
  const binding = inspected.NetworkSettings.Ports['5432/tcp']?.[0];
  if (binding === undefined) return null;
  return { host: client.info.containerRuntime.host, port: Number(binding.HostPort) };
}

async function createSharedContainer(): Promise<PgServer> {
  try {
    // `withReuse()` je tu i kvůli úklidu, ne jen kvůli sdílení: BEZ něj dá
    // testcontainers kontejneru session label a `ryuk` ho zabije, jakmile
    // skončí proces, který ho založil. Ostatním agentům by zmizel pod rukama.
    const container = await new PostgreSqlContainer('postgres:18-alpine')
      .withName(SHARED_CONTAINER_NAME)
      .withDatabase('postgres')
      .withUsername('postgres')
      .withPassword('postgres')
      // Jeden server obsluhuje všechny běhy na stroji naráz. Pět agentů po
      // třech vláknech, každé s aplikačním poolem (10 spojení), read-only
      // poolem (5) a migrátorským poolem, dá k pěti stovkám. Výchozích 100
      // by došlo a testy by padaly na „too many connections", což je hláška,
      // která na příčinu neukazuje.
      //
      // Přepínače trvanlivosti jsou bezpečné právě proto, že jde o testovací
      // databázi: po pádu kontejneru se nemá co obnovovat, kontejner se
      // zahazuje. Ušetřený zápis na disk je přitom to, co sérii nejvíc zrychlí.
      .withCommand([
        'postgres',
        '-c',
        'max_connections=400',
        '-c',
        'fsync=off',
        '-c',
        'synchronous_commit=off',
        '-c',
        'full_page_writes=off',
      ])
      .withReuse()
      .start();
    return { host: container.getHost(), port: container.getMappedPort(5432) };
  } catch (error) {
    // Závod mezi procesy. `withReuse()` má zámek jen uvnitř procesu, takže dva
    // agenti můžou začít stavět naráz; ten druhý dostane od Dockeru konflikt
    // jména a správná odpověď je připojit se k tomu, co mezitím vzniklo.
    if (!isNameConflict(error)) throw error;
    const running = await findRunningContainer();
    if (running === null) throw error;
    return running;
  }
}

function isNameConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already in use|Conflict/i.test(message);
}

/**
 * Počká, až server přijme spojení. Když se harness připojuje k cizímu
 * kontejneru, který někdo právě založil, nemá vlastní čekací strategii
 * testcontainers a bez tohohle by narazil na spojení odmítnuté.
 */
async function waitForServer(server: PgServer, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const probe = await superuser(server);
      await probe.end();
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

/**
 * Jméno šablony odvozené z OBSAHU migrací.
 *
 * Kontejner přežívá mezi běhy a migrace se podle rozhodnutí R39 upravují na
 * místě. Šablona s pevným jménem by tedy po úpravě staré migrace zůstala
 * neaktuální a testy by běžely nad starým schématem, aniž by cokoli spadlo.
 * S otiskem v názvu vznikne po každé změně migrací šablona nová.
 */
export function templateDatabase(): string {
  const digest = createHash('sha256');
  digest.update(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json')));
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    digest.update(file);
    digest.update(readFileSync(join(MIGRATIONS_DIR, file)));
  }
  return `${TEMPLATE_DB_PREFIX}${digest.digest('hex').slice(0, 12)}`;
}

/**
 * Role a předmigrovaná šablona. Všechno podmíněně a pod výhradním zámkem,
 * protože tohle běží v každém procesu na stroji a kontejner je společný.
 */
async function ensureBootstrap(server: PgServer): Promise<void> {
  const template = templateDatabase();
  const su = await superuser(server);
  try {
    await su.query('SELECT pg_advisory_lock($1)', [BOOTSTRAP_LOCK_ID]);

    for (const role of HARNESS_ROLES) {
      // `CREATE ROLE` nemá `IF NOT EXISTS`, tak se odchytává duplicita.
      await su.query(
        `DO $$ BEGIN
           CREATE ROLE ${role} LOGIN PASSWORD '${role}';
         EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
      );
      // Heslo se dorovná VŽDY, ne jen při zakládání role.
      //
      // `DO` blok výš odchytává `duplicate_object`, takže nad existující rolí
      // neudělá nic. Bootstrap byl tedy idempotentní vůči existenci role, ale
      // ne vůči jejímu heslu. Jakmile kontejner přežil změnu očekávaného hesla,
      // padaly všechny databázové testy na
      //
      //   error: password authentication failed for user "mlain_app"
      //
      // a to hned v bootstrapu, takže se testy jen přeskočily. Nešlo o jeden
      // balíček: přes tenhle harness jdou testy kampaní, providerů, kontaktů,
      // identity, trackingu i platformy, takže to zastavilo úplně každého.
      //
      // Smazat kontejner by pomohlo taky, ale jen do příštího nesouladu.
      await su.query(`ALTER ROLE ${role} LOGIN PASSWORD '${role}'`);
    }

    if (await templateReady(su, template)) {
      await dropOrphans(su, template);
      return;
    }

    // Nedostavěná šablona po spadlém běhu. `datistemplate` se nastavuje až
    // úplně nakonec, takže tohle je spolehlivá značka „tahle je k zahození".
    await su.query(`DROP DATABASE IF EXISTS ${template} WITH (FORCE)`);
    await su.query(`CREATE DATABASE ${template}`);
    // Bez práva CREATE na DATABÁZI neprojde `CREATE SCHEMA drizzle` v runneru.
    await su.query(`GRANT CREATE ON DATABASE ${template} TO mlain_migrator`);

    const tpl = new Client({
      host: server.host,
      port: server.port,
      database: template,
      user: 'postgres',
      password: 'postgres',
    });
    await tpl.connect();
    try {
      // Migrátor vlastní schéma. Bez vlastnictví na něj RLS nedopadá a testy
      // izolace by prošly, i kdyby politiky vůbec neexistovaly.
      await tpl.query(`ALTER SCHEMA public OWNER TO mlain_migrator`);
      await tpl.query(`GRANT CREATE, USAGE ON SCHEMA public TO mlain_migrator`);
    } finally {
      await tpl.end();
    }

    // Migrace se pouští JEDNOU do šablony, ne v každém souboru ani běhu.
    await runMigrations({
      url: `postgres://mlain_migrator:mlain_migrator@${server.host}:${server.port}/${template}`,
      ensurePartitions: true,
      logger: () => {},
    });

    // Až tady je šablona použitelná. Do tohohle okamžiku ji nikdo neklonuje,
    // protože `templateReady()` se ptá právě na tenhle příznak.
    await su.query(`ALTER DATABASE ${template} IS_TEMPLATE true`);
    await dropOrphans(su, template);
  } finally {
    // Zámek je session-scoped, takže ho zavření spojení pustí samo.
    await su.end();
  }
}

async function templateReady(su: Client, template: string): Promise<boolean> {
  const { rows } = await su.query<{ ready: boolean }>(
    `SELECT datistemplate AS ready FROM pg_database WHERE datname = $1`,
    [template],
  );
  return rows[0]?.ready === true;
}

/**
 * Úklid uvnitř sdíleného kontejneru. Bez něj by v něm databáze přibývaly
 * donekonečna, protože server přežívá běhy i pády.
 *
 * Zahazuje dvě věci a obě opatrně:
 *  - testovací databáze `mlain_t<pid>_…`, jejichž proces UŽ NEŽIJE. Živé se
 *    nesmí sáhnout, patří běžícímu testu jiného agenta. Znovupoužité PID je
 *    jediná chyba, které se to může dopustit, a ta je neškodná: databáze
 *    zůstane ležet do příště.
 *  - staré šablony jiného otisku, tedy z předchozích verzí migrací.
 *
 * Chyby se schválně polykají. Když někdo mezitím z té databáze čte, `DROP`
 * neprojde a je to v pořádku; uklidí se příště.
 */
async function dropOrphans(su: Client, currentTemplate: string): Promise<void> {
  // ESCAPE je tu nutné, ne kosmetika: v LIKE je `_` zástupný znak pro JEDEN
  // libovolný znak, takže `'mlain_t%'` by sedělo i na `mlain_template`.
  const { rows } = await su.query<{ datname: string }>(
    `SELECT datname FROM pg_database
      WHERE datname LIKE 'mlain!_t%' ESCAPE '!' AND datname <> $1`,
    [currentTemplate],
  );
  for (const { datname } of rows) {
    const owner = datname.match(/^mlain_t(\d+)_/);
    if (owner !== null) {
      // Testovací databáze živého procesu patří běžícímu testu jiného agenta.
      if (processAlive(Number(owner[1]))) continue;
    } else if (!datname.startsWith(TEMPLATE_DB_PREFIX)) {
      // Cokoli jiného (třeba `mlain_template` ze starší verze harnessu) není
      // moje a nesahám na to.
      continue;
    }
    try {
      await su.query(`DROP DATABASE IF EXISTS ${datname} WITH (FORCE)`);
    } catch {
      // Někdo z ní právě čte nebo klonuje. Příští běh to zkusí znovu.
    }
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Host a port, které běhu ohlásil `globalSetup`. Bez něj (třeba v `apps/web`)
 * vrátí null a volající si sdílený server najde sám.
 *
 * Typ `inject` se tu schválně uvolňuje na `(key: string) => unknown`. Klíče
 * deklaruje `global-setup.ts` rozšířením `ProvidedContext`, jenže ten soubor je
 * součástí typové kontroly jen v `packages/core`. `apps/web` tenhle modul
 * reexportuje a jeho `tsc` tu deklaraci nevidí, takže by na přesně typovaném
 * `inject('corePgHost')` spadl na neznámý klíč. Hodnoty se kontrolují za běhu.
 */
const injectProvided = inject as unknown as (key: string) => unknown;

function injectedServer(): PgServer | null {
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

/** Vlastní databáze pro jeden testovací soubor, ve výchozím stavu klon šablony. */
async function startOnServer(server: PgServer, options: PgHarnessOptions): Promise<PgHarness> {
  const { host, port } = server;
  const migrate = options.migrate ?? true;
  const partitions = options.partitions ?? true;
  // Šablona je zmigrovaná VČETNĚ oddílů. Kdo si vyžádá jinou kombinaci, musí
  // dostat databázi stavěnou na míru, jinak by ta volba tiše nic neznamenala.
  const fromTemplate = migrate && partitions;
  // PID je v názvu schválně: podle něj pozná `dropOrphans()`, že databáze
  // patří mrtvému procesu a smí se zahodit. Náhodný konec je pojistka proti
  // tomu, že vitest s `isolate: true` vrátí čítač v každém souboru na nulu.
  const database = `mlain_t${process.pid}_${(databaseCounter += 1)}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;

  const su = await superuser(server);
  try {
    await su.query(
      fromTemplate
        ? `CREATE DATABASE ${database} TEMPLATE ${templateDatabase()}`
        : `CREATE DATABASE ${database}`,
    );
    await su.query(`GRANT CREATE ON DATABASE ${database} TO mlain_migrator`);
  } finally {
    await su.end();
  }

  if (!fromTemplate) await giveSchemaToMigrator(server, database);

  const urls = harnessUrls(host, port, database);
  if (!fromTemplate && migrate) {
    await runMigrations({ url: urls.migratorUrl, ensurePartitions: partitions });
  }

  applyHarnessEnv(urls);

  return {
    ...urls,
    host,
    port,
    stop: () => dropDatabase(server, database),
  };
}

/**
 * Zahodí databázi jednoho testovacího souboru. Kontejner se NEZASTAVUJE, sdílí
 * ho ostatní běhy na stroji.
 *
 * Má vlastní strop čekání a po jeho vypršení se vrací TICHO, ne výjimkou.
 * Zní to jako zametání pod koberec, ale je to naopak: `afterAll` má ve vitestu
 * výchozí strop 10 sekund a naměřeno spuštěním, že na vytíženém stroji se do
 * něj samo navázání spojení nemusí vejít. Test by pak spadl na úklidu, ne na
 * tom, co ověřuje. Nechaná databáze se neztratí, sebere ji `dropOrphans()` při
 * příštím startu, protože její proces už tou dobou nežije.
 */
async function dropDatabase(server: PgServer, database: string, timeoutMs = 5_000): Promise<void> {
  const work = (async () => {
    const admin = await superuser(server);
    try {
      // FORCE ukončí spojení, která test nezavřel. Bez něj by DROP čekal na
      // jejich uzavření a skončil na „database is being accessed".
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  })();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([work.catch(() => undefined), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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

async function superuser(server: PgServer): Promise<Client> {
  const client = new Client({
    host: server.host,
    port: server.port,
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
async function giveSchemaToMigrator(server: PgServer, database: string): Promise<void> {
  const fresh = new Client({
    host: server.host,
    port: server.port,
    database,
    user: 'postgres',
    password: 'postgres',
  });
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
