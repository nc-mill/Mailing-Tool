import type { ImportRowCodeEntry } from './types';

/**
 * Hodnoty sloupce import_errors.error_code. Do HTTP odpovědi se nepromítají
 * vůbec, import je asynchronní. Chyba znamená, že se řádek neimportoval;
 * varování znamená, že se importoval a jen se označil.
 */
export const IMPORT_ROW_CODES: readonly ImportRowCodeEntry[] = [
  { code: 'row_field_count_mismatch', severity: 'error', source: 'spec' },
  { code: 'email_missing', severity: 'error', source: 'spec' },
  { code: 'email_invalid', severity: 'error', source: 'spec' },
  { code: 'email_too_long', severity: 'error', source: 'spec' },
  { code: 'email_domain_invalid', severity: 'error', source: 'spec' },
  { code: 'email_disposable', severity: 'error', source: 'spec' },
  { code: 'duplicate_in_file', severity: 'error', source: 'spec' },
  { code: 'invalid_number', severity: 'error', source: 'spec' },
  { code: 'invalid_boolean', severity: 'error', source: 'spec' },
  { code: 'invalid_date', severity: 'error', source: 'spec' },
  { code: 'invalid_datetime', severity: 'error', source: 'spec' },
  { code: 'invalid_enum_value', severity: 'error', source: 'spec' },
  { code: 'invalid_url', severity: 'error', source: 'spec' },
  { code: 'invalid_phone', severity: 'error', source: 'spec' },
  { code: 'value_too_long', severity: 'error', source: 'spec' },
  { code: 'required_field_missing', severity: 'error', source: 'spec' },
  { code: 'unknown_field_key', severity: 'error', source: 'spec' },
  { code: 'encoding_error', severity: 'error', source: 'spec' },
  { code: 'name_empty', severity: 'error', source: 'spec' },
  { code: 'list_not_found', severity: 'error', source: 'spec' },
  { code: 'delimiter_not_detected', severity: 'error', source: 'spec' },
  { code: 'name_split_low_confidence', severity: 'warning', source: 'spec' },
  { code: 'vietnamese_order_assumed', severity: 'warning', source: 'spec' },
  { code: 'gender_unknown', severity: 'warning', source: 'spec' },
  { code: 'gender_conflict', severity: 'warning', source: 'spec' },
  { code: 'vocative_low_confidence', severity: 'warning', source: 'spec' },
  { code: 'non_latin_script', severity: 'warning', source: 'spec' },
  { code: 'value_truncated', severity: 'warning', source: 'spec' },
  { code: 'excel_serial_date_assumed', severity: 'warning', source: 'spec' },
  { code: 'number_format_ambiguous', severity: 'warning', source: 'spec' },
  { code: 'suppressed_skipped', severity: 'warning', source: 'spec' },
  { code: 'trailing_fields_padded', severity: 'warning', source: 'spec' },
];
