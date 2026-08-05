'use server';

import { revalidatePath } from 'next/cache';
import { apiMutate } from '@/lib/api-client/mutate';

/**
 * Ruční povýšení kontaktu na potvrzený.
 *
 * ZMĚNU DĚLÁ API, NE TENHLE SOUBOR. Jde přes `POST /api/v1/contacts/{id}/confirm`, které
 * pod sebou volá `confirmContactManually` z `packages/core/src/contacts/repo/contact-confirm.ts`.
 * Vlastní SQL by znamenalo druhou implementaci pravidel a obešlo by audit i souhlas.
 *
 * PROČ VLASTNÍ ENDPOINT, NE `PATCH` SE STAVEM. Zápis podle pravidla 3 ze 4.1.2 části 2
 * zamčený stav (odhlášen, odraz, stížnost) MLČKY zachová: `PATCH` odpoví 200 a nezmění nic.
 * Do téhle chvíle se tomu rozhraní vyhýbalo tak, že takové kontakty přeskakovalo a hlásilo
 * „povýšit nejde". Zadavatel je správce vlastní instalace a chce povýšit kdykoli, takže
 * odmítání zmizelo a místo něj vznikla serverová cesta pro výslovné rozhodnutí správce.
 */

const CONTACTS_PATH = '/[locale]/w/[workspaceSlug]/contacts';

/** Odpověď endpointu. Tvar drží `ConfirmResultSchema` v `contacts.routes.ts`. */
type ConfirmResponse = {
  confirm: {
    from_status: string;
    changed: boolean;
    lists_confirmed: number;
    suppression_removed: string[];
    suppression_blocking: string | null;
  };
};

export type ConfirmOutcome = {
  id: string;
  /** Stav před zásahem. Rozhoduje o tom, co se uživateli řekne. */
  fromStatus: string;
  changed: boolean;
  listsConfirmed: number;
  /**
   * Důvod blokace, která na adrese ZŮSTÁVÁ. Kontakt je potvrzený, ale odesílací cesta
   * ho stejně přeskočí, protože suppression je v `evaluateMailability` vrstva NAD stavem
   * a Go sender ji kontroluje samostatně. Rozhraní to musí říct nahlas.
   */
  suppressionBlocking: string | null;
};

export type ConfirmResult =
  { status: 'success'; outcomes: ConfirmOutcome[] } | { status: 'error'; code: string };

/**
 * Povýší jeden nebo víc kontaktů na potvrzené.
 *
 * ŽÁDNÝ KONTAKT SE NEPŘESKAKUJE. Server umí povýšit z každého stavu, takže se stav
 * nemusí číst předem a nevzniká okno, ve kterém by se mezi čtením a zápisem změnil.
 *
 * Jde to po jednom, protože hromadný endpoint na změnu stavu v API není: `bulk-delete`
 * a `tags:bulk` řeší mazání a štítky, ne stav. Výběr v tabulce je omezený na jednu
 * stránku, takže jde o desítky požadavků, ne o tisíce.
 */
export async function confirmContactsAction(input: {
  workspaceId: string;
  ids: string[];
}): Promise<ConfirmResult> {
  const outcomes: ConfirmOutcome[] = [];

  for (const id of input.ids) {
    const result = await apiMutate<ConfirmResponse>(`/api/v1/contacts/${id}/confirm`, {
      method: 'POST',
      workspaceId: input.workspaceId,
    });
    if (!result.ok) return { status: 'error', code: result.problem.code };

    const confirm = result.data.confirm;
    outcomes.push({
      id,
      fromStatus: confirm.from_status,
      changed: confirm.changed,
      listsConfirmed: confirm.lists_confirmed,
      suppressionBlocking: confirm.suppression_blocking,
    });
  }

  revalidatePath(CONTACTS_PATH, 'page');
  revalidatePath(`${CONTACTS_PATH}/[id]`, 'page');
  return { status: 'success', outcomes };
}
