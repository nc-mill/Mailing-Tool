/**
 * Kódy, které se mohou objevit v pruhu nálezů z klientské validace.
 *
 * **Nejsou to nové kódy.** Registr chyb vlastní P01 a pravidla je vyrábí v P08
 * a P02; tenhle seznam existuje jen proto, aby test katalogu poznal, ke kterému
 * kódu chybí český a anglický text. Neznámý kód editor nezahodí: podle
 * kritéria 76 zobrazí `detail` ze serveru a `request_id`.
 */
import { PAGE_ISSUE_CODES } from '@mlain/emails/document/profile';

export const ISSUE_CODES = [
  /*
   * Kódy profilu `page` se BEROU, neopisují.
   *
   * Vlastní je `PAGE_ISSUE_CODES` v `@mlain/emails/document/profile`, protože
   * je vydává validátor dokumentu. Kdyby se sem napsaly jako literály, překlep
   * by se poznal až tím, že pruh nálezů ukáže uživateli holý kód místo věty:
   * `KNOWN` v `issue-bar.tsx` se skládá právě z tohohle seznamu.
   */
  PAGE_ISSUE_CODES.footerForbidden,
  PAGE_ISSUE_CODES.htmlForbidden,
  PAGE_ISSUE_CODES.variableNotOnSurface,
  'content_asset_not_found',
  'content_condition_field_unknown',
  'content_condition_on_unsubscribe',
  'content_condition_operator_invalid',
  'content_duplicate_block_id',
  'content_duplicate_footer',
  'content_html_too_large',
  'content_image_missing_alt',
  'content_link_anchor_only',
  'content_link_scheme_forbidden',
  'content_low_contrast',
  'content_missing_unsubscribe',
  'content_nested_columns',
  'content_nested_repeat',
  'content_padding_overflow',
  'content_raw_html_forbidden',
  'content_reserved_marker',
  'content_too_many_blocks',
  'content_too_many_links',
  'link_variable_not_tracked',
  'liquid_comparison_operator_not_supported',
  'liquid_contains_not_allowed',
  'liquid_date_format_not_allowed',
  'liquid_default_value_invalid',
  'liquid_escaped_entity_in_construct',
  'liquid_filter_not_allowed',
  'liquid_for_parameter_not_allowed',
  'liquid_in_trackable_href',
  'liquid_index_not_allowed',
  'liquid_literal_not_supported',
  'liquid_nested_for',
  'liquid_parentheses_not_allowed',
  'liquid_string_literal_not_allowed',
  'liquid_tag_not_allowed',
  'liquid_unknown_field',
  'liquid_unknown_root',
  'liquid_vocative_filter',
  'liquid_whitespace_control_not_allowed',
] as const;
