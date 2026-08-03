/**
 * Veřejná plocha importu kontaktů, podcesta `@mlain/core/contacts/import`.
 *
 * Co tady NENÍ, je vnitřek: `coerce`, `db` a `run-context` jsou implementační
 * detaily a mimo doménu je nikdo nevolá.
 *
 * Uvnitř domény se importuje RELATIVNĚ a nikdy přes tenhle barrel: to by
 * vyrobilo cyklus přes index a při prvním importu prázdný objekt. Přípona `.js`
 * se nepíše, repozitář jede na `moduleResolution: Bundler`.
 */

// Detekce vstupu
export {
  CZECH_SCORE_TABLE,
  alternativeEncodings,
  decodeSample,
  detectEncoding,
  scoreCandidate,
  type DetectedEncoding,
  type EncodingSource,
  type SupportedEncoding,
} from './encoding';
export { detectDialect, type Delimiter, type Dialect } from './dialect';
export { readRows, type RawRow, type ReadOptions } from './reader';

// Mapování, volby a zpracování řádku
export {
  ImportMappingSchema,
  MAPPING_TARGETS,
  assertMappingValid,
  collectMappingWarnings,
  guessFieldType,
  suggestMapping,
  type GuessedType,
  type ImportMapping,
  type MappingTarget,
} from './mapping';
export {
  ImportOptionsSchema,
  assertOptionsConsistent,
  defaultOptions,
  type ImportOptions,
  type OptionsContext,
} from './options';
export { coerceFieldValue, type Coerced, type FieldSpec } from './coerce';
export {
  processRow,
  type ProcessedOkRow,
  type ProcessedRow,
  type RowContext,
  type RowSettings,
} from './row-pipeline';
export { BatchDeduper, type DedupeResult, type RowNote } from './dedup';

// Zápis, odhad a náhled
export { writeBatch, type BatchInput, type BatchResult, type ErrRow } from './batch';
export { estimateFile, type Estimate, type EstimateContext } from './estimate';
export { buildPreview, type Preview, type PreviewRow } from './preview';
export { buildErrorsCsv, type ErrorCsvInput, type ErrorCsvRow } from './errors-csv';

// Životní cyklus
export { buildIdempotencyKey, type IdempotencyInput } from './idempotency';
export {
  IMPORT_STATES,
  TERMINAL_STATES,
  assertTransition,
  isImportState,
  terminalStateFor,
  type ImportState,
} from './state';
export { deleteUpload, storeUpload, type StoreOptions, type StoredUpload } from './storage';
export { importLimits, resetImportLimits, type ImportLimits } from './limits';
export {
  cancelImport,
  confirmImport,
  createImport,
  detectAndPreview,
  finishImport,
  loadImport,
  patchImport,
  resumeImport,
  setTotalRows,
  type CreateInput,
  type ImportRow,
} from './service';
export { registerProgressSink, type ImportProgress, type ProgressSink } from './progress';

// Chyby a audit
export { importErrorCode, type ImportErrorCode } from './errors';
export { IMPORT_AUDIT_ACTIONS, type ImportAuditAction } from './audit';

// Joby
export { handler as runImportJob, type ImportJobPayload } from './jobs/run-import';
export { recoverStaleImports, type RecoverPayload } from './jobs/recover-stale';
export { runRetention } from './jobs/retention';
