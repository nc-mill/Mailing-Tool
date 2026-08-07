import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { createSystemContext } from '../../../identity/context';
import { importLogger } from '../logging';
import { inWorkspaceTx } from '../db';
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

/**
 * `phase` zůstává v payloadu kvůli úlohám, které ve frontě mohou ležet z dřívějška,
 * ale jediná hodnota, se kterou se dnes zařazuje, je `run`, a zařazuje ji výhradně
 * `confirmImport()`. Zápis kontaktů se navíc řídí STAVEM importu, ne payloadem;
 * viz strážce v `handler` níž.
 */
export type ImportJobPayload = {
  workspaceId: string;
  importId: string;
  phase?: 'validate' | 'run';
};

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

/**
 * Zapisuje se JEN import ve stavu `importing`, tedy ten, který člověk potvrdil
 * tlačítkem „Naimportovat".
 *
 * Strážce je tu proto, že bez něj obsluha zapisovala kontakty pro jakoukoli úlohu,
 * která se ve frontě octla, včetně té zařazované hned po nahrání souboru. Průvodce
 * tím ztrácel smysl: volby ze čtvrtého a pátého kroku (seznam, štítek, souhlas,
 * chování při konfliktu) se ukládaly do importu, který už byl dokončený, takže se
 * na datech nikdy neprojevily a kontakt skončil bez seznamu.
 *
 * Stav se čte ze `imports`, ne z payloadu úlohy: payload je jen přání volajícího,
 * kdežto stav je doklad, že přechodem `previewing → importing` prošel `confirmImport()`.
 */
async function isConfirmed(
  ctx: ReturnType<typeof createSystemContext>,
  importId: string,
): Promise<boolean> {
  const { rows } = await inWorkspaceTx(ctx, (tx) =>
    tx.execute<{ status: string }>(sql`
      SELECT status FROM imports
       WHERE id = ${importId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid`),
  );
  return rows[0]?.status === 'importing';
}

export const handler = async (job: {
  data: ImportJobPayload;
}): Promise<{ processed: number; errorRows: number }> => {
  const ctx = createSystemContext(job.data.workspaceId, 'contacts.import');
  if (!(await isConfirmed(ctx, job.data.importId))) {
    importLogger().warn(
      { importId: job.data.importId, phase: job.data.phase },
      'import job skipped: import is not in state importing',
    );
    return { processed: 0, errorRows: 0 };
  }
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
      // Celé volby, ne jen `on_conflict`: seznamy, štítky a souhlas se aplikují uvnitř
      // transakce dávky. Dřív se sem předával jen režim konfliktu, takže zbytek voleb
      // se sice uložil a validoval, ale na datech se nikdy neprojevil.
      options: run.options,
      rows: deduped.rows,
      errors: allErrors,
      // Řádky PŘEČTENÉ ze souboru, tedy vstup téhle dávky před jakýmkoli tříděním.
      // `processed += pending.length` níž počítá totéž číslo pro živý průběh, takže
      // se to, co se ukládá, a to, co se posílá na obrazovku, nemůže rozejít.
      inputRows: pending.length,
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

  /*
   * CHYBĚJÍCÍ SOUBOR IMPORT UZAVŘE, NEZKOUŠÍ SE DONEKONEČNA.
   *
   * Nahraný soubor se po čase uklízí retencí (`import_files`, 30 dní), kdežto
   * řádek v `imports` zůstává. Import zaseknutý ve stavu `importing`, jehož
   * soubor už neexistuje, se tedy NIKDY nemůže povést.
   *
   * Bez tohohle bloku to bylo horší než jen zbytečný pokus: `confirmImport`
   * odmítá KAŽDÝ další import v projektu, dokud takový řádek leží
   * (`import_already_running`). Obnova zaseknutých importů ho každých deset
   * minut zařadila znovu, pokaždé spadla na `ENOENT` a projekt zůstal
   * se zamčeným importováním napořád. Naměřeno 7. 8. na skutečném případu.
   *
   * Uzavírá se sem, ne do obnovy: soubor může zmizet i mezi zařazením a během,
   * a tohle je jediné místo, kterým projdou obě cesty.
   */
  if (!existsSync(path)) {
    importLogger().warn(
      { importId: job.data.importId, storageKey: run.storageKey },
      'import closed as failed: uploaded file is gone',
    );
    await inWorkspaceTx(ctx, (tx) =>
      tx.execute(sql`
        UPDATE imports
           SET status = 'failed', finished_at = now(), updated_at = now()
         WHERE id = ${job.data.importId}::uuid
           AND workspace_id = ${ctx.workspaceId}::uuid
           AND status = 'importing'`),
    );
    return { processed: 0, errorRows: 0 };
  }

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
