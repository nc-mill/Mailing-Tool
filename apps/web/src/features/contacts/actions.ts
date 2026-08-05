'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client/fetch';
import { apiMutate } from '@/lib/api-client/mutate';
import type { ContactListFilters } from './filters';
import type { FieldImpact } from './field-impact';
import type { VocativeReviewCommand } from './vocative-review-types';

export type BulkScope =
  { mode: 'ids'; ids: string[] } | { mode: 'filter'; filters: ContactListFilters };

export type BulkResult = { status: 'success' } | { status: 'error'; code: string };

/**
 * `workspaceId` je v každé akci tohohle souboru POVINNÝ, ne pohodlí.
 *
 * `apiMutate` a `apiFetch` z něj skládají hlavičku `X-Workspace-Id`. Bez ní běží
 * požadavek mimo kontext projektu: přihlášení projde, RLS ale nevrátí ani řádek
 * a rozhraní dostane 404 na kontakt, který má uživatel otevřený na obrazovce.
 * Naměřeno v prohlížeči, stejná poznámka je v `features/sending/actions.ts`
 * i v `contacts/edit-actions.ts`.
 *
 * Proto je to samostatný parametr a ne něco, co by si akce dopočítala: serverová
 * akce nemá odkud vzít slug ani projekt, ve kterém uživatel právě je. Předává ho
 * obrazovka, která projekt zná z `getWorkspaceAccess`.
 */
type WithWorkspace = { workspaceId: string };

const CONTACTS_PATH = '/[locale]/w/[workspaceSlug]/contacts';
const SUPPRESSIONS_PATH = '/[locale]/w/[workspaceSlug]/suppressions';
const LISTS_PATH = '/[locale]/w/[workspaceSlug]/lists';
const TAGS_PATH = '/[locale]/w/[workspaceSlug]/tags';
const FIELDS_PATH = '/[locale]/w/[workspaceSlug]/settings/fields';

function scopeToBody(scope: BulkScope): Record<string, unknown> {
  return scope.mode === 'ids' ? { ids: scope.ids } : { filter: scope.filters };
}

/**
 * Hromadné smazání. Server vrací 202 a job contacts.bulk_delete, takže tahle akce
 * nečeká na dokončení. Idempotency-Key doplňuje apiMutate podle 4.4 části 1.
 */
