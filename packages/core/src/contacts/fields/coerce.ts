import { normalizeEmail } from '../email';
import {
  LONG_TEXT_MAX_LENGTH,
  MULTI_ENUM_MAX_ITEMS,
  TEXT_MAX_LENGTH,
  URL_MAX_LENGTH,
} from './limits';

export type FieldType =
  | 'text'
  | 'long_text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'enum'
  | 'multi_enum'
  | 'url'
  | 'email'
  | 'phone';

export type FieldDefinition = {
  key: string;
  type: FieldType;
  options: Record<string, unknown>;
};

export type CoerceSettings = {
  numberFormat: 'auto' | 'cs' | 'en';
  dateFormat: 'auto' | 'cs' | 'en';
  defaultCountry: string | null;
  timezone?: string;
};

export type CoerceWarning = 'number_format_ambiguous' | 'excel_serial_date_assumed';

export type CoerceResult =
  { ok: true; value: unknown; warning?: CoerceWarning } | { ok: false; code: string };

const TRUE_VALUES = new Set(['1', 'true', 'ano', 'yes', 'y', 'a', 'x', 'on', '✓']);
const FALSE_VALUES = new Set(['0', 'false', 'ne', 'no', 'n', 'off']);

/** Kombinovací diakritické znaky. Píšou se escape sekvencí, v editoru jsou neviditelné. */
const COMBINING_MARKS = /[\u0300-\u036f]/g;
/**
 * Mezery, které se v číslech používají jako oddělovač tisíců, plus apostrof.
 * Nedělitelná mezera a úzká nedělitelná mezera se píšou escape sekvencí: v editoru jsou
 * k nerozeznání od obyčejné a lint je hlásí jako nepravidelný bílý znak.
 */
const NUMBER_SEPARATORS = /[\s\u00a0\u202f']/g;

/** Porovnání bez ohledu na velikost písmen a diakritiku. */
function boolKey(value: string): string {
  return value.normalize('NFD').replace(COMBINING_MARKS, '').trim().toLowerCase();
}

/**
 * Koerce jedné hodnoty podle typu pole. Platí pro import, API i formuláře, takže
 * dva různé postupy nemohou z jednoho souboru vyrobit dvě různá data.
 *
 * Vstup je vždy nejdřív ořezaný o bílé znaky. Prázdná hodnota je null u každého typu,
 * ne false u booleanu ani nula u čísla.
 */
export function coerceValue(
  raw: unknown,
  field: FieldDefinition,
  settings: CoerceSettings,
): CoerceResult {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const input = typeof raw === 'string' ? raw.trim() : raw;
  if (input === '') return { ok: true, value: null };

  switch (field.type) {
    case 'number':
      return coerceNumber(String(input), field, settings);
    case 'boolean': {
      if (typeof input === 'boolean') return { ok: true, value: input };
      const key = boolKey(String(input));
      if (TRUE_VALUES.has(key)) return { ok: true, value: true };
      if (FALSE_VALUES.has(key)) return { ok: true, value: false };
      return { ok: false, code: 'invalid_boolean' };
    }
    case 'date':
      return coerceDate(String(input), settings);
    case 'datetime':
      return coerceDateTime(String(input));
    case 'enum': {
      const values = (field.options['values'] as string[] | undefined) ?? [];
      const value = String(input);
      return values.includes(value)
        ? { ok: true, value }
        : { ok: false, code: 'invalid_enum_value' };
    }
    case 'multi_enum': {
      const values = (field.options['values'] as string[] | undefined) ?? [];
      const maxItems = (field.options['max_items'] as number | undefined) ?? MULTI_ENUM_MAX_ITEMS;
      const items = Array.isArray(input)
        ? input.map(String)
        : String(input)
            .split('|')
            .map((v) => v.trim())
            .filter((v) => v.length > 0);
      if (items.length > maxItems) return { ok: false, code: 'value_too_long' };
      if (items.some((item) => !values.includes(item))) {
        return { ok: false, code: 'invalid_enum_value' };
      }
      return { ok: true, value: items };
    }
    case 'url': {
      const value = String(input);
      if (value.length > URL_MAX_LENGTH) return { ok: false, code: 'value_too_long' };
      const schemes = (field.options['schemes'] as string[] | undefined) ?? ['http', 'https'];
      try {
        const url = new URL(value);
        if (!schemes.includes(url.protocol.replace(':', ''))) {
          return { ok: false, code: 'value_too_long' };
        }
        return { ok: true, value };
      } catch {
        return { ok: false, code: 'value_too_long' };
      }
    }
    case 'email': {
      const normalized = normalizeEmail(String(input));
      return normalized.ok
        ? { ok: true, value: normalized.email }
        : { ok: false, code: normalized.code };
    }
    case 'phone':
      // Normalizace na E.164 je volitelná a v MVP 0 není. Bez ní se telefon ukládá tak,
      // jak přišel, což je lepší než ho odmítnout: uživatel si pole zavedl vědomě.
      return { ok: true, value: String(input) };
    case 'long_text': {
      const value = String(input);
      const max = (field.options['max_length'] as number | undefined) ?? LONG_TEXT_MAX_LENGTH;
      return value.length > max ? { ok: false, code: 'value_too_long' } : { ok: true, value };
    }
    case 'text':
    default: {
      const value = String(input);
      const max = (field.options['max_length'] as number | undefined) ?? TEXT_MAX_LENGTH;
      if (value.length > max) return { ok: false, code: 'value_too_long' };
      const pattern = field.options['pattern'] as string | undefined;
      if (pattern !== undefined && !new RegExp(pattern).test(value)) {
        return { ok: false, code: 'value_too_long' };
      }
      return { ok: true, value };
    }
  }
}

/**
 * Číselné formáty podle nastavení projektu.
 *
 * auto: odstraní se mezery, NBSP a apostrofy. Když řetězec obsahuje čárku i tečku,
 * PRAVĚJŠÍ z nich je desetinný oddělovač a druhý se odstraní. Když obsahuje jen jeden
 * z nich, je to desetinný oddělovač.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ JEHO VLASTNÍMI VEKTORY. Plán připojoval varování
 * number_format_ambiguous ke KAŽDÉ hodnotě s jedinou čárkou, jenže jeho testovací vektory
 * u '1 234,56' a '1234,56' žádné varování nečekají a čekat nemají: dvě číslice za čárkou
 * jsou jednoznačně setiny. Varování se proto vydává jen tam, kde je hodnota SKUTEČNĚ
 * dvojznačná, tedy když za jediným oddělovačem stojí přesně tři číslice ('1,234' může být
 * 1.234 i 1234). Platí to symetricky i pro tečku, protože v českém formátu je '1.234' tisíc.
 */
function coerceNumber(raw: string, field: FieldDefinition, settings: CoerceSettings): CoerceResult {
  let value = raw.replace(NUMBER_SEPARATORS, '');
  let warning: 'number_format_ambiguous' | undefined;

  if (settings.numberFormat === 'cs') {
    value = value.replace(/\./g, '').replace(',', '.');
  } else if (settings.numberFormat === 'en') {
    value = value.replace(/,/g, '');
  } else {
    const lastComma = value.lastIndexOf(',');
    const lastDot = value.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
      const decimalAt = Math.max(lastComma, lastDot);
      const decimal = value[decimalAt] as string;
      const thousands = decimal === ',' ? '.' : ',';
      value = value.split(thousands).join('').replace(decimal, '.');
    } else if (lastComma >= 0 || lastDot >= 0) {
      const at = Math.max(lastComma, lastDot);
      if (/^\d{3}$/.test(value.slice(at + 1))) warning = 'number_format_ambiguous';
      if (lastComma >= 0) value = value.replace(',', '.');
    }
  }

  if (!/^-?\d*\.?\d+$/.test(value)) return { ok: false, code: 'invalid_number' };
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return { ok: false, code: 'invalid_number' };

  const min = field.options['min'] as number | undefined;
  const max = field.options['max'] as number | undefined;
  if (min !== undefined && parsed < min) return { ok: false, code: 'invalid_number' };
  if (max !== undefined && parsed > max) return { ok: false, code: 'invalid_number' };

  const decimals = field.options['decimals'] as number | undefined;
  const rounded = decimals === undefined ? parsed : Number(parsed.toFixed(decimals));
  return warning === undefined
    ? { ok: true, value: rounded }
    : { ok: true, value: rounded, warning };
}

