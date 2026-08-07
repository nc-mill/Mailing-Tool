'use server';

import { revalidatePath } from 'next/cache';
import { apiMutate } from '@/lib/api-client/mutate';
import type { ContactActionResult } from './edit-actions';

/**
 * Souhlas s měřením chování u jednoho kontaktu.
 *
 * Vlastní soubor ze stejného důvodu jako `restriction-actions.ts`: je to zásah
 * do zpracování osobních údajů s vlastní evidencí, ne běžná úprava kontaktu.
 *
 * NEVZNIKÁ ŽÁDNÝ NOVÝ ENDPOINT ani sloupec. Píše se do stejné append-only
 * evidence jako u ostatních souhlasů, `POST /contacts/{id}/consents` s účelem
 * `analytics`. Historie, doklady i obrazovka „Historie souhlasů" tím fungují
 * bez jediného řádku navíc a nevzniká druhá evidence téhož souhlasu.
 */

const CONTACTS_PATH = '/[locale]/w/[workspaceSlug]/contacts';
const CONTACT_DETAIL_PATH = `${CONTACTS_PATH}/[id]`;

export type MeasurementConsentInput = {
  workspaceId: string;
  id: string;
  status: 'granted' | 'withdrawn';
};

/**
 * Zápis souhlasu nebo jeho odvolání.
 *
 * `legal_basis` je vždy `consent`: měření chování stojí na souhlasu, ne na
 * oprávněném zájmu ani na smlouvě, a nabízet na obrazovce výběr právního
 * důvodu by znamenalo, že si ho někdo vybere podle toho, co se zrovna hodí.
 *
 * Zápis se NEPŘESKAKUJE, ani když se stav nemění. Evidence je append only:
 * druhé odvolání téhož souhlasu je platný doklad o tom, že člověk požádal
 * podruhé, a zahodit ho, protože „to už tam je", by z evidence udělalo
 * shrnutí místo dokladu.
 */
export async function setMeasurementConsentAction(
  input: MeasurementConsentInput,
): Promise<ContactActionResult> {
  const result = await apiMutate<unknown>(`/api/v1/contacts/${input.id}/consents`, {
    method: 'POST',
    body: { purpose: 'analytics', status: input.status, legal_basis: 'consent' },
    workspaceId: input.workspaceId,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(CONTACT_DETAIL_PATH, 'page');
  revalidatePath(CONTACTS_PATH, 'page');
  return { status: 'success' };
}
