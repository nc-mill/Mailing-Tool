'use server';

import { revalidatePath } from 'next/cache';
import { apiMutate } from '@/lib/api-client/mutate';
import type { ContactActionResult } from './edit-actions';

/**
 * Zapnutí a zrušení omezení zpracování podle článku 18 GDPR.
 *
 * Vlastní soubor, ne `actions.ts` ani `edit-actions.ts`: obojí drží běžnou práci
 * s kontaktem (hromadné operace, editace formuláře), kdežto tohle je zásah do
 * zpracování osobních údajů s vlastním oprávněním (`suppressions:write`) a vlastní
 * auditní akcí. Kdo se ptá, kudy se omezení nastavuje, má najít jeden soubor.
 *
 * `workspaceId` je u obou akcí POVINNÝ, ne pohodlí: `apiMutate` z něj skládá hlavičku
 * `X-Workspace-Id` a bez ní běží požadavek mimo kontext projektu, takže RLS nevrátí
 * ani řádek a rozhraní dostane 404 na kontakt, který má uživatel otevřený.
 */

const CONTACTS_PATH = '/[locale]/w/[workspaceSlug]/contacts';
const CONTACT_DETAIL_PATH = `${CONTACTS_PATH}/[id]`;

type RestrictionInput = {
  workspaceId: string;
  id: string;
  /**
   * Důvod zásahu. Server ho vyžaduje (`note` v těle je povinné) a zapisuje do metadat
   * auditu. Prázdnou poznámku tedy nemá cenu posílat: skončila by na 422.
   */
  note: string;
};

/** Zapnutí omezení. Kontakt zůstane celý, jen se mu přestane posílat. */
export async function restrictProcessingAction(
  input: RestrictionInput,
): Promise<ContactActionResult> {
  const result = await apiMutate<unknown>(`/api/v1/contacts/${input.id}/processing-restriction`, {
    method: 'POST',
    body: { note: input.note },
    workspaceId: input.workspaceId,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(CONTACT_DETAIL_PATH, 'page');
  revalidatePath(CONTACTS_PATH, 'page');
  return { status: 'success' };
}

/**
 * Zrušení omezení. Míří na tutéž cestu metodou DELETE a tělo s poznámkou má i tady:
 * vrácení kontaktu do rozesílky je stejně vážné rozhodnutí jako jeho vyjmutí a bez
 * „proč" by byl auditní záznam k ničemu.
 */
export async function liftProcessingRestrictionAction(
  input: RestrictionInput,
): Promise<ContactActionResult> {
  const result = await apiMutate<unknown>(`/api/v1/contacts/${input.id}/processing-restriction`, {
    method: 'DELETE',
    body: { note: input.note },
    workspaceId: input.workspaceId,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(CONTACT_DETAIL_PATH, 'page');
  revalidatePath(CONTACTS_PATH, 'page');
  return { status: 'success' };
}
