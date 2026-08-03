/**
 * Veřejná plocha exportu kontaktů, podcesta `@mlain/core/contacts/export`.
 *
 * Uvnitř domény se importuje RELATIVNĚ a nikdy přes tenhle barrel: to by
 * vyrobilo cyklus přes index a při prvním importu prázdný objekt. Přípona `.js`
 * se nepíše, repozitář jede na `moduleResolution: Bundler`.
 */
export {
  FIXED_EXPORT_COLUMNS,
  COLUMN_SQL,
  TAGS_COLUMN_SQL,
  attributeColumnSql,
  isFixedColumn,
  listStatusColumnSql,
  type FixedColumn,
} from './columns';
export { guardCsvCell } from './csv-injection';
export { createFileExportStorage, exportStorageKey, type ExportStorage } from './storage';
export {
  createExport,
  issueExportDownloadToken,
  loadExport,
  verifyDownloadToken,
  type CreateExportInput,
  type CreatedExport,
  type ExportEncoding,
  type ExportRow,
} from './service';
export { handler as runExportJob, type ExportJobPayload } from './jobs/run-export';
