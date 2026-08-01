import type { Problem } from './problem';
import type { Result } from './result';

export const DEFAULT_LIMIT = 50;
export const CURSOR_PARAM = 'cursor';

export type Paginated<T> = {
  data: T[];
  pagination: {
    next_cursor: string | null;
    prev_cursor: string | null;
    has_more: boolean;
    limit: number;
  };
};

export type CollectionCount = {
  count: number;
  precision: 'exact' | 'estimated';
  computed_at: string;
  stale: boolean;
};

export type SearchParamsInput = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function readCursor(searchParams: SearchParamsInput): string | undefined {
  const value = single(searchParams[CURSOR_PARAM]);
  return value === '' ? undefined : value;
}

export function readFilters(
  searchParams: SearchParamsInput,
  allowed: readonly string[],
): Record<string, string> {
  const filters: Record<string, string> = {};
  for (const key of allowed) {
    const value = single(searchParams[key]);
    if (value !== undefined && value !== '') filters[key] = value;
  }
  return filters;
}

/**
 * Odkaz na stránku výsledků. Čísla stránek se nezavádějí, protože kurzor je
 * pozice v seřazené množině, ne pořadové číslo (4.3 části 1).
 */
export function buildListHref(
  basePath: string,
  filters: Record<string, string>,
  cursor?: string,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (key === 'page' || key === CURSOR_PARAM) continue;
    if (value !== '') params.set(key, value);
  }
  if (cursor) params.set(CURSOR_PARAM, cursor);
  const query = params.toString();
  return query === '' ? basePath : `${basePath}?${query}`;
}

export function isInvalidCursorProblem(problem: Problem): boolean {
  return (
    problem.code === 'validation_failed' &&
    (problem.errors ?? []).some((entry) => entry.path === CURSOR_PARAM)
  );
}

export type ListFetchOutcome<T> = {
  result: Result<Paginated<T>>;
  /** true, když se kurzor ukázal jako neplatný a ukazuje se první stránka. */
  cursorDropped: boolean;
};

/**
 * Kritérium 79 části 6: odkaz s neplatným kurzorem zobrazí první stránku
 * stejného filtru a hlášku o tom, ne prázdnou tabulku ani chybu.
 */
export async function fetchListWithCursorFallback<T>(
  load: (cursor?: string) => Promise<Result<Paginated<T>>>,
  cursor?: string,
): Promise<ListFetchOutcome<T>> {
  const first = await load(cursor);
  if (first.ok || cursor === undefined || !isInvalidCursorProblem(first.problem)) {
    return { result: first, cursorDropped: false };
  }
  return { result: await load(undefined), cursorDropped: true };
}
