import type { ProcessedOkRow } from './row-pipeline';

export type RowNote = { rowNumber: number; code: 'duplicate_in_file' };
export type DedupeResult = { rows: ProcessedOkRow[]; warnings: RowNote[]; errors: RowNote[] };

export class BatchDeduper {
  /** Úroveň B, paměťová. Vypíná se nad prahem, úroveň A běží vždy. */
  readonly crossBatchEnabled: boolean;
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly opts: { mode: 'last' | 'first' | 'error'; inMemoryMaxRows: number },
  ) {
    this.crossBatchEnabled = opts.inMemoryMaxRows > 0;
  }

  /**
   * Úroveň A: povinná deduplikace UVNITŘ dávky. Mapa je velká jako dávka,
   * tedy jednotky desítek kilobajtů. ON CONFLICT řeší duplicity MEZI příkazy,
   * ne uvnitř jednoho: dvě stejné adresy v jednom `INSERT ... ON CONFLICT`
   * PostgreSQL odmítne chybou 21000, ta shodí transakci dávky, job má
   * retryLimit = 0 a import se v tom místě zasekne natrvalo. Tohle rozdělení
   * se proto nesmí sloučit zpět.
   */
  dedupeBatch(rows: ProcessedOkRow[]): DedupeResult {
    const byEmail = new Map<string, ProcessedOkRow>();
    const warnings: RowNote[] = [];
    const errors: RowNote[] = [];

    for (const row of rows) {
      const previous = byEmail.get(row.email);
      if (previous !== undefined) {
        if (this.opts.mode === 'error') {
          errors.push({ rowNumber: row.rowNumber, code: 'duplicate_in_file' });
          continue;
        }
        if (this.opts.mode === 'first') {
          warnings.push({ rowNumber: row.rowNumber, code: 'duplicate_in_file' });
          continue;
        }
        warnings.push({ rowNumber: previous.rowNumber, code: 'duplicate_in_file' });
        byEmail.set(row.email, row);
        continue;
      }
      if (this.crossBatchEnabled) {
        const earlier = this.seen.get(row.email);
        if (earlier !== undefined) {
          if (this.opts.mode === 'error') {
            errors.push({ rowNumber: row.rowNumber, code: 'duplicate_in_file' });
            continue;
          }
          warnings.push({
            rowNumber: this.opts.mode === 'first' ? row.rowNumber : earlier,
            code: 'duplicate_in_file',
          });
          if (this.opts.mode === 'first') continue;
        }
        if (this.seen.size < this.opts.inMemoryMaxRows) this.seen.set(row.email, row.rowNumber);
      }
      byEmail.set(row.email, row);
    }

    return {
      rows: [...byEmail.values()].sort((a, b) => a.rowNumber - b.rowNumber),
      warnings,
      errors,
    };
  }
}
