/**
 * Běží JEDNOU pro celý běh vitestu v `packages/core`. Nastartuje jediný
 * kontejner PostgreSQL, udělá v něm to, co v produkci dělá `docker/initdb`,
 * a připraví předmigrovanou šablonu `mlain_template`.
 *
 * Rozhodnutí R31 plánu P03: jeden kontejner na běh, ne jeden na soubor.
 * `startPgHarness()` si pak v každém testovacím souboru vytvoří vlastní
 * databázi příkazem `CREATE DATABASE ... TEMPLATE mlain_template`, což trvá
 * desítky milisekund místo desítek sekund. Před touhle změnou startovalo
 * 23 souborů 23 kontejnerů a přehrálo 23krát tutéž sadu migrací.
 *
 * Vzor je `packages/db/test/global-setup.ts`. Odchylky proti němu jsou dvě
 * a obě mají důvod:
 *  - Šablona se migruje VČETNĚ oddílů (`ensurePartitions: true`). Testy
 *    `packages/core` zapisují do partitionovaných tabulek (`audit_log`,
 *    `messages`, `message_events`) a bez oddílu pro aktuální měsíc skončí
 *    každý takový zápis na „no partition of relation ... found for row".
 *    Zestarat oddíly nemají jak: `ensureUpcomingPartitions` zakládá aktuální
 *    měsíc a tři další dopředu a šablona žije jen po dobu jednoho běhu.
 *  - Databáze NEMÁ nastavenou časovou zónu na `Europe/Prague`. V `packages/db`
 *    je to schválně, aby test „spojení běží v UTC" mohl spadnout; testy
 *    `packages/core` na to nesázejí a dosavadní harness běžel nad výchozím UTC.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '@mlain/db/migrate';
import { HARNESS_ROLES, TEMPLATE_DB } from './pg-harness';

let container: StartedPostgreSqlContainer | undefined;

export default async function setup(project: TestProject) {
  // Verze je pravidlo, ne číslo: poslední produkční PostgreSQL. K 2026-08-01 je to 18.
  // Osmnáctka má uuidv7() v jádře, takže DEFAULT uuidv7() v DDL drží.
  container = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase('postgres')
    .withUsername('postgres')
    .withPassword('postgres')
    // Jeden kontejner obsluhuje VŠECHNY testovací soubory naráz. Každý soubor
    // si otevírá aplikační pool (10 spojení), read-only pool (5) a k tomu
    // migrátorské pooly, takže při `maxWorkers: 3` z `vitest.config.ts` jde
    // o zhruba šedesát spojení. Výchozích 100 je na to těsných a docházejí
    // tiše: chyba „too many connections" na příčinu vůbec neukazuje.
    //
    // Dvě stě, ne pět set. Naměřeno spuštěním: postmaster si podle
    // `max_connections` rezervuje sdílenou paměť dopředu a virtuální stroj
    // Dockeru má na tomhle stroji 7,8 GiB pro VŠECHNY agenty najednou.
    // S pěti sty skončil kontejner pod souběžnou zátěží zabitý signálem
    // (`die exit=137`) a celá série spadla na „Connection terminated
    // unexpectedly", protože sdílený server je jeden a jeho pád vezme všechno.
    //
    // Přepínače trvanlivosti jsou bezpečné právě proto, že jde o testovací
    // databázi: po pádu kontejneru se nemá co obnovovat, kontejner se zahazuje.
    // Ušetřený zápis na disk je přitom to, co sérii nejvíc zrychlí.
    .withCommand([
      'postgres',
      '-c',
      'max_connections=200',
      '-c',
      'fsync=off',
      '-c',
      'synchronous_commit=off',
      '-c',
      'full_page_writes=off',
    ])
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);

  const su = new Client({
    host,
    port,
    database: 'postgres',
    user: 'postgres',
    password: 'postgres',
  });
  await su.connect();

  // Šest rolí z `docker/initdb`. Migrace 0004 a 0005 je potřebují všechny.
  for (const role of HARNESS_ROLES) {
    await su.query(`CREATE ROLE ${role} LOGIN PASSWORD '${role}'`);
  }

  await su.query(`CREATE DATABASE ${TEMPLATE_DB}`);
  // Bez práva CREATE na DATABÁZI neprojde `CREATE SCHEMA drizzle` v runneru.
  await su.query(`GRANT CREATE ON DATABASE ${TEMPLATE_DB} TO mlain_migrator`);

  const tpl = new Client({
    host,
    port,
    database: TEMPLATE_DB,
    user: 'postgres',
    password: 'postgres',
  });
  await tpl.connect();
  // Migrátor vlastní schéma. Bez vlastnictví na něj RLS nedopadá a testy
  // izolace by prošly, i kdyby politiky vůbec neexistovaly.
  await tpl.query(`ALTER SCHEMA public OWNER TO mlain_migrator`);
  await tpl.query(`GRANT CREATE, USAGE ON SCHEMA public TO mlain_migrator`);
  await tpl.end();

  // Migrace se pouští JEDNOU do šablony, ne v každém souboru.
  await runMigrations({
    url: `postgres://mlain_migrator:mlain_migrator@${host}:${port}/${TEMPLATE_DB}`,
    ensurePartitions: true,
  });

  await su.query(`ALTER DATABASE ${TEMPLATE_DB} IS_TEMPLATE true`);
  await su.end();

  project.provide('corePgHost', host);
  project.provide('corePgPort', port);

  return async () => {
    await container?.stop();
    container = undefined;
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    corePgHost: string;
    corePgPort: number;
  }
}
