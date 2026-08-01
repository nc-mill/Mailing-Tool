import type { ImportOptions } from './options';

export type FieldSpec = {
  type:
    | 'text'
    | 'long_text'
    | 'number'
    | 'boolean'
    | 'date'
    | 'datetime'
    | 'enum'
    | 'multi_enum'
    | 'url'
    | 'phone';
  required?: boolean;
  maxLength?: number;
  values?: string[];
};

export type Coerced =
  { ok: true; value: unknown; warnings: string[] } | { ok: false; code: string };

/** 45 231 z Excelu je 30. 11. 2023. Serial 1 je 1. 1. 1900, s posunem o dva dny. */
function excelSerialToDate(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
}

const CZECH_DATE = /^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})$/;

export function coerceFieldValue(raw: string, spec: FieldSpec, options: ImportOptions): Coerced {
  const warnings: string[] = [];
  const value = raw.trim();

  if (value.length === 0) {
    if (spec.required === true) return { ok: false, code: 'required_field_missing' };
    return { ok: true, value: options.empty_means_null ? null : '', warnings };
  }

  switch (spec.type) {
    case 'number': {
      const czech = /^-?\d{1,3}(\s\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(value);
      const english = /^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/.test(value);
      if (!czech && !english) return { ok: false, code: 'invalid_number' };
      // "1,234" jde přečíst dvěma způsoby. Bereme český výklad, ale řekneme to.
      if (czech && english && /,/.test(value)) warnings.push('number_format_ambiguous');
      const normalized =
        czech && options.number_format !== 'en'
          ? value.replace(/\s/g, '').replace(',', '.')
          : value.replace(/,/g, '');
      return { ok: true, value: Number(normalized), warnings };
    }
    case 'boolean': {
      const truthy = ['ano', 'true', 'yes', '1'];
      const falsy = ['ne', 'false', 'no', '0'];
      const low = value.toLowerCase();
      if (truthy.includes(low)) return { ok: true, value: true, warnings };
      if (falsy.includes(low)) return { ok: true, value: false, warnings };
      return { ok: false, code: 'invalid_boolean' };
    }
    case 'date':
    case 'datetime': {
      if (/^\d{5}$/.test(value)) {
        warnings.push('excel_serial_date_assumed');
        return { ok: true, value: excelSerialToDate(Number(value)).toISOString(), warnings };
      }
      const cs = value.match(CZECH_DATE);
      if (cs !== null) {
        const [, day = '1', month = '1', year = '1970'] = cs;
        return {
          ok: true,
          value: new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).toISOString(),
          warnings,
        };
      }
      const iso = Date.parse(value);
      if (Number.isNaN(iso)) {
        return { ok: false, code: spec.type === 'date' ? 'invalid_date' : 'invalid_datetime' };
      }
      return { ok: true, value: new Date(iso).toISOString(), warnings };
    }
    case 'enum': {
      if (spec.values !== undefined && !spec.values.includes(value)) {
        return { ok: false, code: 'invalid_enum_value' };
      }
      return { ok: true, value, warnings };
    }
    case 'multi_enum': {
      const parts = value
        .split(/[,|]/)
        .map((p) => p.trim())
        .filter(Boolean);
      const allowed = spec.values;
      if (allowed !== undefined && parts.some((p) => !allowed.includes(p))) {
        return { ok: false, code: 'invalid_enum_value' };
      }
      return { ok: true, value: parts, warnings };
    }
    case 'url': {
      try {
        new URL(value);
      } catch {
        return { ok: false, code: 'invalid_url' };
      }
      return { ok: true, value, warnings };
    }
    case 'phone': {
      if (!/^[+0-9 ()./-]{6,32}$/.test(value)) return { ok: false, code: 'invalid_phone' };
      return { ok: true, value, warnings };
    }
    default: {
      if (spec.maxLength !== undefined && value.length > spec.maxLength) {
        warnings.push('value_truncated');
        return { ok: true, value: value.slice(0, spec.maxLength), warnings };
      }
      return { ok: true, value, warnings };
    }
  }
}
