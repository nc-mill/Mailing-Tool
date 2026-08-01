import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

const here = path.dirname(fileURLToPath(import.meta.url));
export const packageRoot = path.resolve(here, '..', '..');
export const fixturesDir = path.join(packageRoot, 'fixtures');
export const contractSqlDir = path.join(fixturesDir, 'outbox', 'sql');

export type ContractDb = {
  // `| undefined` je kvůli exactOptionalPropertyTypes: true v presetu tsconfig.
  container?: StartedTestContainer | undefined;
  /** spojení pod rolí mlain_migrator, tedy vlastníkem schématu */
  migrator: Client;
  /** spojení pod rolí mlain_app */
  app: Client;
  /** spojení pod rolí mlain_sender, pod kterou běží scénáře OB-xx */
  sender: Client;
};

const POSTGRES_IMAGE = 'postgres:18-alpine';

/**
 * Nastartuje databázi, založí tři role, aplikuje kontraktní bootstrap schéma
 * a vrátí tři otevřená spojení.
 *
 * Když je v prostředí CONTRACTS_DATABASE_URL (job contracts-schema používá
 * services: postgres), kontejner se nestartuje.
 */
export async function startContractDb(): Promise<ContractDb> {
  let container: StartedTestContainer | undefined;
  let superuserUrl = process.env.CONTRACTS_DATABASE_URL;

  if (!superuserUrl) {
    container = await new GenericContainer(POSTGRES_IMAGE)
      .withEnvironment({ POSTGRES_PASSWORD: 'postgres', POSTGRES_DB: 'mlain' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    superuserUrl = `postgres://postgres:postgres@${container.getHost()}:${container.getMappedPort(5432)}/mlain`;
  }

  const superuser = new Client({ connectionString: superuserUrl });
  await superuser.connect();
  await superuser.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mlain_migrator') THEN
        CREATE ROLE mlain_migrator LOGIN PASSWORD 'mlain';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mlain_app') THEN
        CREATE ROLE mlain_app LOGIN PASSWORD 'mlain';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mlain_sender') THEN
        CREATE ROLE mlain_sender LOGIN PASSWORD 'mlain';
      END IF;
    END
    $$;
  `);
  await superuser.query('GRANT CREATE, USAGE ON SCHEMA public TO mlain_migrator');
  const dbName = new URL(superuserUrl).pathname.replace(/^\//, '');
  // Grant na schéma NESTAČÍ. `CREATE EXTENSION citext` z bootstrapu chce právo
  // na DATABÁZI a bez něj skončí `permission denied to create extension "citext"`
  // s nápovědou `Must have CREATE privilege on current database`.
  // Ověřeno spuštěním na PostgreSQL 18.4. Tentýž grant potřebuje i migrátor
  // v dockerovém a CI Postgresu, což je požadavek P02→P01.2.
  await superuser.query(`GRANT CREATE ON DATABASE ${dbName} TO mlain_migrator`);
  await superuser.query(`ALTER DATABASE ${dbName} SET timezone = 'UTC'`);
  await superuser.end();

  const asRole = (role: string): Client =>
    new Client({
      connectionString: superuserUrl!.replace(/\/\/[^@]+@/, `//${role}:mlain@`),
    });

  const migrator = asRole('mlain_migrator');
  await migrator.connect();
  // Když se běží proti CONTRACTS_DATABASE_URL, databáze není čerstvá a druhý běh
  // by spadl na existujících tabulkách. Bootstrap je fixture, ne migrace, takže
  // se smí zahodit a založit znovu.
  await migrator.query(
    'DROP TABLE IF EXISTS messages, campaigns, workspaces, suppressions CASCADE',
  );
  const bootstrap = await readFile(path.join(fixturesDir, 'outbox', 'schema.sql'), 'utf8');
  await migrator.query(bootstrap);

  const app = asRole('mlain_app');
  await app.connect();
  const sender = asRole('mlain_sender');
  await sender.connect();

  return { container, migrator, app, sender };
}

export async function stopContractDb(db: ContractDb | undefined): Promise<void> {
  if (!db) return;
  await Promise.all([db.migrator.end(), db.app.end(), db.sender.end()]);
  await db.container?.stop();
}

/** Vyprázdní data mezi scénáři, schéma zůstává. */
export async function truncateAll(db: ContractDb): Promise<void> {
  await db.migrator.query('TRUNCATE messages, campaigns, workspaces, suppressions CASCADE');
}
