import { describe, expect, it } from 'vitest';
import { ALL_REGISTERED_CODES, isRegisteredCode } from '../errors/index';
import { queueNames } from '../queues/index';
import { ConfigSchema } from '../config/schema';

/**
 * Registrů se ptáme přes `isRegisteredCode()` a `queueNames()`, NE indexací.
 *
 * `ERROR_CODES` je sice plochá mapa podle kódu, ale obsahuje JEN druh `problem`,
 * protože jen ten má HTTP status. Většina kódů tohohle plánu je druhu
 * `validation`, `finding` nebo `import_row`, takže `Object.keys(ERROR_CODES)`
 * by je nenašlo ani tehdy, kdyby v registru byly, a test by hlásil chybu
 * z falešného důvodu. Totéž u front: `QUEUE_REGISTRY` je pole, ne objekt.
 *
 * Test je ČTECÍ. Jeho selhání je nález proti P01, ne důvod něco dopsat:
 * registr, do kterého sahá šestnáct plánů, je přesně to místo, kde uzávěry
 * S7, S8 a S12 existují.
 */
const IMPORT_ERROR_CODES = [
  'import_duplicate',
  'import_already_running',
  'no_email_column_mapped',
  'file_too_large',
  'too_many_rows',
  'too_many_columns',
  'empty_file',
  'unsupported_encoding',
  'delimiter_not_detected',
  'malformed_csv',
  'storage_unavailable',
  'contact_limit_reached',
];

/** Řádkové kódy importu. Do HTTP odpovědi se nepromítají, žijí v import_errors. */
const IMPORT_ROW_CODES = [
  'required_field_missing',
  'invalid_number',
  'invalid_boolean',
  'invalid_enum_value',
  'invalid_phone',
  'invalid_url',
  'duplicate_in_file',
  'duplicate_target',
];

const SEGMENT_ERROR_CODES = [
  'segment_invalid_ast',
  'segment_operator_not_allowed',
  'segment_invalid_range',
  'segment_too_complex',
  'segment_too_deep',
  'segment_too_many_engagement',
  'segment_too_many_event',
  'segment_nesting_too_deep',
  'segment_cycle',
  'segment_list_too_long',
  'segment_definition_too_large',
  'segment_reference_not_found',
  'segment_preview_timeout',
  'audience_empty',
];

/** Varování a provozní kódy. Nejsou to chyby požadavku, ale registrované být musí. */
const OTHER_CODES = [
  'segment_slow_engagement',
  'segment_unindexed_field',
  'export_already_running',
  'cross_workspace_scan_blocked',
];

const ALL_CODES = [
  ...IMPORT_ERROR_CODES,
  ...IMPORT_ROW_CODES,
  ...SEGMENT_ERROR_CODES,
  ...OTHER_CODES,
];

/**
 * NÁLEZ PROTI P01, zapsaný jako data, ne jako smazaný řádek.
 *
 * Tyhle čtyři kódy v registru P01 (`packages/core/src/errors/problem-codes.ts`)
 * dnes NEJSOU. Doména segmentů je NEZAKLÁDÁ: registr vlastní P01 a šestnáct
 * plánů, které do něj sahají, je právě ten důvod, proč se do cizího registru
 * nepíše. Seznam níž drží nález viditelný a zároveň nechává sadu zelenou;
 * jakmile P01 kód doplní, test na to upozorní sám, protože kód přestane
 * v seznamu chybět a `it.each` nad ním začne procházet.
 *
 * Kde ty kódy v téhle doméně žijí do té doby:
 *   segment_slow_engagement, segment_unindexed_field  varování v CompileResult
 *   cross_workspace_scan_blocked                      params chyby service_unavailable
 *   export_already_running                            zatím nikde, patří k bloku B
 *   duplicate_target                                  zatím nikde, patří k bloku B
 *
 * `duplicate_target` je řádkový kód importu a patří do
 * `packages/core/src/errors/import-row-codes.ts`, kde vedle něj `duplicate_in_file`
 * UŽ JE. Chybí tedy jen jeden ze dvojice, což je přesně ten druh mezery, kterou
 * si nikdo nevšimne, dokud import nenarazí na kontakt, který v souboru není
 * dvakrát, ale už v databázi existuje.
 */
const KNOWN_MISSING_IN_P01 = [
  'duplicate_target',
  'segment_slow_engagement',
  'segment_unindexed_field',
  'export_already_running',
  'cross_workspace_scan_blocked',
];

const REQUIRED_CODES = ALL_CODES.filter((c) => !KNOWN_MISSING_IN_P01.includes(c));

const QUEUE_NAMES = [
  'contacts.import',
  'contacts.export',
  'contacts.cleanup_after_reactivation',
  'segments.recount',
];

const CONFIG_VARS = [
  'IMPORT_MAX_FILE_BYTES',
  'IMPORT_MAX_ROWS',
  'IMPORT_MAX_COLUMNS',
  'IMPORT_MAX_CELL_CHARS',
  'IMPORT_MAX_LINE_BYTES',
  'IMPORT_BATCH_SIZE',
  'IMPORT_MAX_STORED_ERRORS',
  'IMPORT_SNIFF_BYTES',
  'IMPORT_WORKER_CONCURRENCY',
  'IMPORT_PREVIEW_TTL_HOURS',
  'IMPORT_STALE_MINUTES',
  'IMPORT_INMEMORY_DEDUP_MAX_ROWS',
  'SEGMENT_PREVIEW_TIMEOUT_MS',
  'SEGMENT_RECOUNT_CONCURRENCY',
  'SEGMENT_MAX_CONDITIONS',
  'EXPORT_TTL_HOURS',
];

describe('registry conformance', () => {
  it('counts what it checks, so nobody trims the list to make it pass', () => {
    expect(ALL_CODES).toHaveLength(38);
    expect(new Set(ALL_CODES).size).toBe(38);
  });

  it.each(REQUIRED_CODES)('error code %s is registered', (code) => {
    expect(isRegisteredCode(code), `${code} chybí v registru P01`).toBe(true);
  });

  it('produces no code outside the registry', () => {
    // Druhá strana téhož: seznam výš hlídá, že plán nepoužívá neregistrovaný
    // kód. Tenhle test hlídá, že se seznam nerozešel se skutečností, protože
    // neregistrovaný kód by `problemCode()` shodil až při první odpovědi API.
    for (const code of REQUIRED_CODES) expect(ALL_REGISTERED_CODES.has(code)).toBe(true);
  });

  it('keeps the P01 finding honest: every known gap is still a gap', () => {
    // Kdyby P01 kód doplnil, tenhle test spadne a přinutí přesunout kód
    // z nálezu mezi vyžadované. Nález se tím nedá zapomenout ani ututlat.
    for (const code of KNOWN_MISSING_IN_P01) {
      expect(isRegisteredCode(code), `${code} už v registru JE, přesuň ho z nálezu`).toBe(false);
    }
  });

  it.each(QUEUE_NAMES)('queue %s is registered', (name) => {
    expect(queueNames(), `fronta ${name} chybí`).toContain(name);
  });

  it.each(CONFIG_VARS)('config variable %s is in the schema', (name) => {
    expect(Object.keys(ConfigSchema.shape)).toContain(name);
  });
});
