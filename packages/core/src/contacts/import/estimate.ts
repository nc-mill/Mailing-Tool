import { readRows } from './reader';
import { processRow, type RowContext } from './row-pipeline';
import type { Dialect } from './dialect';
import type { DetectedEncoding } from './encoding';

export type EstimateContext = RowContext & {
  dialect: Dialect;
  encoding: DetectedEncoding;
  maxCellChars: number;
  maxLineBytes: number;
  existingEmails: Set<string>;
  /** Nad tímhle počtem se místo přesného odhadu extrapoluje. */
  exactScanLimit?: number;
  byteSize?: number;
};

export type Estimate = {
  totalRows: number;
  newRows: number;
  updatedRows: number;
  skippedRows: number;
  errorRows: number;
  reviewRows: number;
  approximate: boolean;
};

/**
 * Rychlý průchod celým souborem: jen e-mail a jméno, bez zápisu. U souboru nad
 * exactScanLimit se přečte prvních N řádků a zbytek se extrapoluje podle bajtů.
 * Číslo, které uživatel uvidí na tlačítku, se počítá z DATOVÝCH řádků, nikdy
 * z celkového počtu řádků souboru: hlavička není kontakt.
 */
export async function estimateFile(path: string, ctx: EstimateContext): Promise<Estimate> {
  const limit = ctx.exactScanLimit ?? 500_000;
  const out: Estimate = {
    totalRows: 0,
    newRows: 0,
    updatedRows: 0,
    skippedRows: 0,
    errorRows: 0,
    reviewRows: 0,
    approximate: false,
  };
  let scannedBytes = 0;

  for await (const raw of readRows(path, {
    dialect: ctx.dialect,
    encoding: ctx.encoding,
    maxCellChars: ctx.maxCellChars,
    maxLineBytes: ctx.maxLineBytes,
  })) {
    out.totalRows += 1;
    scannedBytes = raw.byteOffsetAfter;
    const processed = processRow(raw, ctx);
    if (processed.kind === 'error') out.errorRows += 1;
    else if (processed.kind === 'suppressed') out.skippedRows += 1;
    else {
      if (ctx.existingEmails.has(processed.email)) out.updatedRows += 1;
      else out.newRows += 1;
      if (processed.contact.vocativeConfidence === 'low') out.reviewRows += 1;
    }
    if (out.totalRows >= limit) {
      out.approximate = true;
      break;
    }
  }

  if (out.approximate && ctx.byteSize !== undefined && scannedBytes > 0) {
    const factor = ctx.byteSize / scannedBytes;
    for (const key of [
      'totalRows',
      'newRows',
      'updatedRows',
      'skippedRows',
      'errorRows',
      'reviewRows',
    ] as const) {
      out[key] = Math.round(out[key] * factor);
    }
  }
  return out;
}
