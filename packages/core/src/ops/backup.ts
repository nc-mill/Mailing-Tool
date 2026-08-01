import { access, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { assertDumpRoleSeesAllRows } from './backup-guard';
import { withAdminTx } from './db';
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_ROW_COUNT_TABLES,
  fileSha256,
  writeManifest,
  type BackupManifest,
} from './backup-manifest';
import { runProcess } from './run-process';

export type RunBackupInput = {
  databaseUrl: string;
  backupDir: string;
  uploadsDir: string;
  appVersion: string;
  secretKeyFingerprint: string;
  now: Date;
  postBackupHook?: string;
};

export type RunBackupResult = { dir: string; manifest: BackupManifest };

/** Jméno adresáře podle 3.14: mlain-<ISO bez oddělovačů>Z */
export function backupDirName(now: Date): string {
  return `mlain-${now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
}

export async function runBackup(input: RunBackupInput): Promise<RunBackupResult> {
  await assertDumpRoleSeesAllRows(input.databaseUrl);

  const finalDir = join(input.backupDir, backupDirName(input.now));
  const workDir = `${finalDir}.partial`;
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });

  try {
    const dumpPath = join(workDir, 'database.dump');
    await runProcess('pg_dump', [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--file',
      dumpPath,
      input.databaseUrl,
    ]);

    const uploads = await archiveUploads(input.uploadsDir, join(workDir, 'uploads.tar.gz'));
    const meta = await readInstallationMeta(input.databaseUrl);
    const dumpStat = await stat(dumpPath);

    const manifest: BackupManifest = {
      format_version: BACKUP_FORMAT_VERSION,
      created_at: input.now.toISOString(),
      app_version: input.appVersion,
      schema_version: meta.schemaVersion,
      installation_id: meta.installationId,
      secret_key_fingerprint: input.secretKeyFingerprint,
      postgres_version: meta.postgresVersion,
      database: { bytes: dumpStat.size, sha256: await fileSha256(dumpPath) },
      uploads,
      row_counts: meta.rowCounts,
    };
    await writeManifest(workDir, manifest);

    await rm(finalDir, { recursive: true, force: true });
    await rename(workDir, finalDir);

    if (input.postBackupHook) {
      // Selhání hooku nesmí zneplatnit hotovou zálohu, jen se hlasitě zapíše.
      await runProcess(input.postBackupHook, [finalDir], { timeoutMs: 15 * 60 * 1000 }).catch(
        (err: Error) => console.warn(`post-backup hook selhal: ${err.message}`),
      );
    }

    return { dir: finalDir, manifest };
  } catch (err) {
    await rm(workDir, { recursive: true, force: true });
    throw err;
  }
}

async function archiveUploads(
  uploadsDir: string,
  target: string,
): Promise<BackupManifest['uploads']> {
  try {
    await access(uploadsDir);
  } catch {
    return null;
  }
  await runProcess('tar', ['-czf', target, '-C', uploadsDir, '.']);
  const listing = await runProcess('tar', ['-tzf', target]);
  const files = listing.stdout.split('\n').filter((l) => l.trim() !== '' && !l.endsWith('/')).length;
  const s = await stat(target);
  return { bytes: s.size, sha256: await fileSha256(target), files };
}

type InstallationMeta = {
  schemaVersion: number;
  installationId: string;
  postgresVersion: string;
  rowCounts: Record<string, number>;
};

export async function readInstallationMeta(databaseUrl: string): Promise<InstallationMeta> {
  return withAdminTx(databaseUrl, async (tx) => {
    const { rows: settings } = await tx.execute<{
      schema_version: number;
      installation_id: string;
    }>(sql`SELECT schema_version, installation_id FROM system_settings WHERE id = true`);
    const { rows: server } = await tx.execute<{ version: string }>(
      sql`SELECT current_setting('server_version') AS version`,
    );

    // sql.param() je povinné: holé pole by se rozložilo na $1, $2, $3 a dotaz
    // by spadl na 42809 op ANY/ALL (array) requires array on right side.
    const { rows: existing } = await tx.execute<{ tablename: string }>(
      sql`SELECT tablename FROM pg_tables
           WHERE schemaname = 'public'
             AND tablename = ANY(${sql.param([...BACKUP_ROW_COUNT_TABLES])})`,
    );

    const rowCounts: Record<string, number> = {};
    for (const { tablename } of existing) {
      // Jméno tabulky pochází z whitelistu výše, ne ze vstupu, takže je
      // sql.raw() bezpečné. Identifikátor se parametrizovat nedá.
      const { rows } = await tx.execute<{ count: string }>(
        sql`SELECT count(*)::text AS count FROM ${sql.raw(`"${tablename}"`)}`,
      );
      rowCounts[tablename] = Number(rows[0]!.count);
    }
    return {
      schemaVersion: settings[0]!.schema_version,
      installationId: settings[0]!.installation_id,
      postgresVersion: server[0]!.version,
      rowCounts,
    };
  });
}

export type BackupEntry = { name: string; createdAt: Date };

export const BACKUP_MIN_KEPT = 3;

/**
 * Vrátí jména adresářů k odstranění. Vždy zůstanou aspoň tři nejnovější,
 * i kdyby byly starší než limit. Bez toho by instalace, která byla měsíc
 * vypnutá, přišla po prvním startu o všechny zálohy naráz.
 */
export function selectBackupsToDelete(
  entries: readonly BackupEntry[],
  options: { now: Date; retentionDays: number },
): string[] {
  const sorted = [...entries].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const keepAlways = new Set(sorted.slice(0, BACKUP_MIN_KEPT).map((e) => e.name));
  const cutoff = options.now.getTime() - options.retentionDays * 24 * 60 * 60 * 1000;
  return sorted
    .filter((e) => !keepAlways.has(e.name) && e.createdAt.getTime() < cutoff)
    .map((e) => e.name)
    .sort();
}

const DIR_PATTERN = /^mlain-(\d{8})T(\d{6})Z$/;

export async function listBackups(backupDir: string): Promise<BackupEntry[]> {
  const names = await readdir(backupDir).catch(() => [] as string[]);
  return names
    .map((name) => {
      const m = DIR_PATTERN.exec(name);
      if (!m) return null;
      const d = m[1]!;
      const t = m[2]!;
      const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}Z`;
      return { name, createdAt: new Date(iso) };
    })
    .filter((e): e is BackupEntry => e !== null)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function pruneBackups(
  backupDir: string,
  options: { now: Date; retentionDays: number },
): Promise<string[]> {
  const toDelete = selectBackupsToDelete(await listBackups(backupDir), options);
  for (const name of toDelete) {
    await rm(join(backupDir, name), { recursive: true, force: true });
  }
  return toDelete;
}