/** Epocha excelovských sériových čísel včetně známé chyby s přestupným rokem 1900. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const EXCEL_SERIAL_MIN = 20000;
const EXCEL_SERIAL_MAX = 60000;

function coerceDate(raw: string, settings: CoerceSettings): CoerceResult {
  // Celé číslo v rozsahu 20 000 až 60 000 je skoro jistě sériové číslo z Excelu.
  // Uživatel by jinak v datech viděl "44927" a nechápal by, proč to není datum.
  if (/^\d+$/.test(raw)) {
    const serial = Number(raw);
    if (serial >= EXCEL_SERIAL_MIN && serial <= EXCEL_SERIAL_MAX) {
      const date = new Date(EXCEL_EPOCH_MS + serial * 86400000);
      return {
        ok: true,
        value: date.toISOString().slice(0, 10),
        warning: 'excel_serial_date_assumed',
      };
    }
    return { ok: false, code: 'invalid_date' };
  }

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso !== null) return finishDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const czech = raw.match(/^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})$/);
  if (czech !== null && settings.dateFormat !== 'en') {
    return finishDate(Number(czech[3]), Number(czech[2]), Number(czech[1]));
  }

  const slashed = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashed !== null) {
    return settings.dateFormat === 'en'
      ? finishDate(Number(slashed[3]), Number(slashed[1]), Number(slashed[2]))
      : finishDate(Number(slashed[3]), Number(slashed[2]), Number(slashed[1]));
  }

  return { ok: false, code: 'invalid_date' };
}

function finishDate(year: number, month: number, day: number): CoerceResult {
  if (year < 1900 || year > 2200) return { ok: false, code: 'invalid_date' };
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { ok: false, code: 'invalid_date' };
  }
  return { ok: true, value: date.toISOString().slice(0, 10) };
}

/** datetime bez časové zóny se interpretuje jako UTC. */
function coerceDateTime(raw: string): CoerceResult {
  const parsed = new Date(/[Zz]|[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw}Z`);
  if (Number.isNaN(parsed.getTime())) return { ok: false, code: 'invalid_date' };
  const year = parsed.getUTCFullYear();
  if (year < 1900 || year > 2200) return { ok: false, code: 'invalid_date' };
  return { ok: true, value: parsed.toISOString() };
}
