'use server';

import { revalidatePath } from 'next/cache';
import { apiMutate } from '@/lib/api-client/mutate';

/**
 * Založení seznamu z rozhraní.
 *
 * DO 5. 8. 2026 TO NEŠLO VŮBEC. Tlačítko „Nový seznam" v `lists-table.tsx`
 * existovalo, ale nemělo žádnou akci, takže se seznam dal založit jedině přes
 * API nebo ukázkovými daty. Endpoint `POST /api/v1/lists` přitom existuje od
 * začátku.
 *
 * Zakládá se s DVOJÍM POTVRZENÍM, protože to je bezpečná výchozí volba: seznam
 * je nositelem oprávnění k rozesílce a přepnout ho na jeden krok jde jedním
 * kliknutím v jeho nastavení. Obráceně by to znamenalo rozesílat lidem, kteří
 * o to nepožádali.
 */

const LISTS_PATH = '/[locale]/w/[workspaceSlug]/lists';

export type CreateListResult =
  { status: 'success'; id: string } | { status: 'error'; code: string; detail: string };

export async function createListAction(input: {
  workspaceId: string;
  name: string;
  description: string;
  optIn: 'single' | 'double';
}): Promise<CreateListResult> {
  const result = await apiMutate<{ data: { id: string } }>('/api/v1/lists', {
    method: 'POST',
    workspaceId: input.workspaceId,
    body: {
      name: input.name.trim(),
      // Prázdný popis je „nevyplněno", ne prázdný text.
      description: input.description.trim() === '' ? null : input.description.trim(),
      opt_in: input.optIn,
    },
  });
  if (!result.ok) {
    return { status: 'error', code: result.problem.code, detail: result.problem.detail };
  }
  revalidatePath(LISTS_PATH, 'page');
  return { status: 'success', id: result.data.data.id };
}
