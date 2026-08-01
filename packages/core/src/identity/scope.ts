import { eq, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { WorkspaceContext } from './types';

/**
 * 3.6, vrstva 1. Jediný povolený způsob, jak se v packages/core filtruje podle
 * workspace. Kdyby se psalo `eq(table.workspaceId, nejakyRetezec)` ručně, dalo by
 * se to udělat i špatně a nikdo by si toho nevšiml, dokud by neunikla data.
 *
 * Test v scope.test.ts hlídá, že tuhle funkci obchází jen ona sama.
 */
export function wsEq<T extends PgTable & { workspaceId: PgColumn }>(
  ctx: WorkspaceContext,
  table: T,
): SQL {
  return eq(table.workspaceId, ctx.workspaceId);
}
