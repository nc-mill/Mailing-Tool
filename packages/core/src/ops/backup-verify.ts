import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { compareRowCounts, fileSha256, readManifest } from './backup-manifest';
import { withAdminTx } from './db';
import { runProcess } from './run-process';

export type VerifyInput = {
  backupDir: string;
  /** URL role, která smí zakládat a rušit databáze, tedy mlain_migrator s CREATEDB. */
  adminUrl: string;
  /**
   * Adresář s migracemi. Volitelný, ale v ZABALENÉ APLIKACI nutný.
   *
   * `@mlain/db/migrate` si cestu jinak odvodí jako `../migrations` vůči
   * `import.meta.url`. Ve zdrojích to vyjde na `packages/db/migrations`, jenže
   * CLI se do image bundluje do jediného souboru, takže `import.meta.url`
   * ukazuje na `/app/apps/cli/dist/main.js` a odvození vyjde na
   * `/app/apps/cli/migrations`, kde nic není. `mlain backup verify` proto
   * v produkční image padalo:
   *
   *   ENOENT: no such file or directory,
   *   open '/app/apps/cli/migrations/meta/_journal.json'
   *
   * Skutečné migrace leží v `/app/packages/db/migrations`. Příkaz `mlain migrate`
   * si cestu předává už dřív, ověření zálohy na to zapomnělo.
   */
  migrationsFolder?: string;
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

  // Jméno nese čas NA SEKUNDY a k tomu náhodný konec. Náhodný konec není
  // ozdoba: `pg_database` je společná pro celý server, takže dvě ověření
  // spuštěná v téže sekundě (týdenní job a kliknutí na obrazovce Zálohy)
  // by se trefila do stejného jména, druhé by spadlo na „database already
  // exists" a úklid prvního by druhému smazal databázi pod rukama.
  // Ověřeno spuštěním: bez suffixu padaly souběžné testy ověřování.
  const dbName = `ml_verify_${now.toISOString().replace(/\D/g, '').slice(0, 14)}_${randomUUID()
    .replaceAll('-', '')
    .slice(0, 8)}`;
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
    // Migrační runner se načítá AŽ TADY, dynamicky, ne statickým importem.
    //
    // Ověření zálohy běží výhradně z CLI, ale tenhle modul se přes
    // `ops/api/backups.routes.ts` a `openapi.ts` dostane do grafu modulů
    // Next.js aplikace. Runner si skládá cestu k adresáři s migracemi přes
    // `new URL('../migrations', import.meta.url)`, což bundler neumí přeložit,
    // a celá aplikace pak vrací 500 na KAŽDÉ stránce, ne jen na zálohách.
    // Přesně to se dnes stalo podruhé, poprvé přes reexport v `@mlain/db`.
    //
    // Dynamický import drží runner mimo statický graf, takže se do bundlu
    // nedostane a v Node se načte normálně.
    const { runMigrations } = await import('@mlain/db/migrate');
    await runMigrations({
      url: verifyUrl,
      ...(input.migrationsFolder === undefined ? {} : { migrationsFolder: input.migrationsFolder }),
    });
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
    // Úklid se zkouší několikrát. Jediný pokus pod zátěží občas selhal (spojení
    // se ještě zavírala) a `.catch(() => undefined)` to spolklo beze stopy,
    // takže po sobě ověřování nechávalo databáze `ml_verify_*`. Projevilo se
    // to až při souběžném běhu celé sady, v izolaci vždycky prošlo.
    //
    // Selhání se nesmí vyhodit jako výjimka: `finally` by přebilo skutečný
    // výsledek ověření. Musí ale být VIDĚT, jinak se osiřelé databáze hromadí
    // tiše a nikdo se to nedozví.
    let dropped = false;
    for (let attempt = 1; attempt <= 3 && !dropped; attempt += 1) {
      try {
        await runProcess('dropdb', ['--force', '--maintenance-db', input.adminUrl, dbName]);
        dropped = true;
      } catch (error) {
        if (attempt === 3) {
          problems.push(
            `Dočasnou databázi ${dbName} se nepodařilo smazat: ${(error as Error).message}. ` +
              `Smažte ji ručně příkazem "dropdb --force ${dbName}".`,
          );
        }
      }
    }
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
    // Čte se jen prvních 14 číslic, zbytek jména je náhodný konec.
    const s = name.slice('ml_verify_'.length, 'ml_verify_'.length + 14);
    const created = Date.parse(
      `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`,
    );
    // Hodina stáří je záměr. Právě běžící ověření z jiného procesu se nesmí
    // smazat pod rukama, uklízí se jen to, co po sobě nechal spadlý běh.
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
