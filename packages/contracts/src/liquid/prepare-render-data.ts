import { LIQUID_LIMITS } from './grammar';

export type RenderData = Record<string, unknown>;
/**
 * Úzký popis toho, co má `prepareRenderData` připravit. NENÍ to `RenderSchema`
 * z kontraktu 5, což je bohatý tvar s typy polí a systémovými značkami a vlastní
 * ho P08. Dvě neslučitelné věci pod jedním jménem jsou tentýž problém, jaký
 * u katalogu polí vyřešilo rozhodnutí R2, proto se tenhle typ jmenuje
 * `PreparedDataSchema` (požadavek R13 plánu P08).
 */
export type PreparedDataSchema = { fields: readonly string[]; presence: readonly string[] };

const MAX_SAFE = 9_007_199_254_740_991n;

/**
 * Jediná sdílená příprava dat pro náhled i odeslání (část 3, 3.7.2b).
 *
 * Kdyby to dělal jen sender, náhled by podmíněné bloky vyhodnotil jinak než
 * odeslání, což je přesně ten rozchod, kterému tahle funkce brání.
 */
export function prepareRenderData(raw: RenderData, schema: PreparedDataSchema): RenderData {
  const prepared = truncate(normalizeNumbers(raw)) as RenderData;

  const context = (prepared._context as Record<string, unknown> | undefined) ?? {};
  prepared._context = {
    timezone: typeof context.timezone === 'string' ? context.timezone : 'UTC',
    locale: typeof context.locale === 'string' ? context.locale : 'cs',
  };

  const present: Record<string, boolean> = {};
  for (const path of schema.presence) {
    present[path.replace(/\./g, '__')] = isPresent(readPath(prepared, path));
  }
  prepared._present = present;

  return prepared;
}

/** Chybějící klíč je nil, tedy nepravda, takže by podmíněný blok zmizel všem. */
function isPresent(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function readPath(data: RenderData, path: string): unknown {
  let current: unknown = data;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Go `encoding/json` mapuje čísla na float64, takže by variabilní symbol nebo
 * číslo faktury ztratily přesnost jinak než v prohlížeči. Nad 2^53 se proto
 * serializuje řetězec.
 */
function normalizeNumbers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeNumbers);
  if (typeof value === 'bigint') {
    return value > MAX_SAFE || value < -MAX_SAFE ? value.toString() : Number(value);
  }
  if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
    return String(BigInt(value));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeNumbers(v)]));
  }
  return value;
}

/**
 * Pole delší než 200 prvků se ořezává na vstupu, protože ani jedna knihovna
 * neumí přerušit `for` uprostřed. Kdyby to náhled nedělal, kontakt s 250
 * položkami by se v editoru zobrazil celý a odeslal zkrácený.
 */
function truncate(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, LIQUID_LIMITS.iterations).map(truncate);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, truncate(v)]));
  }
  return value;
}
