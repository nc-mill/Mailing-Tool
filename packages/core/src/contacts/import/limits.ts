import { loadConfig } from '../../config/index';

export type ImportLimits = {
  maxFileBytes: number;
  maxRows: number;
  maxColumns: number;
  maxCellChars: number;
  maxLineBytes: number;
  batchSize: number;
  maxStoredErrors: number;
  sniffBytes: number;
  previewTtlHours: number;
  staleMinutes: number;
  inMemoryDedupMaxRows: number;
  dataDir: string;
};

let cached: ImportLimits | null = null;

/**
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM: plán psal `import { config }`.
 * P01 žádný takový singleton nemá, vystavuje `loadConfig()`. Čte se líně
 * a jednou, jinak by se modul nedal naimportovat bez kompletního prostředí
 * a shodil by každý jednotkový test, který se ho jen dotkne.
 */
export function importLimits(): ImportLimits {
  if (cached === null) {
    const config = loadConfig();
    cached = {
      maxFileBytes: config.IMPORT_MAX_FILE_BYTES,
      maxRows: config.IMPORT_MAX_ROWS,
      maxColumns: config.IMPORT_MAX_COLUMNS,
      maxCellChars: config.IMPORT_MAX_CELL_CHARS,
      maxLineBytes: config.IMPORT_MAX_LINE_BYTES,
      batchSize: config.IMPORT_BATCH_SIZE,
      maxStoredErrors: config.IMPORT_MAX_STORED_ERRORS,
      sniffBytes: config.IMPORT_SNIFF_BYTES,
      previewTtlHours: config.IMPORT_PREVIEW_TTL_HOURS,
      staleMinutes: config.IMPORT_STALE_MINUTES,
      inMemoryDedupMaxRows: config.IMPORT_INMEMORY_DEDUP_MAX_ROWS,
      dataDir: config.DATA_DIR,
    };
  }
  return cached;
}

/** Jen pro testy: zapomene načtenou konfiguraci, aby šlo přepnout prostředí. */
export function resetImportLimits(): void {
  cached = null;
}
