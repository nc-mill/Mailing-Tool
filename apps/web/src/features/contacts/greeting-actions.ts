'use server';

import { revalidatePath } from 'next/cache';
import { apiMutate } from '@/lib/api-client/mutate';

/**
 * RUČNÍ TVAR OSLOVENÍ. Vlastní soubor schválně, ne přírůstek do `edit-actions.ts`:
 * je to úzká operace nad jedním sloupcem a musí jít zapojit samostatně.
 *
 * Míří na `PUT /api/v1/contacts/{id}/greeting`, ne na `PUT /api/v1/contacts/{id}`.
 * Editační formulář posílá celý stav obrazovky a chybějící hodnota u něj znamená
 * „má být prázdné", takže by ruční tvar smazalo první uložení formuláře, které
 * to pole nemá. Zdůvodnění je i u definice trasy v
 * `packages/core/src/contacts/api/greeting.routes.ts`.
 *
 * `workspaceId` je povinný ze stejného důvodu jako u ostatních akcí kontaktů:
 * `apiMutate` z něj skládá hlavičku `X-Workspace-Id` a bez ní vrátí RLS 404 na
 * kontakt, který má uživatel otevřený na obrazovce.
 */

const CONTACTS_PATH = '/[locale]/w/[workspaceSlug]/contacts';

export type GreetingActionResult = { status: 'success' } | { status: 'error'; code: string };

/**
 * Uloží tvar oslovení a ZAMKNE ho. Prázdný řetězec znamená „neoslovovat jménem":
 * kontakt dostane neutrální „Dobrý den" a zámek se zapne taky, aby import tuhle
 * volbu nepřepsal zpátky.
 */
export async function setGreetingAction(input: {
  workspaceId: string;
  id: string;
  firstNameVocative: string;
}): Promise<GreetingActionResult> {
  const trimmed = input.firstNameVocative.trim();
  const result = await apiMutate<{ data: unknown }>(`/api/v1/contacts/${input.id}/greeting`, {
    method: 'PUT',
    body: { first_name_vocative: trimmed.length === 0 ? null : trimmed },
    workspaceId: input.workspaceId,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(CONTACTS_PATH, 'page');
  revalidatePath(`${CONTACTS_PATH}/[id]`, 'page');
  return { status: 'success' };
}

/** Zruší ruční tvar a nechá oslovení znovu spočítat ze jména a rodu. */
export async function clearGreetingAction(input: {
  workspaceId: string;
  id: string;
}): Promise<GreetingActionResult> {
  const result = await apiMutate<{ data: unknown }>(`/api/v1/contacts/${input.id}/greeting`, {
    method: 'DELETE',
    workspaceId: input.workspaceId,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(CONTACTS_PATH, 'page');
  revalidatePath(`${CONTACTS_PATH}/[id]`, 'page');
  return { status: 'success' };
}
