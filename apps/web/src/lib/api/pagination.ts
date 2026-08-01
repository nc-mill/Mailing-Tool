import { sql, type SQL, type AnyColumn } from 'drizzle-orm';
import { validationFailed } from '@mlain/core/errors/api-error';

export type CursorDirection = 'n' | 'p';

export type Cursor = {
  /** Hodnoty řadicích klíčů posledního řádku. Vždy včetně implicitního id. */
  k: unknown[];
  d: CursorDirection;
  /** Order, pro který kurzor platí. Povinné, viz 4.3. */
  o: string;
};

export type Pagination = {
  next_cursor: string | null;
  prev_cursor: string | null;
  has_more: boolean;
  limit: number;
};

export type Page<T> = { data: T[]; pagination: Pagination };

export const DEFAULT_LIMIT = 50;
export const MIN_LIMIT = 1;
export const MAX_LIMIT = 200;

export function encodeCursor(keys: unknown[], direction: CursorDirection, order: string): string {
  const payload: Cursor = { k: keys, d: direction, o: order };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string, expectedOrder: string): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw validationFailed([
      { path: 'cursor', code: 'invalid_cursor', message: 'Kurzor nejde přečíst.' },
    ]);
  }
  const cursor = parsed as Cursor;
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray(cursor.k) ||
    (cursor.d !== 'n' && cursor.d !== 'p') ||
    typeof cursor.o !== 'string'
  ) {
    throw validationFailed([
      { path: 'cursor', code: 'invalid_cursor', message: 'Kurzor má neplatný tvar.' },
    ]);
  }
  // 4.3: když se `o` v kurzoru neshoduje s parametrem order, výsledek by nedával smysl.
  if (cursor.o !== expectedOrder) {
    throw validationFailed([
      { path: 'cursor', code: 'cursor_order_mismatch', message: 'Kurzor patří k jinému řazení.' },
    ]);
  }
  return cursor;
}

export function parsePaginationQuery(
  // `| undefined` u každého klíče je pod `exactOptionalPropertyTypes` podstatné:
  // zod vrací z volitelného pole přesně tenhle tvar a bez něj by validovaný
  // objekt nešel předat (definice cest v `packages/core` ho předávají injektáží).
  query: { limit?: string | undefined; order?: string | undefined; cursor?: string | undefined },
  allowedOrders: readonly string[],
): { limit: number; order: string; cursor: Cursor | null } {
  let limit = DEFAULT_LIMIT;
  if (query.limit !== undefined) {
    const parsed = Number(query.limit);
    if (!Number.isInteger(parsed) || parsed < MIN_LIMIT || parsed > MAX_LIMIT) {
      throw validationFailed([
        {
          path: 'limit',
          code: 'out_of_range',
          message: `Limit musí být celé číslo od ${MIN_LIMIT} do ${MAX_LIMIT}.`,
        },
      ]);
    }
    limit = parsed;
  }

  const order = query.order ?? allowedOrders[0]!;
  if (!allowedOrders.includes(order)) {
    throw validationFailed([
      {
        path: 'order',
        code: 'unsupported_order',
        message: `Povolené hodnoty: ${allowedOrders.join(', ')}.`,
      },
    ]);
  }

  return { limit, order, cursor: query.cursor ? decodeCursor(query.cursor, order) : null };
}

/**
 * Keyset porovnání n-tice. 4.3: každé order končí implicitně `, id desc`,
 * takže klíč má vždy aspoň dvě složky a porovnává se jako n-tice, ne po sloupcích.
 * Porovnání po sloupcích je klasická chyba, která tiše přeskakuje řádky.
 */
export function keysetCondition(
  columns: readonly AnyColumn[],
  values: readonly unknown[],
  direction: 'asc' | 'desc',
): SQL {
  const left = sql.join(
    columns.map((c) => sql`${c}`),
    sql`, `,
  );
  const right = sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );
  return direction === 'desc' ? sql`(${left}) < (${right})` : sql`(${left}) > (${right})`;
}

/**
 * Rozdělí načtených limit + 1 řádků na stránku a příznak has_more.
 * Celkový počet se nevrací nikdy, na to je samostatný endpoint /count (4.3).
 */
export function buildPage<T>(
  rows: T[],
  opts: { limit: number; order: string },
  keysOf: (row: T) => unknown[],
): Page<T> {
  const hasMore = rows.length > opts.limit;
  const data = hasMore ? rows.slice(0, opts.limit) : rows;
  const last = data[data.length - 1];
  return {
    data,
    pagination: {
      next_cursor: hasMore && last ? encodeCursor(keysOf(last), 'n', opts.order) : null,
      prev_cursor: null,
      has_more: hasMore,
      limit: opts.limit,
    },
  };
}
