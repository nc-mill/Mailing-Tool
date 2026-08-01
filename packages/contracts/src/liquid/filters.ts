import { DATE_FORMAT_WHITELIST } from './grammar';

/**
 * Pět filtrů, normativní definice z kontraktu 4.10.2.
 * Obě strany registrují vlastní implementaci, ani jeden vestavěný filtr se nepoužívá.
 */

/** Vrátí argument, když je hodnota nil, false, "" nebo prázdné pole. Nula NENÍ prázdná. */
export function defaultFilter(value: unknown, fallback: string): unknown {
  if (value === null || value === undefined || value === false) return fallback;
  if (value === '') return fallback;
  if (Array.isArray(value) && value.length === 0) return fallback;
  return value;
}

/**
 * Simple uppercase mapping. Kód point, jehož velká varianta má víc než jeden
 * kód point (tedy full mapping), zůstává beze změny.
 *
 * Bez tohohle pravidla by JavaScript udělal z `ß` řetězec `SS`, zatímco Go
 * `strings.ToUpper` vrací `ß`, a golden fixtures se porovnávají bajt po bajtu.
 */
export function simpleUpcase(value: string): string {
  let out = '';
  for (const char of value) {
    const upper = char.toUpperCase();
    out += [...upper].length === 1 ? upper : char;
  }
  return out;
}

export function simpleDowncase(value: string): string {
  let out = '';
  for (const char of value) {
    const lower = char.toLowerCase();
    out += [...lower].length === 1 ? lower : char;
  }
  return out;
}

/** V HTML i v textovém kontextu no-op. Escapování je automatické a nevypnutelné. */
export function escapeFilter(value: unknown): unknown {
  return value;
}

type DateParts = { day: number; month: number; year: number; hour: number; minute: number };

function partsIn(date: Date, timezone: string): DateParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    day: Number(parts.day),
    month: Number(parts.month),
    year: Number(parts.year),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Vstup: řetězec RFC 3339 s explicitní zónou, celé číslo (unix sekundy), nebo "now".
 * Cokoliv jiného dá prázdný řetězec. ŽÁDNÁ varianta nesmí vrátit chybu: chyba
 * filtru by shodila celý render a zpráva by skončila jako render_failed,
 * přestože kontrakt pro neplatný vstup předepisuje prázdný řetězec.
 */
export function dateFilter(value: unknown, format: string, timezone: string | undefined): string {
  if (!(DATE_FORMAT_WHITELIST as readonly string[]).includes(format)) return '';
  const zone = timezone ?? 'UTC';

  let date: Date | undefined;
  if (typeof value === 'number' && Number.isFinite(value)) date = new Date(value * 1000);
  else if (typeof value === 'string') {
    if (value === 'now') date = new Date();
    else if (/^-?\d+$/.test(value)) date = new Date(Number(value) * 1000);
    else {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) date = new Date(parsed);
    }
  }
  if (!date || Number.isNaN(date.getTime())) return '';

  let parts: DateParts;
  try {
    parts = partsIn(date, zone);
  } catch {
    parts = partsIn(date, 'UTC');
  }

  switch (format) {
    case '%d.%m.%Y':
      return `${pad(parts.day)}.${pad(parts.month)}.${parts.year}`;
    case '%-d.%-m.%Y':
      return `${parts.day}.${parts.month}.${parts.year}`;
    case '%Y-%m-%d':
      return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
    case '%d.%m.%Y %H:%M':
      return `${pad(parts.day)}.${pad(parts.month)}.${parts.year} ${pad(parts.hour)}:${pad(parts.minute)}`;
    case '%H:%M':
      return `${pad(parts.hour)}:${pad(parts.minute)}`;
    default:
      return '';
  }
}