export async function bulkDeleteContactsAction(
  input: WithWorkspace & { scope: BulkScope },
): Promise<BulkResult> {
  const result = await apiMutate<void>('/api/v1/contacts/bulk-delete', {
    method: 'POST',
    body: scopeToBody(input.scope),
    workspaceId: input.workspaceId,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(CONTACTS_PATH, 'page');
  return { status: 'success' };
}

/** Export výběru. Vrací 202 a odkaz na stažení dohledá centrum úloh; dialog čeká na výsledek. */
export async function exportContactsAction(
  input: WithWorkspace & { scope: BulkScope },
): Promise<BulkResult> {
  const result = await apiMutate<{ id: string }>('/api/v1/contacts/exports', {
    method: 'POST',
    body: { ...scopeToBody(input.scope), format: 'csv' },
    workspaceId: input.workspaceId,
  });
  return result.ok ? { status: 'success' } : { status: 'error', code: result.problem.code };
}

/**
 * Hromadné přiřazení a odebrání štítků. Vratná operace, proto smí být optimistická.
 *
 * TĚLO SE SKLÁDÁ ZVLÁŠŤ, ne přes `scopeToBody`, a je to oprava vady, kvůli které
 * tahle akce NIKDY NEFUNGOVALA. Endpoint štítků chce `filter.contact_ids`
 * (`BulkTagBody` v `packages/core/src/contacts/api/tags.routes.ts`), kdežto
 * `scopeToBody` vyrábí `{ ids }` pro výběr a `{ filter }` pro „vše odpovídající
 * filtru", což je tvar hromadného mazání. Schéma je `.strict()`, takže obojí
 * skončilo na 422 `validation_failed` a uživatel viděl jen „Štítek se nepodařilo
 * změnit. Technický detail: validation_failed".
 *
 * Režim „vše odpovídající filtru" endpoint NEPODPORUJE a je to vědomé rozhodnutí
 * domény, popsané přímo u schématu: `bulkTagContacts` umí jen výčet id, protože
 * jen nad ním jde spolehlivě rozhodnout, kdy se operace přesune do fronty.
 * Vracíme proto srozumitelný kód místo požadavku, který server stejně odmítne.
 */
export async function bulkTagContactsAction(
  input: WithWorkspace & {
    scope: BulkScope;
    add?: string[];
    remove?: string[];
  },
): Promise<BulkResult> {
  if (input.scope.mode !== 'ids') {
    return { status: 'error', code: 'bulk_tag_needs_selection' };
  }
  const result = await apiMutate<void>('/api/v1/contacts/tags:bulk', {
    method: 'POST',
    body: {
      filter: { contact_ids: input.scope.ids },
      add: input.add ?? [],
      remove: input.remove ?? [],
    },
    workspaceId: input.workspaceId,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(CONTACTS_PATH, 'page');
  return { status: 'success' };
}

/** Smazání jednoho kontaktu. Režim soft: kontakt jde 30 dní obnovit, adresa zůstane blokovaná. */
export async function deleteContactAction(
  input: WithWorkspace & { id: string },
): Promise<BulkResult> {
  const result = await apiMutate<void>(`/api/v1/contacts/${input.id}?mode=soft`, {
    method: 'DELETE',
    workspaceId: input.workspaceId,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(CONTACTS_PATH, 'page');
  return { status: 'success' };
}

/**
 * Ruční odhlášení. Vratné, proto se v rozhraní nabízí „Vrátit zpět" místo dialogu.
 *
 * Jde přes `DELETE /lists/{id}/subscribe` pro každý seznam, ve kterém kontakt je.
 * Dřív mířila na `POST /contacts/{id}/unsubscribe`, jenže TAKOVÝ ENDPOINT V API
 * NENÍ (ověřeno proti `/api/v1/openapi.json` běžící aplikace i proti
 * `contacts.routes.ts`). Tlačítko proto padalo na 404 i poté, co dostalo
 * `workspaceId`: chyběly obě poloviny, hlavička i existující cesta.
 *
 * Odhlášení je v tomhle produktu vždycky odhlášení ZE SEZNAMU, ne z projektu:
 * `unsubscribe` v jádru zapisuje odvolání souhlasu s rozsahem daného seznamu.
 * Kdyby se stav kontaktu měnil bokem, souhlasy by se s ním rozešly.
 *
 * Seznamy předává obrazovka, protože je už má načtené z detailu kontaktu. Kontakt
 * bez seznamu se odhlásit nedá a akce to řekne kódem, místo aby předstírala úspěch.
 */
export async function unsubscribeContactAction(
  input: WithWorkspace & { email: string; listIds: string[] },
): Promise<BulkResult> {
  if (input.listIds.length === 0) return { status: 'error', code: 'not_found' };

  for (const listId of input.listIds) {
    const result = await apiMutate<void>(`/api/v1/lists/${listId}/subscribe`, {
      method: 'DELETE',
      body: { email: input.email },
      workspaceId: input.workspaceId,
    });
    if (!result.ok) return { status: 'error', code: result.problem.code };
  }
  revalidatePath(`${CONTACTS_PATH}/[id]`, 'page');
  revalidatePath(CONTACTS_PATH, 'page');
  return { status: 'success' };
}

/** Export jednoho kontaktu. Je to podklad pro žádost subjektu údajů, proto JSON i CSV. */
export async function exportContactAction(
  input: WithWorkspace & { id: string },
): Promise<BulkResult> {
  const result = await apiMutate<{ id: string }>('/api/v1/contacts/exports', {
    method: 'POST',
    body: { ids: [input.id], format: 'both' },
    workspaceId: input.workspaceId,
  });
  return result.ok ? { status: 'success' } : { status: 'error', code: result.problem.code };
}

/**
 * Operace nad skupinou fronty oslovení. Do 5 000 kontaktů běží server synchronně,
 * nad 5 000 zařadí job contacts.bulk_vocative_review a vrátí 202. Rozhraní o tom
 * ví jen tolik, že v druhém případě přijde stav accepted a ukáže se průběh.
 */
export async function vocativeReviewAction(
  input: WithWorkspace & { groups: VocativeReviewCommand[] },
): Promise<BulkResult> {
  const result = await apiMutate<void>('/api/v1/vocative-review/confirm', {
    method: 'POST',
    body: { groups: input.groups },
    workspaceId: input.workspaceId,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(`${CONTACTS_PATH}/vocative-review`, 'page');
  return { status: 'success' };
}

/**
 * Hromadné neutrální oslovení u všech nejistých kontaktů. Je to doporučená volba nad
 * stropem ruční práce: zapíše se first_name_vocative = NULL a vocative_locked = true,
 * takže greeting spadne na „Dobrý den" a fronta se vyprázdní.
 */
export async function vocativeNeutralAllAction(
  input: WithWorkspace & { importId?: string },
): Promise<BulkResult> {
  const result = await apiMutate<void>('/api/v1/vocative-review/confirm', {
    method: 'POST',
    body: { all: true, action: 'no_name', import_id: input.importId ?? null },
    workspaceId: input.workspaceId,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(`${CONTACTS_PATH}/vocative-review`, 'page');
  return { status: 'success' };
}

/**
 * Odebrání z blokovaných adres. Není optimistické: přidání i odebrání má bezpečnostní
 * dopad a rozhraní nesmí ani na okamžik tvrdit něco, co server nepotvrdil.
 */
export async function removeSuppressionAction(
  input: WithWorkspace & { id: string; note: string },
): Promise<BulkResult> {
  const result = await apiMutate<void>(`/api/v1/suppressions/${input.id}`, {
    method: 'DELETE',
    body: { note: input.note },
    workspaceId: input.workspaceId,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(SUPPRESSIONS_PATH, 'page');
  return { status: 'success' };
}

/**
 * Ruční zablokování adresy.
 *
 * Prázdný stav obrazovky slibuje „Přidat si sem adresu můžete i ručně." a měl
 * pod tím tlačítko, které volalo `router.push(basePath)`, tedy navigaci na
 * tutéž stránku, na které uživatel stál. Kliknutí nedělalo vůbec nic, ani chybu
 * v konzoli; ověřeno v prohlížeči. Endpoint `POST /api/v1/suppressions` přitom
 * existoval celou dobu, chyběla jen tahle akce a dialog nad ní.
 */
export async function addSuppressionAction(
  input: WithWorkspace & { email: string; detail?: string },
): Promise<BulkResult> {
  const result = await apiMutate<{ id: string; created: boolean }>('/api/v1/suppressions', {
    method: 'POST',
    body: {
      email: input.email,
      reason: 'manual',
      ...(input.detail === undefined || input.detail === '' ? {} : { detail: input.detail }),
    },
    workspaceId: input.workspaceId,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(SUPPRESSIONS_PATH, 'page');
  return { status: 'success' };
}

/*
 * ODKRYTÍ CELÉ ADRESY TU ZÁMĚRNĚ NENÍ.
 *
 * Byla tu akce `revealSuppressionEmailAction`, která volala
 * `POST /api/v1/suppressions/{id}/reveal`. Taková cesta v API NIKDY nebyla:
 * `suppressions.routes.ts` zná jen výpis, přidání a odebrání a v kontraktu
 * (`packages/contracts/openapi.json`) jsou jen `/api/v1/suppressions`
 * a `/api/v1/suppressions/{id}`. Tlačítko „Zobrazit celou adresu" tedy
 * spolehlivě padalo na 404 a adresa se nikdy neodkryla.
 *
 * Maskování je v seznamu blokovaných adres záměr, ne nedopatření: schéma
 * odpovědi vrací jen `masked_email` a auditní tabulka nemá akci
 * `suppression.revealed`, kterou by odkrytí muselo zapsat. Doplnit endpoint
 * proto není jednořádková oprava a patří do vlastního úkolu; do té doby se
 * konkrétní adresa hledá filtrem `q` nad seznamem.
 */

export async function archiveFieldAction(
  input: WithWorkspace & { id: string },
): Promise<BulkResult> {
  const result = await apiMutate<void>(`/api/v1/contact-fields/${input.id}/archive`, {
    method: 'POST',
    workspaceId: input.workspaceId,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(FIELDS_PATH, 'page');
  return { status: 'success' };
}

/** Fáze 1 dvoufázového smazání pole ze 4.2.5 části 2: co všechno se rozbije. */
export async function loadFieldImpactAction(
  input: WithWorkspace & { id: string },
): Promise<{ status: 'success'; impact: FieldImpact } | { status: 'error'; code: string }> {
  const result = await apiFetch<FieldImpact>(`/api/v1/contact-fields/${input.id}/impact`, {
    workspaceId: input.workspaceId,
  });
  return result.ok
    ? { status: 'success', impact: result.data }
    : { status: 'error', code: result.problem.code };
}

export async function deleteFieldAction(
  input: WithWorkspace & { id: string },
): Promise<BulkResult> {
  const result = await apiMutate<void>(`/api/v1/contact-fields/${input.id}`, {
    method: 'DELETE',
    workspaceId: input.workspaceId,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(FIELDS_PATH, 'page');
  return { status: 'success' };
}

export async function deleteTagAction(input: WithWorkspace & { id: string }): Promise<BulkResult> {
  const result = await apiMutate<void>(`/api/v1/tags/${input.id}`, {
    method: 'DELETE',
    workspaceId: input.workspaceId,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(TAGS_PATH, 'page');
  return { status: 'success' };
}

/**
 * Změna režimu potvrzení. Platí až pro e-maily odeslané po změně: potvrzovací odkazy,
 * které už jsou v cizích schránkách, nesou režim platný v době odeslání.
 */
export async function setConfirmationModeAction(
  input: WithWorkspace & { id: string; mode: 'one_step' | 'two_step' },
): Promise<BulkResult> {
  const result = await apiMutate<void>(`/api/v1/lists/${input.id}`, {
    method: 'PATCH',
    body: { confirmation_mode: input.mode },
    workspaceId: input.workspaceId,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(`${LISTS_PATH}/[id]`, 'page');
  return { status: 'success' };
}

/**
 * Přepnutí seznamu mezi jednofázovým a dvoufázovým přihlášením.
 *
 * Platí až pro přihlášení, která přijdou po změně; kdo už čeká na potvrzení, čeká dál
 * (na ty je „Potvrdit čekající"). Zpětně by to nešlo ani udělat: `pending` řádek nenese
 * informaci, jestli by při jiném nastavení vznikl rovnou potvrzený.
 */
export async function setOptInAction(
  input: WithWorkspace & { id: string; optIn: 'single' | 'double' },
): Promise<BulkResult> {
  const result = await apiMutate<void>(`/api/v1/lists/${input.id}`, {
    method: 'PATCH',
    body: { opt_in: input.optIn },
    workspaceId: input.workspaceId,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(`${LISTS_PATH}/[id]`, 'page');
  revalidatePath(LISTS_PATH, 'page');
  return { status: 'success' };
}

/**
 * Hromadné potvrzení čekajících přihlášení seznamu. Prohlášení o doloženém souhlasu
 * posílá obrazovka natvrdo `true`, protože tlačítko je za potvrzovacím dialogem, který
 * se na to ptá slovy; server bez něj neudělá nic.
 */
export async function confirmPendingAction(
  input: WithWorkspace & { id: string },
): Promise<BulkResult & { pending?: number; confirmed?: number; skipped?: number }> {
  const result = await apiMutate<{ pending: number; confirmed: number; skipped: number }>(
    `/api/v1/lists/${input.id}/subscriptions:confirm-pending`,
    { method: 'POST', body: { declaration: true }, workspaceId: input.workspaceId },
  );
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(`${LISTS_PATH}/[id]`, 'page');
  revalidatePath(LISTS_PATH, 'page');
  return { status: 'success', ...result.data };
}

/**
 * Veřejné nabízení seznamu: nabízí se v centru předvoleb k přihlášení, a pod jakým
 * názvem.
 *
 * PROČ TO NENÍ KOSMETIKA. Zapnuté nabízení znamená, že se do seznamu smí sám přihlásit
 * kdokoli, kdo drží odhlašovací odkaz z libovolného našeho e-mailu. U seznamu, který
 * znamená nárok („VIP", „Zákazníci se slevou"), je to nárok zdarma. Výchozí stav je
 * proto vypnuto a zapíná se vědomě.
 *
 * Prázdný veřejný název se posílá jako `null`, ne jako prázdný řetězec: „nevyplněno"
 * a „prázdné jméno" jsou dvě různé věci a databáze to druhé nedovolí.
 */
export async function setListPublicVisibilityAction(
  input: WithWorkspace & {
    id: string;
    publicVisible: boolean;
    publicName: string;
    publicDescription: string;
  },
): Promise<BulkResult> {
  const result = await apiMutate<void>(`/api/v1/lists/${input.id}`, {
    method: 'PATCH',
    body: {
      public_visible: input.publicVisible,
      public_name: input.publicName.trim() === '' ? null : input.publicName.trim(),
      public_description:
        input.publicDescription.trim() === '' ? null : input.publicDescription.trim(),
    },
    workspaceId: input.workspaceId,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(`${LISTS_PATH}/[id]`, 'page');
  revalidatePath(LISTS_PATH, 'page');
  return { status: 'success' };
}

/** Mazání seznamu je jen archivace, historie přihlášení se nikdy neztrácí. */
export async function archiveListAction(
  input: WithWorkspace & { id: string },
): Promise<BulkResult> {
  const result = await apiMutate<void>(`/api/v1/lists/${input.id}`, {
    method: 'DELETE',
    workspaceId: input.workspaceId,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(LISTS_PATH, 'page');
  return { status: 'success' };
}
