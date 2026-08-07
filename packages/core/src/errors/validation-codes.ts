import type { ValidationCodeEntry } from './types';

/**
 * `errors[].code`, tedy důvod na úrovni pole u validation_failed.
 * Zdroje: část 1, 4.2; část 2, 2.3; část 3, kapitoly o blokovém schématu
 * a Liquid subsetu.
 */
export const VALIDATION_CODES: readonly ValidationCodeEntry[] = [
  // Obecné typové chyby, část 1, 4.2
  { code: 'invalid_email', domain: 'platform', source: 'spec' },
  { code: 'expected_number', domain: 'platform', source: 'spec' },
  { code: 'expected_string', domain: 'platform', source: 'derived' },
  { code: 'expected_boolean', domain: 'platform', source: 'derived' },
  { code: 'unknown_key', domain: 'platform', source: 'spec' },
  { code: 'required', domain: 'platform', source: 'derived' },

  // Kontakty a pole, část 2, 2.3
  { code: 'email_too_long', domain: 'contacts', source: 'spec' },
  { code: 'invalid_number', domain: 'contacts', source: 'spec' },
  { code: 'invalid_boolean', domain: 'contacts', source: 'spec' },
  { code: 'invalid_date', domain: 'contacts', source: 'spec' },
  { code: 'invalid_enum_value', domain: 'contacts', source: 'spec' },
  { code: 'value_too_long', domain: 'contacts', source: 'spec' },
  { code: 'required_field_missing', domain: 'contacts', source: 'spec' },
  { code: 'unknown_field_key', domain: 'contacts', source: 'spec' },
  { code: 'field_key_reserved', domain: 'contacts', source: 'spec' },
  { code: 'field_limit_reached', domain: 'contacts', source: 'spec' },
  { code: 'indexed_field_limit_reached', domain: 'contacts', source: 'spec' },
  { code: 'field_type_immutable', domain: 'contacts', source: 'spec' },
  { code: 'field_used_by_scheduled_campaign', domain: 'contacts', source: 'spec' },
  { code: 'retention_below_minimum', domain: 'contacts', source: 'spec' },
  { code: 'import_duplicate', domain: 'contacts', source: 'spec' },
  { code: 'import_already_running', domain: 'contacts', source: 'spec' },
  // Devět kódů doplněných po nálezu P11. Jeho test v úkolu 2 vyžaduje, aby
  // každá položka IMPORT_ERROR_CODES a SEGMENT_ERROR_CODES byla v registru,
  // a tyhle v něm chyběly. Jsou to chyby na úrovni CELÉHO SOUBORU nebo definice,
  // ne řádku: řádkové kódy importu mají vlastní druh IMPORT_ROW_CODES.
  { code: 'no_email_column_mapped', domain: 'contacts', source: 'spec' },
  { code: 'file_too_large', domain: 'contacts', source: 'spec' },
  { code: 'too_many_rows', domain: 'contacts', source: 'spec' },
  { code: 'too_many_columns', domain: 'contacts', source: 'spec' },
  { code: 'empty_file', domain: 'contacts', source: 'spec' },
  { code: 'unsupported_encoding', domain: 'contacts', source: 'spec' },
  { code: 'malformed_csv', domain: 'contacts', source: 'spec' },
  { code: 'storage_unavailable', domain: 'contacts', source: 'spec' },
  { code: 'audience_empty', domain: 'contacts', source: 'spec' },
  { code: 'subscribe_blocked_suppressed', domain: 'contacts', source: 'spec' },
  { code: 'subscribe_blocked_complaint', domain: 'contacts', source: 'spec' },
  { code: 'suppression_not_removable', domain: 'contacts', source: 'spec' },
  { code: 'suppression_too_recent', domain: 'contacts', source: 'spec' },
  { code: 'gdpr_not_verified', domain: 'contacts', source: 'spec' },
  { code: 'segment_invalid_ast', domain: 'contacts', source: 'spec' },
  { code: 'segment_operator_not_allowed', domain: 'contacts', source: 'spec' },
  { code: 'segment_invalid_range', domain: 'contacts', source: 'spec' },
  { code: 'segment_too_complex', domain: 'contacts', source: 'spec' },
  { code: 'segment_too_deep', domain: 'contacts', source: 'spec' },
  { code: 'segment_cycle', domain: 'contacts', source: 'spec' },
  { code: 'segment_list_too_long', domain: 'contacts', source: 'spec' },
  { code: 'segment_nesting_too_deep', domain: 'contacts', source: 'spec' },
  { code: 'segment_definition_too_large', domain: 'contacts', source: 'spec' },
  { code: 'segment_reference_not_found', domain: 'contacts', source: 'spec' },
  { code: 'segment_too_many_engagement', domain: 'contacts', source: 'spec' },
  { code: 'segment_too_many_event', domain: 'contacts', source: 'spec' },
  { code: 'segment_preview_timeout', domain: 'contacts', source: 'spec' },

  // Blokový dokument a Liquid subset, část 3
  { code: 'content_duplicate_block_id', domain: 'content', source: 'spec' },
  { code: 'content_duplicate_footer', domain: 'content', source: 'spec' },
  { code: 'content_document_too_large', domain: 'content', source: 'spec' },
  { code: 'content_nested_columns', domain: 'content', source: 'spec' },
  { code: 'content_nested_repeat', domain: 'content', source: 'spec' },
  { code: 'content_raw_html_forbidden', domain: 'content', source: 'spec' },
  { code: 'content_reserved_marker', domain: 'content', source: 'spec' },
  /*
   * Tři kódy profilu `page`, tedy veřejné stránky navržené v Builderu.
   *
   * Řetězce se sem NEOPISUJÍ z hlavy: vlastní je `PAGE_ISSUE_CODES`
   * v `@mlain/emails/document/profile`, protože je vydává validátor dokumentu.
   * Registr je jen musí znát, jinak `ApiError` odmítne nález vyrobit a odmítnuté
   * uložení stránky skončí pětistovkou.
   *
   * Kódy jsou TŘI, ne jeden společný „tohle na stránku nepatří":
   *  - patička s odhlašovacím odkazem na veřejné stránce nedává smysl,
   *  - blok syrového HTML je bezpečnostní rozhodnutí (stránka běží na naší
   *    doméně, vložený obsah může předstírat cizí značku),
   *  - nedostupná personalizace je vada obsahu, ne zákaz bloku.
   * Uživatel podle kódu pozná, co má udělat, což jeden slitý kód neumí.
   */
  { code: 'content_footer_forbidden_on_page', domain: 'content', source: 'spec' },
  { code: 'content_html_forbidden_on_page', domain: 'content', source: 'spec' },
  { code: 'content_variable_not_on_surface', domain: 'content', source: 'spec' },
  { code: 'content_link_scheme_forbidden', domain: 'content', source: 'spec' },
  { code: 'content_unknown_merge_tag', domain: 'content', source: 'spec' },
  { code: 'content_asset_not_found', domain: 'content', source: 'spec' },
  { code: 'content_condition_field_unknown', domain: 'content', source: 'spec' },
  { code: 'content_condition_operator_invalid', domain: 'content', source: 'spec' },
  { code: 'content_condition_on_unsubscribe', domain: 'content', source: 'spec' },
  { code: 'compile_campaign_id_required', domain: 'content', source: 'spec' },
  { code: 'liquid_tag_not_allowed', domain: 'content', source: 'spec' },
  { code: 'liquid_filter_not_allowed', domain: 'content', source: 'spec' },
  { code: 'liquid_filter_argument_not_allowed', domain: 'content', source: 'spec' },
  { code: 'liquid_string_literal_not_allowed', domain: 'content', source: 'spec' },
  { code: 'liquid_comparison_operator_not_supported', domain: 'content', source: 'spec' },
  { code: 'liquid_contains_not_allowed', domain: 'content', source: 'spec' },
  { code: 'liquid_parentheses_not_allowed', domain: 'content', source: 'spec' },
  { code: 'liquid_index_not_allowed', domain: 'content', source: 'spec' },
  { code: 'liquid_for_parameter_not_allowed', domain: 'content', source: 'spec' },
  { code: 'liquid_nested_for', domain: 'content', source: 'spec' },
  { code: 'liquid_nesting_too_deep', domain: 'content', source: 'spec' },
  { code: 'liquid_path_too_deep', domain: 'content', source: 'spec' },
  { code: 'liquid_unknown_root', domain: 'content', source: 'spec' },
  { code: 'liquid_unknown_field', domain: 'content', source: 'spec' },
  { code: 'liquid_identifier_case', domain: 'content', source: 'spec' },
  { code: 'liquid_unbalanced_block', domain: 'content', source: 'spec' },
  { code: 'liquid_whitespace_control_not_allowed', domain: 'content', source: 'spec' },
  { code: 'liquid_date_format_not_allowed', domain: 'content', source: 'spec' },
  { code: 'liquid_default_value_invalid', domain: 'content', source: 'spec' },
  { code: 'liquid_template_too_large', domain: 'content', source: 'spec' },
  { code: 'liquid_too_many_outputs', domain: 'content', source: 'spec' },
  { code: 'liquid_too_many_loops', domain: 'content', source: 'spec' },
  { code: 'liquid_in_trackable_href', domain: 'content', source: 'spec' },
  { code: 'liquid_vocative_filter', domain: 'content', source: 'spec' },
  { code: 'liquid_escape_not_needed', domain: 'content', source: 'spec' },
  { code: 'liquid_truthy_string_warning', domain: 'content', source: 'spec' },
  { code: 'liquid_type_mismatch_warning', domain: 'content', source: 'spec' },
  { code: 'template_preview_with_contact', domain: 'content', source: 'spec' },

  // Tracking, část 5
  { code: 'tracking_properties_depth_truncated', domain: 'tracking', source: 'spec' },
  { code: 'tracking_properties_keys_dropped', domain: 'tracking', source: 'spec' },
  { code: 'tracking_properties_value_truncated', domain: 'tracking', source: 'spec' },
];
