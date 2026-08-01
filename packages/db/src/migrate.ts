import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

/**
 * Pevná konstanta. Session-scoped advisory lock se uvolní i při pádu procesu,
 * což je jeho hlavní výhoda proti zámkové tabulce, kterou by po pádu musel
 * někdo uklidit ručně. Hodnota se NIKDY nemění: změna znamená, že staré
 * a nové repliky drží jiný zámek a migrují současně.
 */
export const MIGRATION_ADVISORY_LOCK_ID = 7264150401;

const DEFAULT_MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

export type RunMigrationsOptions = {
  url: string;
  migrationsFolder?: string;
  /** Strop čekání na zámek. Přetečení = exit 75 (EX_TEMPFAIL), kontejner restartuje. */
  lockTimeoutSeconds?: number;
  /** Zajistí partition na aktuální a další tři měsíce. Vypíná se jen v testech runneru. */
  ensurePartitions?: boolean;
  logger?: (message: string) => void;
};

export class MigrationError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
    readonly code: string,
    readonly tag?: string,
    readonly statement?: string,
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}

type JournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};
type Journal = { version: string; dialect: string; entries: JournalEntry[] };
type Directives = { noTransaction: boolean; timeoutSeconds: number; expand: boolean };

/** Direktivy smí nést jen souvislý blok komentářů na začátku souboru. */
export function parseDirectives(sql: string): Directives {
  const result: Directives = { noTransaction: false, timeoutSeconds: 60, expand: false };
  for (const line of sql.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (!trimmed.startsWith('--')) break;
    if (/^--\s*mlain:no-transaction\s*$/.test(trimmed)) result.noTransaction = true;
    const timeout = trimmed.match(/^--\s*mlain:timeout=(\d+)\s*$/);
    if (timeout) result.timeoutSeconds = Number(timeout[1]);
    if (/^--\s*mlain:expand\s*$/.test(trimmed)) result.expand = true;
  }
  return result;
}

