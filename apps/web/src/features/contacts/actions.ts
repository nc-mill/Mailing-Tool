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
export async function bulkDeleteContactsAction(input: { scope: BulkScope }): Promise<BulkResult> {
  const result = await apiMutate<void>('/api/v1/contacts/bulk-delete', {
    method: 'POST',
    body: scopeToBody(input.scope),
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(CONTACTS_PATH, 'page');
  return { status: 'success' };
}

/** Export výběru. Vrací 202 a odkaz na stažení dohledá centrum úloh; dialog čeká na výsledek. */
export async function exportContactsAction(input: { scope: BulkScope }): Promise<BulkResult> {
  const result = await apiMutate<{ id: string }>('/api/v1/contacts/exports', {
    method: 'POST',
    body: { ...scopeToBody(input.scope), format: 'csv' },
  });
  return result.ok ? { status: 'success' } : { status: 'error', code: result.problem.code };
}

/** Hromadné přiřazení a odebrání štítků. Vratná operace, proto smí být optimistická. */
export async function bulkTagContactsAction(input: {
  scope: BulkScope;
  add?: string[];
  remove?: string[];
}): Promise<BulkResult> {
  const result = await apiMutate<void>('/api/v1/contacts/tags:bulk', {
    method: 'POST',
    body: { ...scopeToBody(input.scope), add: input.add ?? [], remove: input.remove ?? [] },
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(CONTACTS_PATH, 'page');
  return { status: 'success' };
}

/** Smazání jednoho kontaktu. Režim soft: kontakt jde 30 dní obnovit, adresa zůstane blokovaná. */
export async function deleteContactAction(input: { id: string }): Promise<BulkResult> {
  const result = await apiMutate<void>(`/api/v1/contacts/${input.id}?mode=soft`, {
    method: 'DELETE',
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(CONTACTS_PATH, 'page');
  return { status: 'success' };
}

/** Ruční odhlášení. Vratné, proto se v rozhraní nabízí „Vrátit zpět" místo dialogu. */
export async function unsubscribeContactAction(input: { id: string }): Promise<BulkResult> {
  const result = await apiMutate<void>(`/api/v1/contacts/${input.id}/unsubscribe`, {
    method: 'POST',
  });
  return result.ok ? { status: 'success' } : { status: 'error', code: result.problem.code };
}

/** Export jednoho kontaktu. Je to podklad pro žádost subjektu údajů, proto JSON i CSV. */
export async function exportContactAction(input: { id: string }): Promise<BulkResult> {
  const result = await apiMutate<{ id: string }>('/api/v1/contacts/exports', {
    method: 'POST',
    body: { ids: [input.id], format: 'both' },
  });
  return result.ok ? { status: 'success' } : { status: 'error', code: result.problem.code };
}

/**
 * Operace nad skupinou fronty oslovení. Do 5 000 kontaktů běží server synchronně,
 * nad 5 000 zařadí job contacts.bulk_vocative_review a vrátí 202. Rozhraní o tom
 * ví jen tolik, že v druhém případě přijde stav accepted a ukáže se průběh.
 */
export async function vocativeReviewAction(input: {
  groups: VocativeReviewCommand[];
}): Promise<BulkResult> {
  const result = await apiMutate<void>('/api/v1/vocative-review/confirm', {
    method: 'POST',
    body: { groups: input.groups },
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
export async function vocativeNeutralAllAction(input: { importId?: string }): Promise<BulkResult> {
  const result = await apiMutate<void>('/api/v1/vocative-review/confirm', {
    method: 'POST',
    body: { all: true, action: 'no_name', import_id: input.importId ?? null },
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(`${CONTACTS_PATH}/vocative-review`, 'page');
  return { status: 'success' };
}

/**
 * Odebrání z blokovaných adres. Není optimistické: přidání i odebrání má bezpečnostní
 * dopad a rozhraní nesmí ani na okamžik tvrdit něco, co server nepotvrdil.
 */
export async function removeSuppressionAction(input: {
  id: string;
  note: string;
}): Promise<BulkResult> {
  const result = await apiMutate<void>(`/api/v1/suppressions/${input.id}`, {
    method: 'DELETE',
    body: { note: input.note },
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(SUPPRESSIONS_PATH, 'page');
  return { status: 'success' };
}

/** Zobrazení celé adresy. Server ho zapíše do auditu, proto to není čtení z už načtené stránky. */
export async function revealSuppressionEmailAction(input: {
  id: string;
}): Promise<BulkResult & { email?: string }> {
  const result = await apiMutate<{ email: string }>(`/api/v1/suppressions/${input.id}/reveal`, {
    method: 'POST',
  });
  return result.ok
    ? { status: 'success', email: result.data.email }
    : { status: 'error', code: result.problem.code };
}

export async function archiveFieldAction(input: { id: string }): Promise<BulkResult> {
  const result = await apiMutate<void>(`/api/v1/contact-fields/${input.id}/archive`, {
    method: 'POST',
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(FIELDS_PATH, 'page');
  return { status: 'success' };
}

/** Fáze 1 dvoufázového smazání pole ze 4.2.5 části 2: co všechno se rozbije. */
export async function loadFieldImpactAction(input: {
  id: string;
}): Promise<{ status: 'success'; impact: FieldImpact } | { status: 'error'; code: string }> {
  const result = await apiFetch<FieldImpact>(`/api/v1/contact-fields/${input.id}/impact`);
  return result.ok
    ? { status: 'success', impact: result.data }
    : { status: 'error', code: result.problem.code };
}

export async function deleteFieldAction(input: { id: string }): Promise<BulkResult> {
  const result = await apiMutate<void>(`/api/v1/contact-fields/${input.id}`, { method: 'DELETE' });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(FIELDS_PATH, 'page');
  return { status: 'success' };
}

export async function deleteTagAction(input: { id: string }): Promise<BulkResult> {
  const result = await apiMutate<void>(`/api/v1/tags/${input.id}`, { method: 'DELETE' });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(TAGS_PATH, 'page');
  return { status: 'success' };
}

/**
 * Změna režimu potvrzení. Platí až pro e-maily odeslané po změně: potvrzovací odkazy,
 * které už jsou v cizích schránkách, nesou režim platný v době odeslání.
 */
export async function setConfirmationModeAction(input: {
  id: string;
  mode: 'one_step' | 'two_step';
}): Promise<BulkResult> {
  const result = await apiMutate<void>(`/api/v1/lists/${input.id}`, {
    method: 'PATCH',
    body: { confirmation_mode: input.mode },
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(`${LISTS_PATH}/[id]`, 'page');
  return { status: 'success' };
}

/** Mazání seznamu je jen archivace, historie přihlášení se nikdy neztrácí. */
export async function archiveListAction(input: { id: string }): Promise<BulkResult> {
  const result = await apiMutate<void>(`/api/v1/lists/${input.id}`, { method: 'DELETE' });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(LISTS_PATH, 'page');
  return { status: 'success' };
}
