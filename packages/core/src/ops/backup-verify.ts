import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { runMigrations } from '@mlain/db/migrate';
import { compareRowCounts, fileSha256, readManifest } from './backup-manifest';
import { withAdminTx } from './db';
import { runProcess } from './run-process';

export type VerifyInput = {
  backupDir: string;
  /** URL role, která smí zakládat a rušit databáze, tedy mlain_migrator s CREATEDB. */
  adminUrl: string;
  now?: Date;
};

export type VerifyReport = { ok: boolean; problems: string[] };

/** Integritní dotazy podle 3.14. Očekávaná hodnota je u prvního 1, u ostatních 0. */
const INTEGRITY_QUERIES: ReadonlyArray<{ label: string; sql: string; expect: number }> = [
  {
    label: 'system_settings má právě jeden řádek',
    sql: 'SELECT count(*)::int AS n FROM system_settings',
    expect: 1,
  },
  {
    label: 'každý projekt má aspoň jednoho ownera',
    sql: `SELECT count(*)::int AS n FROM workspaces w
           WHERE w.deleted_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM memberships m
                              WHERE m.workspace_id = w.id AND m.role = 'owner')`,
    expect: 0,
  },
  {
    label: 'žádné osiřelé členství',
    sql: `SELECT count(*)::int AS n FROM memberships m
           WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = m.user_id)
              OR NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.id = m.workspace_id)`,
    expect: 0,
  },
];

export async function verifyBackup(input: VerifyInput): Promise<VerifyReport> {
  const now = input.now ?? new Date();
  const problems: string[] = [];

  await dropStaleVerifyDatabases(input.adminUrl, now);

  const manifest = await readManifest(input.backupDir);
  const dumpPath = join(input.backupDir, 'database.dump');
  const actualHash = await fileSha256(dumpPath);
  if (actualHash !== manifest.database.sha256) {
    return {
      ok: false,
      problems: [
        `Kontrolní součet database.dump nesedí. V manifestu ${manifest.database.sha256}, ve skutečnosti ${actualHash}.`,
      ],
    };
  }

  const dbName = `ml_verify_${now.toISOString().replace(/\D/g, '').slice(0, 14)}`;
  const verifyUrl = replaceDatabase(input.adminUrl, dbName);

  await runProcess('createdb', ['--maintenance-db', input.adminUrl, dbName]);
  try {
    await runProcess('pg_restore', [
      '--no-owner',
      '--no-privileges',
      '--exit-on-error',
      '--dbname',
      verifyUrl,
      dumpPath,
    ]);
    // Migrace i granty. Dump nese ledger migrací, takže runMigrations po obnově
    // NIC nepoužije, a `--no-privileges` znamená, že v dumpu žádné granty nejsou.
    // Bez mlain_apply_grants() by ověřovací databáze byla bez oprávnění a
    // integritní dotazy by se v ní chovaly jinak než v ostré instalaci.
    await runMigrations({ url: verifyUrl });
    await applyGrants(verifyUrl);

    await withAdminTx(verifyUrl, async (tx) => {
      const actual: Record<string, number> = {};
      for (const table of Object.keys(manifest.row_counts)) {
        const { rows } = await tx.execute<{ count: string }>(
          sql`SELECT count(*)::text AS count FROM ${sql.raw(`"${table}"`)}`,
        );
        actual[table] = Number(rows[0]!.count);
      }
      for (const diff of compareRowCounts(manifest.row_counts, actual)) {
        problems.push(
          `Tabulka ${diff.table}: v manifestu ${diff.expected}, po obnově ${diff.actual}.`,
        );
      }
      for (const q of INTEGRITY_QUERIES) {
        const { rows } = await tx.execute<{ n: number }>(sql.raw(q.sql));
        if (rows[0]!.n !== q.expect) {
          problems.push(`Integritní kontrola selhala: ${q.label} (${rows[0]!.n}).`);
        }
      }
    });
  } finally {
    await runProcess('dropdb', ['--force', '--maintenance-db', input.adminUrl, dbName]).catch(
      () => undefined,
    );
  }

  return { ok: problems.length === 0, problems };
}

/**
 * Obnoví oprávnění po `pg_restore --no-privileges`.
 *
 * Funkci `mlain_apply_grants()` vlastní P03 (jeho rozhodnutí R25) a je
 * idempotentní, takže se smí volat kolikrát chce. V dumpu přežije, protože
 * je to objekt schématu, ne oprávnění. Ověřeno spuštěním: po obnově bez ní
 * skončí `mlain_app` na `permission denied for table contacts`, po jejím
 * zavolání čte normálně.
 */
export async function applyGrants(databaseUrl: string): Promise<void> {
  await withAdminTx(databaseUrl, async (tx) => {
    await tx.execute(sql`SELECT mlain_apply_grants()`);
  });
}

/** Uklidí ověřovací databáze po pádu procesu, aby se nehromadily. */
async function dropStaleVerifyDatabases(adminUrl: string, now: Date): Promise<void> {
  const names = await withAdminTx(adminUrl, async (tx) => {
    const { rows } = await tx.execute<{ datname: string }>(
      sql`SELECT datname FROM pg_database WHERE datname LIKE 'ml_verify_%'`,
    );
    return rows.map((r) => r.datname);
  });
  for (const name of names) {
    const s = name.slice('ml_verify_'.length);
    const created = Date.parse(
      `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`,
    );
    if (Number.isNaN(created) || now.getTime() - created > 60 * 60 * 1000) {
      await runProcess('dropdb', ['--force', '--maintenance-db', adminUrl, name]).catch(
        () => undefined,
      );
    }
  }
}

export function replaceDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}
