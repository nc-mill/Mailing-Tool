'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client/fetch';
import { apiMutate } from '@/lib/api-client/mutate';

/**
 * Hromadné přidání označených kontaktů do seznamu.
 *
 * PROČ VLASTNÍ SOUBOR, ne `actions.ts`. Přihlášení do seznamu je jediná hromadná akce,
 * která sahá na souhlas s odběrem, takže má stejné postavení jako ruční potvrzení
 * v `confirm-actions.ts`: vlastní soubor, vlastní výsledek po položkách a vlastní
 * poznámka o tom, co se smí a co ne.
 *
 * PŘIHLÁŠENÍ ZAPISUJE API, NE TENHLE SOUBOR. Jde přes
 * `POST /api/v1/lists/{id}/subscribe:bulk`, které pod sebou volá `subscribeToList`
 * a ta stavový automat z `packages/core/src/contacts/lists/state-machine.ts`.
 * Vlastní SQL by znamenalo druhou implementaci pravidel a obešlo by audit i souhlas.
 *
 * ŽÁDNÉ `skip_confirmation` A ŽÁDNÉ `declaration`. To je celé jádro téhle akce.
 * Automat na událost `subscribe` vrací odhlášený kontakt VŽDYCKY přes stav `pending`
 * s potvrzovacím odkazem, i na seznamu s jedním krokem. Zkratka do `confirmed` existuje
 * jen s výslovným prohlášením o doloženém souhlasu, a i ta je odhlášenému kontaktu
 * a živé blokaci zavřená. Kdyby tahle akce prohlášení posílala, vrátil by hromadný
 * výběr odhlášené lidi tiše mezi příjemce, což je přesně ta chyba, kvůli které
 * se pravidlo do automatu psalo. Kdo chce povýšit stav výslovným rozhodnutím správce,
 * má na to vedle v liště tlačítko „Označit jako potvrzené" a to jde jinou cestou
 * (`admin_force_confirm`, zápis do auditu).
 *
 * PROČ SE NEJDŘÍV ČTOU ADRESY. Přihlašovací endpointy pracují s e-mailem, ne s ID:
 * `subscribe` je tatáž cesta, kterou používá veřejný formulář, a ten ID kontaktu nezná.
 * Výběr v tabulce naopak nese ID. Adresy se proto dotáhnou z API a NE z řádků tabulky:
 * výběr přežije přestránkování, takže na obrazovce už nemusí být řádek ke každému ID.
 */

const CONTACTS_PATH = '/[locale]/w/[workspaceSlug]/contacts';
const LISTS_PATH = '/[locale]/w/[workspaceSlug]/lists';

/** Strop jednoho volání, viz `bulkSubscribeRoute` v `lists.routes.ts`. */
const BULK_LIMIT = 1000;

/** Výsledek po položkách. Tvar drží odpověď `POST /lists/{id}/subscribe:bulk`. */
type BulkSubscribeResponse = {
  results: { index: number; outcome: string; contact_id: string | null }[];
};

export type ListAddSummary = {
  /** Přihlášení je rovnou potvrzené: seznam s jedním krokem a kontakt bez minulosti. */
  confirmed: number;
  /** Odešel potvrzovací e-mail. Do rozesílky se kontakt započítá, až odkaz otevře. */
  pending: number;
  /** V seznamu už potvrzený byl. Nic se nezměnilo a žádný e-mail navíc neodešel. */
  already: number;
  /** Přihlásit nešlo: stížnost, živá blokace adresy nebo adresa, kterou nelze použít. */
  blocked: number;
};

export type AddToListResult =
  { status: 'success'; summary: ListAddSummary } | { status: 'error'; code: string };

/**
 * Překlad výsledku jednoho přihlášení na počítadlo.
 *
 * `resend_throttled` patří k `pending` schválně: řádek v seznamu vznikl, jen se
 * potvrzovací e-mail zrovna neposlal kvůli limitu tří odeslání za 24 hodin. Kontakt
 * v seznamu je a čeká na potvrzení, takže lhát o něm jako o přidaném ani o zablokovaném
 * nesmíme.
 */
function countOutcome(summary: ListAddSummary, outcome: string): void {
  if (outcome === 'confirmed') summary.confirmed += 1;
  else if (outcome === 'already_confirmed') summary.already += 1;
  else if (outcome === 'confirmation_sent' || outcome === 'resend_throttled') summary.pending += 1;
  else summary.blocked += 1;
}

/**
 * Adresy k označeným ID. Vrací kód problému místo výjimky, aby volající akce mohla
 * odpovědět stejným tvarem jako u jakékoliv jiné chyby z API.
 */
