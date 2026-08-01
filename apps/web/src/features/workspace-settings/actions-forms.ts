'use server';

import { IDLE } from '@/lib/feedback/action-result';
import { deleteWorkspaceAction, updateAddressFormAction } from './actions';

/**
 * ODCHYLKA OD PLÁNU, oprava chyby ve výpisu: plán předával akce se stavem
 * přímo formuláři přes `action={akce as never}`. React ale takové akci předá
 * `FormData` jako **první** argument, takže by se `formData.get` zavolalo nad
 * předchozím stavem a akce by spadla hned na prvním řádku. Tenhle soubor
 * proto drží obálky se správným tvarem `(formData) => Promise<void>`.
 *
 * Výsledek se zahazuje záměrně: formulář bez `useActionState` ho nemá kde
 * vykreslit a obě akce končí přesměrováním nebo obnovením stránky.
 */
export async function updateAddressFormFormAction(formData: FormData): Promise<void> {
  await updateAddressFormAction(IDLE, formData);
}

export async function deleteWorkspaceFormAction(formData: FormData): Promise<void> {
  await deleteWorkspaceAction(IDLE, formData);
}
