import { writeAuditLog } from '../../audit/write';
import { OPS_AUDIT_ACTIONS } from '../audit';
import { listBackups, pruneBackups, runBackup } from '../backup';
import { verifyBackup } from '../backup-verify';
import { withAdminTx } from '../db';
import { loadOpsKeyring } from '../keyring';

export type BackupJobContext = {
  config: {
    DATABASE_URL: string;
    DATABASE_URL_MIGRATOR: string | undefined;
    BACKUP_DIR: string;
    UPLOADS_DIR: string;
    DATA_DIR: string;
    BACKUP_RETENTION_DAYS: number;
    IMAGE_VERSION: string;
    SECRET_KEY: string;
    SECRET_KEY_PREVIOUS: string;
  };
};

function requireAdminUrl(ctx: BackupJobContext): string {
  const url = ctx.config.DATABASE_URL_MIGRATOR;
  if (!url) {
    throw new Error(
      'Plánovaná záloha vyžaduje DATABASE_URL_MIGRATOR. Pod aplikační rolí platí row level ' +
        'security a pg_dump skončí chybou "query would be affected by row-level security policy".',
    );
  }
  return url;
}

/** Fronta `platform.backup`, cron `0 3 * * *`. Běží jen v MODE=worker a MODE=all. */
export async function backupJob(ctx: BackupJobContext): Promise<{ dir: string }> {
  const adminUrl = requireAdminUrl(ctx);
  const keyring = loadOpsKeyring({
    secretKey: ctx.config.SECRET_KEY,
    secretKeyPrevious: ctx.config.SECRET_KEY_PREVIOUS,
  });
  const now = new Date();
  const result = await runBackup({
    databaseUrl: adminUrl,
    backupDir: ctx.config.BACKUP_DIR,
    uploadsDir: ctx.config.UPLOADS_DIR,
    appVersion: ctx.config.IMAGE_VERSION,
    secretKeyFingerprint: keyring.currentFingerprint,
    now,
    postBackupHook: `${ctx.config.DATA_DIR}/hooks/post-backup.sh`,
  });
  const deleted = await pruneBackups(ctx.config.BACKUP_DIR, {
    now,
    retentionDays: ctx.config.BACKUP_RETENTION_DAYS,
  });

  // Audit se zapisuje pod migrátorem, ne pod aplikační rolí. Politika
  // ws_isolation_audit sice globální řádek s workspace_id IS NULL vloží
  // i pod mlain_app, ale job stejně migrátorské URL má a dvě různé cesty
  // k databázi v jednom souboru jsou zbytečná past.
  await withAdminTx(adminUrl, async (tx) => {
    await writeAuditLog(tx, {
      action: OPS_AUDIT_ACTIONS['backup.created'],
      workspaceId: null,
      actor: { actorType: 'system', actorId: null, actorLabel: 'platform.backup' },
      targetType: 'backup',
      targetId: null,
      metadata: {
        dir: result.dir,
        contacts: result.manifest.row_counts['contacts'],
        pruned: deleted.length,
      },
    });
  });
  return { dir: result.dir };
}

/** Fronta `platform.backup_verify`, cron `0 4 * * 0`. */
export async function backupVerifyJob(
  ctx: BackupJobContext,
): Promise<{ ok: boolean; problems: string[] }> {
  const adminUrl = requireAdminUrl(ctx);
  const entries = await listBackups(ctx.config.BACKUP_DIR);
  const newest = entries[0];
  const report =
    newest === undefined
      ? { ok: false, problems: ['V adresáři není žádná záloha, nebylo co ověřit.'] }
      : await verifyBackup({
          backupDir: `${ctx.config.BACKUP_DIR}/${newest.name}`,
          adminUrl,
        });

  await withAdminTx(adminUrl, async (tx) => {
    await writeAuditLog(tx, {
      action: OPS_AUDIT_ACTIONS['backup.verified'],
      workspaceId: null,
      actor: { actorType: 'system', actorId: null, actorLabel: 'platform.backup_verify' },
      targetType: 'backup',
      targetId: null,
      metadata: { backup: newest?.name ?? null, ok: report.ok, problems: report.problems },
    });
  });
  return report;
}