async function resolveEmails(
  workspaceId: string,
  ids: string[],
): Promise<{ ok: true; emails: string[] } | { ok: false; code: string }> {
  const emails: string[] = [];
  for (const id of ids) {
    const detail = await apiFetch<{ data: { email: string } }>(`/api/v1/contacts/${id}`, {
      workspaceId,
    });
    if (!detail.ok) return { ok: false, code: detail.problem.code };
    emails.push(detail.data.data.email);
  }
  return { ok: true, emails };
}

export async function addContactsToListAction(input: {
  workspaceId: string;
  listId: string;
  ids: string[];
}): Promise<AddToListResult> {
  if (input.ids.length === 0) return { status: 'error', code: 'validation_failed' };

  const resolved = await resolveEmails(input.workspaceId, input.ids);
  if (!resolved.ok) return { status: 'error', code: resolved.code };
  const emails = resolved.emails;

  const summary: ListAddSummary = { confirmed: 0, pending: 0, already: 0, blocked: 0 };

  for (let from = 0; from < emails.length; from += BULK_LIMIT) {
    const chunk = emails.slice(from, from + BULK_LIMIT);
    const result = await apiMutate<BulkSubscribeResponse>(
      `/api/v1/lists/${input.listId}/subscribe:bulk`,
      {
        method: 'POST',
        body: { subscribers: chunk.map((email) => ({ email })) },
        workspaceId: input.workspaceId,
      },
    );
    if (!result.ok) return { status: 'error', code: result.problem.code };
    for (const item of result.data.results) countOutcome(summary, item.outcome);
  }

  revalidatePath(CONTACTS_PATH, 'page');
  revalidatePath(LISTS_PATH, 'page');
  return { status: 'success', summary };
}

/** Výsledek po položkách. Tvar drží odpověď `DELETE /lists/{id}/subscribe:bulk`. */
type BulkUnsubscribeResponse = {
  results: { index: number; outcome: string; contact_id: string | null }[];
};

export type ListRemoveSummary = {
  /** Přihlášení se opravdu změnilo na odhlášené. */
  unsubscribed: number;
  /** Nebylo co měnit: kontakt v seznamu není, nebo v něm odhlášený už byl. */
  unchanged: number;
};

export type RemoveFromListResult =
  { status: 'success'; summary: ListRemoveSummary } | { status: 'error'; code: string };

/**
 * Hromadné odebrání označených kontaktů ze seznamu.
 *
 * ODEBRÁNÍ JE ODHLÁŠENÍ, ne smazání řádku. Historie přihlášení se nikdy neztrácí a
 * odvolání souhlasu se do ní zapíše, takže se později dá doložit, kdy člověk ze seznamu
 * zmizel a kdo za tím byl. Stav kontaktu ani blokované adresy se přitom nemění: odhlášení
 * z jednoho seznamu není odhlášení z projektu.
 *
 * O KAŽDÉ POLOŽCE ROZHODUJE STAVOVÝ AUTOMAT NA SERVERU. Kontakt mimo seznam a kontakt,
 * který je odhlášený už teď, se vrátí jako `unchanged`; rozhraní to musí umět říct,
 * protože „odebráno 12" u výběru, kde deset lidí v seznamu nebylo, je lež.
 */
export async function removeContactsFromListAction(input: {
  workspaceId: string;
  listId: string;
  ids: string[];
}): Promise<RemoveFromListResult> {
  if (input.ids.length === 0) return { status: 'error', code: 'validation_failed' };

  const resolved = await resolveEmails(input.workspaceId, input.ids);
  if (!resolved.ok) return { status: 'error', code: resolved.code };
  const emails = resolved.emails;

  const summary: ListRemoveSummary = { unsubscribed: 0, unchanged: 0 };

  for (let from = 0; from < emails.length; from += BULK_LIMIT) {
    const chunk = emails.slice(from, from + BULK_LIMIT);
    const result = await apiMutate<BulkUnsubscribeResponse>(
      `/api/v1/lists/${input.listId}/subscribe:bulk`,
      { method: 'DELETE', body: { emails: chunk }, workspaceId: input.workspaceId },
    );
    if (!result.ok) return { status: 'error', code: result.problem.code };
    for (const item of result.data.results) {
      // `unknown_contact` se počítá k `unchanged`: z výběru v tabulce nastat nemůže
      // (ID vznikla ze skutečných řádků) a pro uživatele je to táž věta.
      if (item.outcome === 'unsubscribed') summary.unsubscribed += 1;
      else summary.unchanged += 1;
    }
  }

  revalidatePath(CONTACTS_PATH, 'page');
  revalidatePath(LISTS_PATH, 'page');
  return { status: 'success', summary };
}
