//
// Běží JEDNOU pro celý projekt `db`. Nastartuje kontejner, udělá to,
// co v produkci dělá docker/initdb (P01), a připraví předmigrovanou šablonu.
// Testovací soubory pak jen klonují databázi, což trvá desítky milisekund
// místo desítek sekund.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '../src/migrate';
import { resolveMigrationsFolder } from '../src/migrations-folder';

export const ROLES = [
  'mlain_migrator',
  'mlain_app',
  'mlain_sender',
  'mlain_gdpr',
  'mlain_maintenance',
  'mlain_backup',
] as const;

export type RoleName = (typeof ROLES)[number];

export const TEMPLATE_DB = 'mlain_template';

let container: StartedPostgreSqlContainer | undefined;

export default async function setup(project: TestProject) {
  // Verze je pravidlo, ne číslo: poslední produkční PostgreSQL. K 2026-07-31 je to 18.
  // Osmnáctka má uuidv7() v jádře, takže DEFAULT uuidv7() v DDL drží.
  container = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase('postgres')
    .withUsername('postgres')
    .withPassword('postgres')
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

  for (const role of ROLES) {
    await su.query(`CREATE ROLE ${role} LOGIN PASSWORD '${role}'`);
  }
  await su.query(`GRANT pg_read_all_data TO mlain_backup`);

  // Časová zóna databáze je SCHVÁLNĚ jiná než UTC. V produkci ji docker/initdb
  // nastavuje na UTC, ale u externí databáze, kterou nespravujeme, to zaručit
  // nejde. Test „spojení běží v UTC" má dokazovat, že UTC vynucuje aplikace;
  // proti databázi nastavené na UTC by nemohl spadnout ani při úplném
  // odstranění options z klienta.
  await su.query(`CREATE DATABASE ${TEMPLATE_DB}`);
  await su.query(`ALTER DATABASE ${TEMPLATE_DB} SET timezone = 'Europe/Prague'`);
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

  // Šablona se migruje JEDNOU. ensurePartitions je vypnuté schválně: oddíly
  // si zakládá každý test podle svého data, aby sada nezačala padat na přelomu
  // měsíce a aby šablona zůstala malá.
  await runMigrations({
    url: `postgres://mlain_migrator:mlain_migrator@${host}:${port}/${TEMPLATE_DB}`,
    migrationsFolder: resolveMigrationsFolder(),
    ensurePartitions: false,
  });

  await su.query(`ALTER DATABASE ${TEMPLATE_DB} IS_TEMPLATE true`);
  await su.end();

  project.provide('pgHost', host);
  project.provide('pgPort', port);

  return async () => {
    await container?.stop();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    pgHost: string;
    pgPort: number;
  }
}
