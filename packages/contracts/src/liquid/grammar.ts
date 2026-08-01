/**
 * Kontrakt 2: Liquid subset (část 1, 4.10.2). ZMRAZENO.
 *
 * Knihovny nám dávají tokenizer, parser a řízení toku, nic víc. Ani jeden
 * vestavěný filtr se nepoužívá: obě strany registrují vlastních pět se stejnou
 * definicí, takže se plocha rozporu smrskne na věci, které jsou v Shopify
 * Liquidu dobře definované a obě knihovny je implementují shodně.
 */

export const ALLOWED_FILTERS = ['default', 'upcase', 'downcase', 'date', 'escape'] as const;
export type AllowedFilter = (typeof ALLOWED_FILTERS)[number];

/** Tři tagy, ne čtyři: `if` včetně `elsif` a `else`, `unless`, `for`. */
export const ALLOWED_TAGS = [
  'if',
  'elsif',
  'else',
  'endif',
  'unless',
  'endunless',
  'for',
  'endfor',
] as const;

export const DATE_FORMAT_WHITELIST = [
  '%d.%m.%Y',
  '%-d.%-m.%Y',
  '%Y-%m-%d',
  '%d.%m.%Y %H:%M',
  '%H:%M',
] as const;
export type AllowedDateFormat = (typeof DATE_FORMAT_WHITELIST)[number];

export const LIQUID_LIMITS = Object.freeze({
  nestingDepth: 3,
  loops: 5,
  iterations: 200,
  pathSegments: 3,
  templateBytes: 512 * 1024,
  outputs: 500,
  renderMs: 50,
});

/** Kořenové proměnné, které sender zaručeně najde v render_data. */
export const ALLOWED_ROOTS = [
  'contact',
  'campaign',
  'workspace',
  'unsubscribe_url',
  'one_click_unsubscribe_url',
  'preferences_url',
  'webview_url',
] as const;

/**
 * `_present.<slug>` je kořen pro podmíněné zobrazení bloku. Autor ho nikdy
 * nepíše a validátor autorské šablony ho odmítá stejně jako `_context`.
 * Vzniká výhradně kompilací z vlastnosti bloku `visibleWhen`.
 */
export const COMPILED_ONLY_ROOTS = ['_present'] as const;

/** Interní kořeny, které validátor zakazuje v šabloně vždy. */
export const INTERNAL_ROOTS = ['_context'] as const;

export const COMPARISON_OPERATORS = ['==', '!=', '>', '<', '>=', '<='] as const;
/** Escapováním nedotčené operátory. Zbytek je do rozhodnutí blokující chyba. */
export const SUPPORTED_COMPARISON_OPERATORS = ['==', '!='] as const;

export const ALLOWED_LITERALS = ['true', 'false', 'nil'] as const;
/**
 * `blank` a `empty` gramatika kontraktu povoluje, ale `osteele/liquid` je nezná
 * (nález K4 části 4b), takže by se render mezi knihovnami rozešel. Validátor je
 * proto odmítá; podmínku "pole není prázdné" řeší vlastnost bloku `visibleWhen`
 * nad mapou `_present`, ne text v šabloně.
 */
export const UNSUPPORTED_LITERALS = ['blank', 'empty'] as const;

/** HTML entity, které v kompilované šabloně uvnitř konstrukce znamenají chybu. */
export const HTML_ENTITIES_IN_CONSTRUCT = ['&quot;', '&#39;', '&lt;', '&gt;', '&amp;'] as const;

/** Pevné escapování v HTML kontextu. Nic jiného se nemění. */
export const HTML_ESCAPE_MAP: Readonly<Record<string, string>> = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
});

export const DEFAULT_VALUE_FORBIDDEN_CHARS = ['"', "'", '{', '}', '<', '>'] as const;
