import { Client, Pool } from 'pg';
import { inject } from 'vitest';
import { runMigrations } from '../../src/migrate';
import { ROLES, TEMPLATE_DB, type RoleName } from '../global-setup';

export type { RoleName };

export type Harness = {
  database: string;
  as(role: RoleName): Pool;
  urlFor(role: RoleName): string;
  stop(): Promise<void>;
};

export type HarnessOptions = {
  /**
   * false = vznikne PRÁZDNÁ databáze bez migrací, pro testy runneru.
   * true (výchozí) = databáze se klonuje z předmigrované šablony.
   */
  migrate?: boolean;
};

let counter = 0;

export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const migrate = options.migrate ?? true;
  const host = inject('pgHost');
  const port = inject('pgPort');
  const database = `mlain_t${process.pid}_${(counter += 1)}`;

  const su = new Client({
    host,
    port,
    database: 'postgres',
    user: 'postgres',
    password: 'postgres',
  });
  await su.connect();
  // TEMPLATE kopíruje tabulky, politiky RLS I granty. Ověřeno spuštěním,
  // ne odvozeno: bez grantů by testy oprávnění byly falešně zelené.
  await su.query(
    migrate ? `CREATE DATABASE ${database} TEMPLATE ${TEMPLATE_DB}` : `CREATE DATABASE ${database}`,
  );
  await su.query(`ALTER DATABASE ${database} SET timezone = 'Europe/Prague'`);
  await su.query(`GRANT CREATE ON DATABASE ${database} TO mlain_migrator`);
  if (!migrate) {
    const fresh = new Client({ host, port, database, user: 'postgres', password: 'postgres' });
    await fresh.connect();
    await fresh.query(`ALTER SCHEMA public OWNER TO mlain_migrator`);
    await fresh.query(`GRANT CREATE, USAGE ON SCHEMA public TO mlain_migrator`);
    await fresh.end();
  }
  await su.end();

  const urlFor = (role: RoleName) => `postgres://${role}:${role}@${host}:${port}/${database}`;

  const pools = new Map<RoleName, Pool>();
  for (const role of ROLES) {
    pools.set(
      role,
      new Pool({
        host,
        port,
        database,
        user: role,
        password: role,
        // Časová zóna se vynucuje na každém spojení, ne jen na databázi.
        // U externí databáze, kterou nespravujeme, je tohle jediná spolehlivá cesta.
        options: '-c timezone=UTC',
        max: 4,
      }),
    );
  }

  return {
    database,
    as: (role) => pools.get(role)!,
    urlFor,
    async stop() {
      for (const pool of pools.values()) await pool.end();
      const admin = new Client({
        host,
        port,
        database: 'postgres',
        user: 'postgres',
        password: 'postgres',
      });
      await admin.connect();
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await admin.end();
    },
  };
}

/** Zmigruje databázi harnessu založeného s `migrate: false`. */
export async function migrateHarness(h: Harness): Promise<void> {
  await runMigrations({ url: h.urlFor('mlain_migrator') });
}
