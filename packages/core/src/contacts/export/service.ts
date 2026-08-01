import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { loadConfig } from '../../config/index';
import type { WorkspaceContext } from '../../identity/types';
import { actorUserId, auditImport } from '../import/audit';
import { inWorkspaceTx } from '../import/db';
import { lockedImport, notFoundImport } from '../import/errors';
import { enqueueImportJob } from '../import/jobs/enqueue';

export type ExportEncoding = 'utf-8-bom' | 'utf-8' | 'windows-1250';

export type CreateExportInput = {
  kind: 'contacts' | 'import_errors' | 'suppressions' | 'gdpr_subject';
  filter: Record<string, unknown>;
  columns: string[];
  format?: 'csv' | 'ndjson';
  encoding?: ExportEncoding;
  delimiter?: string;
  locale?: string;
};

export type CreatedExport = {
  id: string;
  delimiter: string;
  encoding: string;
  downloadToken: string;
};

export async function createExport(
  ctx: WorkspaceContext,
  input: CreateExportInput,
): Promise<CreatedExport> {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest();
  // BOM je výchozí schválně: bez něj Excel v českém prostředí otevře UTF-8 CSV
  // s rozbitou diakritikou, což je nejčastější stížnost na exporty vůbec.
  const encoding: ExportEncoding = input.encoding ?? 'utf-8-bom';
  const delimiter =
    input.delimiter ?? (input.locale === 'cs' || input.locale === undefined ? ';' : ',');
  const ttlHours = loadConfig().EXPORT_TTL_HOURS;

  return inWorkspaceTx(ctx, async (tx) => {
    const { rows: running } = await tx.execute<{ id: string }>(sql`
      SELECT id FROM exports
       WHERE workspace_id = ${ctx.workspaceId}::uuid AND status = 'running' LIMIT 1`);
    if (running[0] !== undefined)
      lockedImport('export_already_running', { exportId: running[0].id });

    const { rows } = await tx.execute<{ id: string; delimiter: string; encoding: string }>(sql`
      INSERT INTO exports (id, workspace_id, kind, filter, columns, format, encoding, delimiter,
                           status, download_token_hash, expires_at, created_by)
      VALUES (uuidv7(), ${ctx.workspaceId}::uuid, ${input.kind},
              ${JSON.stringify(input.filter)}::jsonb, ${JSON.stringify(input.columns)}::jsonb,
              ${input.format ?? 'csv'}, ${encoding}, ${delimiter}, 'queued', ${tokenHash},
              now() + make_interval(hours => ${ttlHours}), ${actorUserId(ctx)}::uuid)
      RETURNING id, delimiter, encoding`);
    const row = rows[0];
    if (row === undefined) throw new Error('INSERT do exports nevrátil řádek.');
    await enqueueImportJob(tx, 'contacts.export', {
      workspaceId: ctx.workspaceId,
      exportId: row.id,
    });
    await auditImport(tx, ctx, 'export.created', row.id, { kind: input.kind });
    return { ...row, downloadToken: token };
  });
}

/** Jednorázový token: po ověření se hash smaže, takže druhý pokus selže. */
export async function verifyDownloadToken(
  ctx: WorkspaceContext,
  exportId: string,
  token: string,
): Promise<boolean> {
  return inWorkspaceTx(ctx, async (tx) => {
    const { rows } = await tx.execute<{ download_token_hash: Buffer | null }>(sql`
      SELECT download_token_hash FROM exports
       WHERE id = ${exportId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND status = 'completed' AND expires_at > now()`);
    const stored = rows[0]?.download_token_hash;
    if (stored === null || stored === undefined) return false;
    const given = createHash('sha256').update(token).digest();
    if (given.length !== stored.length || !timingSafeEqual(given, stored)) return false;
    await tx.execute(sql`
      UPDATE exports SET download_token_hash = NULL
       WHERE id = ${exportId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid`);
    await auditImport(tx, ctx, 'export.downloaded', exportId, {});
    return true;
  });
}

export type ExportRow = {
  id: string;
  kind: string;
  filter: Record<string, unknown>;
  columns: string[];
  format: 'csv' | 'ndjson';
  encoding: ExportEncoding;
  delimiter: string;
  status: string;
  storage_key: string | null;
};

export async function loadExport(ctx: WorkspaceContext, exportId: string): Promise<ExportRow> {
  const { rows } = await inWorkspaceTx(ctx, (tx) =>
    tx.execute<ExportRow>(sql`
      SELECT id, kind, filter, columns, format, encoding, delimiter, status, storage_key
        FROM exports
       WHERE id = ${exportId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid`),
  );
  const row = rows[0];
  if (row === undefined) notFoundImport('export_not_found', exportId);
  return row;
}
