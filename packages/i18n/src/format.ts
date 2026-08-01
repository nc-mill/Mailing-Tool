import type { Locale } from './locales';

/**
 * Čisté formátovací funkce nad Intl. Komponenty je používají přes
 * `useFormatter` z next-intl, tyhle funkce jsou pod ním a dají se testovat
 * bez Reactu. Nikdy se nesestavuje text ručně z kusů.
 */

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

/** Procenta vždy na jedno desetinné místo. U míry stížností 0,34 % by celá procenta ztratila informaci. */
export function formatPercent(ratio: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(ratio);
}

export function formatDate(value: Date, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: 'numeric',
    month: locale === 'en' ? 'long' : 'numeric',
    year: 'numeric',
  }).format(value);
}

export function formatTime(value: Date, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(value);
}

export function formatDateTime(value: Date, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: 'numeric',
    month: locale === 'en' ? 'long' : 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(value);
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', MINUTE_MS],
];

/**
 * Relativní tvar do sedmi dnů, pak absolutní datum (pravidlo 9.5).
 * Volající k němu vždy doplní přesný čas do `title` a `<time datetime>`.
 */
export function formatRelativeTime(
  value: Date,
  locale: Locale,
  now: Date = new Date(),
  timeZone = 'UTC',
): string {
  const diff = value.getTime() - now.getTime();
  const magnitude = Math.abs(diff);

  if (magnitude < MINUTE_MS) {
    return locale === 'cs' ? 'před chvílí' : 'just now';
  }
  if (magnitude >= SEVEN_DAYS_MS) {
    return formatDate(value, locale, timeZone);
  }

  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (magnitude >= size) {
      return formatter.format(Math.round(diff / size), unit);
    }
  }
  return formatter.format(Math.round(diff / MINUTE_MS), 'minute');
}

const SIZE_UNITS = ['B', 'kB', 'MB', 'GB', 'TB'] as const;

export function formatFileSize(bytes: number, locale: Locale): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : 1;
  const number = new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
  return `${number} ${SIZE_UNITS[unit]}`;
}

/**
 * Trvání. `Intl.DurationFormat` je v Node 24 k dispozici, ale ne v každém
 * prohlížeči, proto fallback na ICU zprávu `common.time.durationMinutesSeconds`,
 * kterou volající předá jako `compose`. Fallback je **celá zpráva s parametry**,
 * ne slepenec fragmentů.
 */
export function formatDuration(
  seconds: number,
  locale: Locale,
  compose: (parts: { minutes: number; seconds: number }) => string,
): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  const DurationFormat = (
    Intl as unknown as {
      DurationFormat?: new (
        locale: string,
        options: { style: string },
      ) => {
        format: (input: { minutes: number; seconds: number }) => string;
      };
    }
  ).DurationFormat;

  if (typeof DurationFormat === 'function') {
    return new DurationFormat(locale, { style: 'short' }).format({ minutes, seconds: rest });
  }
  return compose({ minutes, seconds: rest });
}