export function splitStatements(sql: string): string[] {
  return sql
    .split('--> statement-breakpoint')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

async function acquireLock(client: Client, timeoutSeconds: number, log: (m: string) => void) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  for (;;) {
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [MIGRATION_ADVISORY_LOCK_ID],
    );
    if (rows[0]!.locked) return;
    if (Date.now() >= deadline) {
      throw new MigrationError(
        `nepodařilo se získat migrační zámek do ${timeoutSeconds} s`,
        75,
        'migration_lock_timeout',
      );
    }
    log('migrační zámek drží jiná replika, čekám');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/** Vrací schema_version, nebo null, když tabulka system_settings ještě neexistuje. */
async function readSchemaVersion(client: Client): Promise<number | null> {
  const exists = await client.query<{ present: boolean }>(
    `SELECT to_regclass('public.system_settings') IS NOT NULL AS present`,
  );
  if (!exists.rows[0]!.present) return null;
  const { rows } = await client.query<{ schema_version: number }>(
    'SELECT schema_version FROM system_settings WHERE id = true',
  );
  return rows[0]?.schema_version ?? null;
}

export async function runMigrations(options: RunMigrationsOptions): Promise<void> {
  const folder = options.migrationsFolder ?? DEFAULT_MIGRATIONS_FOLDER;
  const log = options.logger ?? ((m: string) => console.info(`[migrate] ${m}`));
  const journal: Journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8'));
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);
  const maxVersion = entries.length;

  const client = new Client({ connectionString: options.url, options: '-c timezone=UTC' });
  await client.connect();
  try {
    await acquireLock(client, options.lockTimeoutSeconds ?? 300, log);

    // Downgrade guard. Bez něj by starší aplikace zapisovala do novějšího
    // schématu a tiše ho poškodila.
    const current = await readSchemaVersion(client);
    if (current !== null && current > maxVersion) {
      throw new MigrationError(
        `schema_version ${current} je vyšší než maximum ${maxVersion}, které tahle verze zná`,
        5,
        'schema_version_ahead',
      );
    }

    await client.query('CREATE SCHEMA IF NOT EXISTS drizzle');
    await client.query(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id serial PRIMARY KEY,
        hash text NOT NULL,
        tag text NOT NULL,
        created_at bigint
      )`);
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_drizzle_migrations__hash
         ON drizzle.__drizzle_migrations (hash)`,
    );
    // Tag je druhý unikátní klíč. Bez něj se drift ve vydané migraci pozná
    // jen jako "neznámý hash", tedy jako pokyn migraci PŘEHRÁT.
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_drizzle_migrations__tag
         ON drizzle.__drizzle_migrations (tag)`,
    );
    const applied = await client.query<{ hash: string; tag: string }>(
      'SELECT hash, tag FROM drizzle.__drizzle_migrations',
    );
    const appliedHashes = new Set(applied.rows.map((row) => row.hash));
    const appliedByTag = new Map(applied.rows.map((row) => [row.tag, row.hash]));

    for (const entry of entries) {
      const sql = readFileSync(join(folder, `${entry.tag}.sql`), 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');

      // Drift guard. Vydaná migrace se needituje ani o bílý znak. Kdyby se
      // editovala, runner by ji podle hashe považoval za novou a přehrál by ji
      // nad hotovým schématem: u CREATE TABLE hlasitě, u GRANT nebo INSERT tiše.
      const previous = appliedByTag.get(entry.tag);
      if (previous !== undefined && previous !== hash) {
        throw new MigrationError(
          `migrace ${entry.tag} je už aplikovaná, ale její obsah se změnil ` +
            `(v databázi ${previous.slice(0, 12)}, na disku ${hash.slice(0, 12)})`,
          6,
          'migration_hash_mismatch',
          entry.tag,
        );
      }
      if (appliedHashes.has(hash)) continue;

      const directives = parseDirectives(sql);
      const statements = splitStatements(sql);
      log(`aplikuji ${entry.tag}${directives.noTransaction ? ' (mimo transakci)' : ''}`);

      let failing = '';
      try {
        await client.query(`SET lock_timeout = '${directives.timeoutSeconds}s'`);
        await client.query(`SET statement_timeout = '${directives.timeoutSeconds}s'`);
        if (!directives.noTransaction) await client.query('BEGIN');
        for (const statement of statements) {
          failing = statement;
          await client.query(statement);
        }
        failing = 'zápis do drizzle.__drizzle_migrations';
        await client.query(
          'INSERT INTO drizzle.__drizzle_migrations (hash, tag, created_at) VALUES ($1, $2, $3)',
          [hash, entry.tag, entry.when],
        );
        if (!directives.noTransaction) await client.query('COMMIT');
      } catch (error) {
        if (!directives.noTransaction) await client.query('ROLLBACK').catch(() => undefined);
        // Čítač se počítá až PO rollbacku, jinak by ho rollback vzal s sebou.
        // Jeho selhání se loguje, ale nepřebíjí původní chybu migrace:
        // tichý `.catch(() => undefined)` by zamaskoval i to, že se do čítače
        // nikdy nezapsalo, a přesně to se dřív stalo.
        await bumpFailureCounter(client, entry.tag).catch((counterError: unknown) => {
          log(
            `čítač neúspěchů migrace ${entry.tag} se nepodařilo zvýšit: ` +
              `${(counterError as Error).message}`,
          );
        });
        throw new MigrationError(
          `migrace ${entry.tag} selhala: ${(error as Error).message}`,
          3,
          'migration_failed',
          entry.tag,
          failing,
        );
      } finally {
        await client.query('SET lock_timeout = DEFAULT').catch(() => undefined);
        await client.query('SET statement_timeout = DEFAULT').catch(() => undefined);
      }
    }

    if ((await readSchemaVersion(client)) !== null) {
      await client.query(
        'UPDATE system_settings SET schema_version = $1, updated_at = now() WHERE id = true',
        [maxVersion],
      );
    }

    if (options.ensurePartitions ?? true) {
      const { ensureUpcomingPartitions } = await import('./partitions');
      await ensureUpcomingPartitions(client, new Date(), 4);
    }
  } finally {
    await client
      .query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_ID])
      .catch(() => undefined);
    await client.end();
  }
}

/**
 * Deterministicky chybná migrace by jinak zacyklila restart kontejneru.
 * Po třech neúspěších téže migrace se aplikace pouští v režimu údržby (P01).
 *
 * Mezikrok `migration_failures` se MUSÍ vytvořit zvlášť. `jsonb_set` s příznakem
 * create_missing doplní jen POSLEDNÍ složku cesty; když chybí složka dřívější,
 * vrátí funkce původní hodnotu beze změny a nic neohlásí. Ověřeno spuštěním:
 * `jsonb_set('{}', ARRAY['migration_failures','0003_x'], to_jsonb(1), true)`
 * vrátí `{}`, takže čítač by zůstal navždy na nule.
 */
async function bumpFailureCounter(client: Client, tag: string): Promise<void> {
  await client.query(
    `UPDATE system_settings
        SET settings = jsonb_set(
              CASE WHEN settings ? 'migration_failures'
                   THEN settings
                   ELSE settings || '{"migration_failures":{}}'::jsonb END,
              ARRAY['migration_failures', $1],
              to_jsonb(COALESCE((settings #>> ARRAY['migration_failures', $1])::int, 0) + 1),
              true),
            updated_at = now()
      WHERE id = true`,
    [tag],
  );
}
