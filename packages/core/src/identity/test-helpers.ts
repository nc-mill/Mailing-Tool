import { v7 as uuidv7 } from 'uuid';
import { createWorkspaceAsUser, type WorkspaceContext } from '@mlain/db';
import * as schema from '@mlain/db/schema';
import { appPool, withoutContext } from '../tx';
import { createWorkspaceContext } from './context';
import { hashPassword } from './password';

export type SeededWorkspace = {
  userId: string;
  workspaceId: string;
  /** Skutečný kontext ze skutečné továrny, ne podvržený. */
  ctx: WorkspaceContext;
};

/**
 * Pomocník pro databázové testy v packages/core. Nepoužívá se v produkční cestě.
 *
 * Projekt zakládá `createWorkspaceAsUser` z @mlain/db, ne ruční INSERT. Jen ta
 * funkce umí správné pořadí (ID dopředu, kontext před vložením řádku); ruční
 * `INSERT ... RETURNING` na workspaces bez kontextu skončí na RLS a vložení
 * členství neprojde přes WITH CHECK. Ověřeno spuštěním v P03.
 *
 * Vrací i hotový kontext, protože transakční obálky berou `WorkspaceContext`,
 * ne řetězec. Vyrábí se skutečnou továrnou, takže test zároveň pokrývá cestu,
 * kterou jde produkční kód.
 */
export async function seedWorkspaceForCoreTests(): Promise<SeededWorkspace> {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userId = uuidv7();
  await withoutContext(async (tx) => {
    await tx.insert(schema.users).values({
      id: userId,
      email: `core-${unique}@example.cz`,
      passwordHash: await hashPassword('dostatecne-dlouhe-heslo'),
      locale: 'cs',
      timezone: 'Europe/Prague',
    });
  });

  const workspace = await createWorkspaceAsUser(appPool(), userId, {
    name: 'Core test',
    slug: `core-${unique}`.toLowerCase().replace(/[^a-z0-9-]/g, ''),
    locale: 'cs',
    timezone: 'Europe/Prague',
  });

  const ctx = await createWorkspaceContext({
    kind: 'session',
    userId,
    workspaceRef: workspace.id,
  });
  return { userId, workspaceId: workspace.id, ctx };
}
