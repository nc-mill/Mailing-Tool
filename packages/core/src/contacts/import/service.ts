import { randomBytes, randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../../identity/types';
import { markAllStale } from '../../segments/service';
import { actorUserId, auditImport } from './audit';
import { inWorkspaceTx } from './db';
import { detectDialect, type Dialect } from './dialect';
import { decodeSample, detectEncoding, type DetectedEncoding } from './encoding';
import { conflictImport, lockedImport, notFoundImport } from './errors';
import { buildIdempotencyKey } from './idempotency';
import { importLimits } from './limits';
import { assertMappingValid, suggestMapping, type ImportMapping } from './mapping';
import { ImportOptionsSchema, type ImportOptions } from './options';
import { assertTransition, isImportState, type ImportState } from './state';
import { storeUpload } from './storage';
import { enqueueImportJob } from './jobs/enqueue';

export type ImportRow = {
  id: string;
  workspace_id: string;
  filename: string;
  storage_key: string | null;
  byte_size: number;
  content_sha256: Buffer;
  idempotency_key: string;
  status: string;
  encoding: string | null;
  encoding_source: string | null;
  delimiter: string | null;
  has_header: boolean;
  mapping: ImportMapping;
  options: Record<string, unknown>;
  total_rows: number | null;
  checkpoint_row: number;
  checkpoint_byte: number;
  error_rows: number;
  failure_detail: string | null;
};

export type CreateInput = {
  stream: Readable;
  filename: string;
  mapping?: ImportMapping;
  options?: Partial<ImportOptions>;
  force?: boolean;
};

/** Řádek importu, nebo 404. Nikdy prázdný výsledek, aby cizí id nevypadalo jako prázdný import. */
export async function loadImport(ctx: WorkspaceContext, importId: string): Promise<ImportRow> {
  const { rows } = await inWorkspaceTx(ctx, (tx) =>
    tx.execute<ImportRow>(sql`
      SELECT * FROM imports
       WHERE id = ${importId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid`),
  );
  const row = rows[0];
  if (row === undefined) notFoundImport('import_not_found', importId);
  return row;
}

function statusOf(row: ImportRow): ImportState {
  if (!isImportState(row.status)) {
    throw new Error(`imports.status obsahuje neznámou hodnotu "${row.status}".`);
  }
  return row.status;
}

/** Prvních `bytes` bajtů souboru. Nikdy se nečte celý, ani u dvousetmegabajtového vstupu. */
async function readHead(storageKey: string, bytes: number): Promise<Buffer> {
  const handle = await open(join(importLimits().dataDir, storageKey), 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function decodeSampleFor(head: Buffer, encoding: DetectedEncoding): string {
  return decodeSample(head, encoding);
}

export async function createImport(
  ctx: WorkspaceContext,
  input: CreateInput,
): Promise<{ id: string; status: string }> {
  const limits = importLimits();
  const importId = randomUUID();
  const stored = await storeUpload(input.stream, {
    dataDir: limits.dataDir,
    workspaceId: ctx.workspaceId,
    importId,
    maxBytes: limits.maxFileBytes,
  });

  const options = ImportOptionsSchema.parse(input.options ?? {});
  const key = buildIdempotencyKey({
    contentSha256: stored.contentSha256,
    workspaceId: ctx.workspaceId,
    mapping: input.mapping ?? {},
    options,
    ...(input.force === true ? { nonce: randomBytes(8).toString('hex') } : {}),
  });

  return inWorkspaceTx(ctx, async (tx) => {
    const { rows: clash } = await tx.execute<{ id: string; status: string }>(sql`
      SELECT id, status FROM imports
       WHERE workspace_id = ${ctx.workspaceId}::uuid AND idempotency_key = ${key}
         AND status IN ('completed','completed_with_errors','importing')
         AND created_at > now() - interval '24 hours'`);
    const previous = clash[0];
    if (previous !== undefined) {
      // Stavy failed a cancelled sem schválně nepatří: tam se nový import
      // zakládá bez ptaní, protože opakovat pokažený import je legitimní.
      conflictImport('import_duplicate', { importId: previous.id, status: previous.status });
    }

    const { rows: inserted } = await tx.execute<{ id: string; status: string }>(sql`
      INSERT INTO imports (id, workspace_id, filename, storage_key, byte_size, content_sha256,
                           idempotency_key, status, mapping, options, created_by, file_expires_at)
      VALUES (${importId}::uuid, ${ctx.workspaceId}::uuid, ${input.filename}, ${stored.storageKey},
              ${stored.byteSize}, ${stored.contentSha256}, ${key}, 'pending',
              ${JSON.stringify(input.mapping ?? {})}::jsonb, ${JSON.stringify(options)}::jsonb,
              ${actorUserId(ctx)}::uuid, now() + interval '30 days')
      RETURNING id, status`);
    await enqueueImportJob(
      tx,
      'contacts.import',
      { workspaceId: ctx.workspaceId, importId, phase: 'validate' },
      { singletonKey: `${ctx.workspaceId}:validate:${importId}`, retryLimitOverride: 0 },
    );
    const row = inserted[0];
    if (row === undefined) throw new Error('INSERT do imports nevrátil řádek.');
    return row;
  });
}

/** Detekce běží ve fázi validating a zapisuje kódování, oddělovač a návrh mapování. */
export async function detectAndPreview(
  ctx: WorkspaceContext,
  importId: string,
): Promise<{
  encoding: DetectedEncoding;
  dialect: Dialect;
  mapping: ImportMapping;
  header: string[];
}> {
  const row = await loadImport(ctx, importId);
  assertTransition(statusOf(row), 'validating');
  if (row.storage_key === null) notFoundImport('import_not_found', importId);
  const limits = importLimits();
  const head = await readHead(row.storage_key, limits.sniffBytes);
  const encoding = detectEncoding(head, limits.sniffBytes);
  const sample = decodeSampleFor(head, encoding);
  const dialect = detectDialect(sample);
  const header = dialect.hasHeader
    ? (sample.split(/\r\n|\n|\r/)[0] ?? '').split(dialect.delimiter)
    : [];
  const mapping = Object.keys(row.mapping ?? {}).length > 0 ? row.mapping : suggestMapping(header);

  await inWorkspaceTx(ctx, (tx) =>
    tx.execute(sql`
      UPDATE imports SET status = 'previewing', encoding = ${encoding.encoding},
        encoding_source = ${encoding.source}, delimiter = ${dialect.delimiter},
        has_header = ${dialect.hasHeader}, mapping = ${JSON.stringify(mapping)}::jsonb,
        updated_at = now()
      WHERE id = ${importId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid`),
  );
  return { encoding, dialect, mapping, header };
}

/**
 * Hlavička souboru, čtená při KAŽDÉM náhledu, ne jen při detekci.
 *
 * `detectAndPreview()` hlavičku vrací, jenže běží jedinkrát, na přechodu
 * pending → previewing. Druhé a každé další volání náhledu ji tedy nemělo
 * odkud vzít a posílalo prázdné pole, takže krok Mapování neuměl vypsat ani
 * jeden sloupec souboru. Vada se nedala vidět na první obrazovce a projevila
 * se teprve při návratu o krok zpět.
 *
 * Kódování se bere ze záznamu (uživatel ho v kroku 2 mohl přepsat), ale
 * délka BOM z čerstvé detekce: bez ní by první název sloupce začínal
 * neviditelným znakem a přestal by sedět na mapování.
 */
export async function readHeaderRow(row: ImportRow): Promise<string[]> {
  if (row.storage_key === null || !row.has_header) return [];
  const limits = importLimits();
  const head = await readHead(row.storage_key, limits.sniffBytes);
  const detected = detectEncoding(head, limits.sniffBytes);
  const sample = decodeSampleFor(head, {
    encoding: (row.encoding ?? detected.encoding) as DetectedEncoding['encoding'],
    source: 'manual',
    bomLength: detected.bomLength,
  });
  return (sample.split(/\r\n|\n|\r/)[0] ?? '').split(row.delimiter ?? ';');
}

export async function patchImport(
  ctx: WorkspaceContext,
  importId: string,
  patch: {
    mapping?: ImportMapping;
    options?: Partial<ImportOptions>;
    encoding?: string;
    delimiter?: string;
  },
): Promise<ImportRow> {
  const row = await loadImport(ctx, importId);
  if (row.status !== 'previewing') {
    conflictImport('invalid_state_transition', { from: row.status });
  }
  if (patch.mapping !== undefined) assertMappingValid(patch.mapping);
  const mappingJson = patch.mapping === undefined ? null : JSON.stringify(patch.mapping);
  const optionsJson =
    patch.options === undefined ? null : JSON.stringify(ImportOptionsSchema.parse(patch.options));
  const encoding = patch.encoding ?? null;
  const { rows } = await inWorkspaceTx(ctx, (tx) =>
    tx.execute<ImportRow>(sql`
      UPDATE imports SET
        mapping  = coalesce(${mappingJson}::jsonb, mapping),
        options  = coalesce(${optionsJson}::jsonb, options),
        encoding = coalesce(${encoding}::text, encoding),
        encoding_source = CASE WHEN ${encoding}::text IS NULL THEN encoding_source ELSE 'manual' END,
        delimiter = coalesce(${patch.delimiter ?? null}::text, delimiter),
        -- Spočítaný počet řádků platí pro JEDNU dvojici kódování a oddělovače.
        -- Když uživatel kterékoli z nich přepíše, rozpadne se soubor na jiný
        -- počet řádků a uložené číslo by lhalo. Zahodí se, náhled ho spočítá
        -- znovu.
        total_rows = CASE
          WHEN ${encoding}::text IS NULL AND ${patch.delimiter ?? null}::text IS NULL
          THEN total_rows ELSE NULL END,
        updated_at = now()
      WHERE id = ${importId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid RETURNING *`),
  );
  const updated = rows[0];
  if (updated === undefined) notFoundImport('import_not_found', importId);
  return updated;
}

export async function confirmImport(ctx: WorkspaceContext, importId: string): Promise<ImportRow> {
  const row = await loadImport(ctx, importId);
  assertTransition(statusOf(row), 'importing');
  assertMappingValid(row.mapping);
  return inWorkspaceTx(ctx, async (tx) => {
    // Jeden běžící import na projekt. Podmínka je v SQL, ne v aplikaci,
    // protože dva souběžné požadavky by kontrolu v aplikaci proběhly oba.
    const { rows: running } = await tx.execute<{ id: string }>(sql`
      SELECT id FROM imports
       WHERE workspace_id = ${ctx.workspaceId}::uuid AND status = 'importing'
         AND id <> ${importId}::uuid LIMIT 1`);
    const blocker = running[0];
    if (blocker !== undefined) {
      lockedImport('import_already_running', { runningImportId: blocker.id });
    }
    const { rows: updated } = await tx.execute<ImportRow>(sql`
      UPDATE imports SET status = 'importing', started_at = now(), updated_at = now()
       WHERE id = ${importId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND status = 'previewing' RETURNING *`);
    const confirmed = updated[0];
    if (confirmed === undefined) conflictImport('invalid_state_transition', { from: row.status });
    await enqueueImportJob(
      tx,
      'contacts.import',
      { workspaceId: ctx.workspaceId, importId, phase: 'run' },
      { singletonKey: importId, retryLimitOverride: 0 },
    );
    await auditImport(tx, ctx, 'import.confirmed', importId, { filename: row.filename });
    return confirmed;
  });
}

export async function cancelImport(
  ctx: WorkspaceContext,
  importId: string,
): Promise<{ status: 'cancelled'; failureDetail: string }> {
  return inWorkspaceTx(ctx, async (tx) => {
    const { rows: updated } = await tx.execute<{ failure_detail: string }>(sql`
      UPDATE imports SET status = 'cancelled', finished_at = now(), updated_at = now(),
        failure_detail = 'zrušeno uživatelem na řádku ' || checkpoint_row
                       || ' z ' || coalesce(total_rows::text, '?')
       WHERE id = ${importId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND status IN ('previewing','importing') RETURNING failure_detail`);
    const row = updated[0];
    if (row === undefined) conflictImport('invalid_state_transition', {});
    await auditImport(tx, ctx, 'import.cancelled', importId, {});
    return { status: 'cancelled' as const, failureDetail: String(row.failure_detail) };
  });
}

/** Pokračování zakládá NOVÝ import se stejným souborem a checkpointem předchozího. */
export async function resumeImport(
  ctx: WorkspaceContext,
  importId: string,
): Promise<{ id: string; checkpointByte: number; resumeFromImportId: string }> {
  const source = await loadImport(ctx, importId);
  if (source.status !== 'cancelled') {
    conflictImport('invalid_state_transition', { from: source.status });
  }
  return inWorkspaceTx(ctx, async (tx) => {
    const key = buildIdempotencyKey({
      contentSha256: source.content_sha256,
      workspaceId: ctx.workspaceId,
      mapping: source.mapping,
      options: source.options,
      nonce: `resume:${importId}`,
    });
    const { rows: inserted } = await tx.execute<{ id: string; checkpoint_byte: number }>(sql`
      INSERT INTO imports (id, workspace_id, filename, storage_key, byte_size, content_sha256,
                           idempotency_key, status, mapping, options, checkpoint_row,
                           checkpoint_byte, total_rows, resume_from_import_id, created_by,
                           file_expires_at)
      VALUES (uuidv7(), ${ctx.workspaceId}::uuid, ${source.filename}, ${source.storage_key},
              ${source.byte_size}, ${source.content_sha256}, ${key}, 'previewing',
              ${JSON.stringify(source.mapping)}::jsonb, ${JSON.stringify(source.options)}::jsonb,
              ${source.checkpoint_row}, ${source.checkpoint_byte}, ${source.total_rows},
              ${importId}::uuid, ${actorUserId(ctx)}::uuid, now() + interval '30 days')
      RETURNING id, checkpoint_byte`);
    const row = inserted[0];
    if (row === undefined) throw new Error('INSERT pokračování importu nevrátil řádek.');
    return {
      id: row.id,
      checkpointByte: Number(row.checkpoint_byte),
      resumeFromImportId: importId,
    };
  });
}

/**
 * Uloží odhadovaný počet řádků. Volá se z náhledu, jakmile je odhad hotový.
 *
 * Bez tohohle zápisu zůstane `imports.total_rows` navždy NULL, přestože se čte:
 * hláška o zrušení skládá `… || ' z ' || coalesce(total_rows::text, '?')`, takže
 * by uživateli vždycky napsala „zrušeno na řádku 4200 z ?". Je to typ chyby,
 * kterou testy neodhalí, protože `'?'` je platný řetězec a hláška se sestaví.
 */
export async function setTotalRows(
  ctx: WorkspaceContext,
  importId: string,
  totalRows: number,
): Promise<void> {
  await inWorkspaceTx(ctx, (tx) =>
    tx.execute(sql`
      UPDATE imports SET total_rows = ${totalRows}, updated_at = now()
       WHERE id = ${importId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid`),
  );
}

/** Dokončení importu označí všechny dynamické segmenty projektu za zastaralé. */
export async function finishImport(
  ctx: WorkspaceContext,
  importId: string,
  errorRows: number,
): Promise<void> {
  await inWorkspaceTx(ctx, (tx) =>
    tx.execute(sql`
      UPDATE imports SET status = ${errorRows > 0 ? 'completed_with_errors' : 'completed'},
        finished_at = now(), updated_at = now()
       WHERE id = ${importId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid`),
  );
  await markAllStale(ctx);
}
