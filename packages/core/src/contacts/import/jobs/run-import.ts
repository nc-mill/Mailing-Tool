import { join } from 'node:path';
import { createSystemContext } from '../../../identity/context';
import { importLogger } from '../logging';
import { checkSuppression } from '../../repo/suppressions';
import { normalizeEmail } from '../../email';
import { writeBatch, type ErrRow } from '../batch';
import { BatchDeduper } from '../dedup';
import { importLimits } from '../limits';
import { flushProgress, publishProgress } from '../progress';
import { readRows, type RawRow } from '../reader';
import { loadRunContext } from '../run-context';
import { processRow, type ProcessedOkRow, type ProcessedRow } from '../row-pipeline';
import { finishImport } from '../service';

export type ImportJobPayload = { workspaceId: string; importId: string; phase: 'validate' | 'run' };

/**
 * Suppression se čte PO DÁVKÁCH, ne jednou pro celý projekt: projekt může mít
 * miliony potlačených adres a jejich načtení do paměti by import shodilo dřív,
 * než by přečetl první řádek. Dotaz je jeden na dávku, tedy jeden na tisíc řádků.
 */
async function suppressionFor(
  ctx: ReturnType<typeof createSystemContext>,
  rows: RawRow[],
  emailColumn: number,
): Promise<Map<string, string>> {
  const candidates: string[] = [];
  for (const row of rows) {
    const raw = row.fields[emailColumn];
    if (raw === undefined || raw.trim().length === 0) continue;
    const parsed = normalizeEmail(raw.trim());
    if (parsed.ok) candidates.push(parsed.email);
  }
  const out = new Map<string, string>();
  if (candidates.length === 0) return out;
  const hits = await checkSuppression(ctx, candidates);
  for (const [email, hit] of hits) out.set(email, hit.reason);
  return out;
}

export const handler = async (job: {
  data: ImportJobPayload;
}): Promise<{ processed: number; errorRows: number }> => {
  const ctx = createSystemContext(job.data.workspaceId, 'contacts.import');
  const limits = importLimits();
  const run = await loadRunContext(ctx, job.data.importId);
  const deduper = new BatchDeduper({
    mode: run.options.duplicate_in_file,
    inMemoryMaxRows:
      (run.totalRows ?? 0) > limits.inMemoryDedupMaxRows ? 0 : limits.inMemoryDedupMaxRows,
  });

  const emailColumn = Number(
    Object.entries(run.mapping).find(([, m]) => m.target === 'email')?.[0] ?? '0',
  );

  let pending: RawRow[] = [];
  let processed = 0;
  let errorRows = 0;
  let lastRow = run.checkpointRow;
  let lastByte = run.checkpointByte;

  const flush = async (checkpointRow: number, checkpointByte: number): Promise<void> => {
    if (pending.length === 0) return;
    const suppressed = await suppressionFor(ctx, pending, emailColumn);
    const batch: ProcessedRow[] = pending.map((raw) =>
      processRow(raw, { ...run.rowContext, suppressed }),
    );
    const ok = batch.filter((r): r is ProcessedOkRow => r.kind === 'ok');
    const errors = batch.filter(
      (r): r is Extract<ProcessedRow, { kind: 'error' }> => r.kind === 'error',
    );
    const suppressedCount = batch.filter((r) => r.kind === 'suppressed').length;
    const deduped = deduper.dedupeBatch(ok);

    // Chyby i varování jdou do JEDNOHO seznamu rozlišeného polem severity.
    // Dvě oddělené kolekce byly důvod, proč varovné řádky nikdy nevznikly:
    // počítaly se do warning_rows, ale do import_errors se zapisovaly jen chyby.
    const allErrors: ErrRow[] = [
      ...errors.map((e) => ({
        rowNumber: e.rowNumber,
        errorCode: e.errorCode,
        severity: 'error' as const,
        column: e.column,
        detail: e.detail,
        raw: e.raw,
      })),
      ...deduped.errors.map((e) => ({
        rowNumber: e.rowNumber,
        errorCode: e.code,
        severity: 'error' as const,
        raw: '',
      })),
      ...deduped.warnings.map((w) => ({
        rowNumber: w.rowNumber,
        errorCode: w.code,
        severity: 'warning' as const,
        raw: '',
      })),
      ...deduped.rows.flatMap((r) =>
        r.warnings.map((code) => ({
          rowNumber: r.rowNumber,
          errorCode: code,
          severity: 'warning' as const,
          raw: '',
        })),
      ),
    ];
    errorRows += allErrors.filter((e) => e.severity === 'error').length;

    await writeBatch(ctx, {
      importId: job.data.importId,
      mode: run.options.on_conflict,
      rows: deduped.rows,
      errors: allErrors,
      checkpointRow,
      checkpointByte,
      suppressedCount,
      maxStoredErrors: limits.maxStoredErrors,
    });
    processed += pending.length;
    pending = [];
    await publishProgress(ctx, job.data.importId, {
      processed,
      total: run.totalRows,
      errors: errorRows,
    });
  };

  const path = join(limits.dataDir, run.storageKey);
  for await (const raw of readRows(path, {
    dialect: run.dialect,
    encoding: run.encoding,
    maxCellChars: limits.maxCellChars,
    maxLineBytes: limits.maxLineBytes,
    ...(run.checkpointByte > 0 ? { startByte: run.checkpointByte } : {}),
    ...(run.checkpointRow > 0 ? { startRowNumber: run.checkpointRow } : {}),
  })) {
    if (await run.isCancelled()) break;
    pending.push(raw);
    lastRow = raw.rowNumber;
    lastByte = raw.byteOffsetAfter;
    if (pending.length >= limits.batchSize) await flush(lastRow, lastByte);
  }
  await flush(lastRow, lastByte);

  const cancelled = await run.isCancelled();
  if (!cancelled) await finishImport(ctx, job.data.importId, errorRows);
  flushProgress(ctx, job.data.importId, {
    processed,
    total: run.totalRows,
    errors: errorRows,
  });
  importLogger().info({ importId: job.data.importId, processed, errorRows }, 'import finished');
  return { processed, errorRows };
};
