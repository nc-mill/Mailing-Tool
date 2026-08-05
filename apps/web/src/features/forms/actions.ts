'use server';

import { revalidatePath } from 'next/cache';
import { apiMutate } from '@/lib/api-client/mutate';
import type { Problem } from '@/lib/api-client/problem';
import type { FormView } from './types';

/**
 * Serverové akce formulářů.
 *
 * Tvar je opsaný z `features/senders/actions.ts`, ať v repozitáři nevznikne druhý
 * způsob, jak volat totéž API: `workspaceId` je povinný parametr každé akce (bez
 * hlavičky `X-Workspace-Id` běží požadavek mimo kontext projektu a API vrací 404),
 * výsledek je diskriminovaná unie a revaliduje se cesta se ZÁSTUPNÝMI segmenty.
 */
export type FormActionResult =
  | { status: 'success'; id: string }
  | { status: 'error'; code: string; detail: string; fieldErrors: Record<string, string> };

const LIST_PATH = '/[locale]/w/[workspaceSlug]/forms';
const DETAIL_PATH = '/[locale]/w/[workspaceSlug]/forms/[id]';
const EMBED_PATH = '/[locale]/w/[workspaceSlug]/forms/[id]/embed';

function toFailure(problem: Problem): FormActionResult {
  const fieldErrors: Record<string, string> = {};
  for (const issue of problem.errors ?? []) {
    // První chyba na poli vyhrává. Druhá by tu první přepsala a uživatel by
    // opravoval něco jiného, než co mu obrazovka ukázala.
    if (issue.path !== '' && fieldErrors[issue.path] === undefined) {
      fieldErrors[issue.path] = issue.message;
    }
  }
  return { status: 'error', code: problem.code, detail: problem.detail, fieldErrors };
}

function done(id: string): FormActionResult {
  revalidatePath(LIST_PATH, 'page');
  revalidatePath(DETAIL_PATH, 'page');
  revalidatePath(EMBED_PATH, 'page');
  return { status: 'success', id };
}

export type CreateFormBody = {
  name: string;
  /** Prázdné pole znamená „zatím nikam", formulář jen založí kontakt. */
  list_ids: string[];
};

export async function createFormAction(input: {
  workspaceId: string;
  body: CreateFormBody;
}): Promise<FormActionResult> {
  const result = await apiMutate<{ data: FormView }>('/api/v1/forms', {
    method: 'POST',
    workspaceId: input.workspaceId,
    body: input.body,
  });
  if (!result.ok) return toFailure(result.problem);
  return done(result.data.data.id);
}

/**
 * Úprava je PATCH, ne PUT: obrazovka posílá jen to jedno pole, které uživatel
 * změnil, a zbytek definice formuláře (pole, ochrany, vzhled) se tím nesmí
 * přepsat na výchozí hodnoty.
 */
export async function updateFormAction(input: {
  workspaceId: string;
  id: string;
  body: Partial<{
    name: string;
    list_ids: string[];
    double_opt_in: boolean;
    consent_text: string | null;
    active: boolean;
    delivery_template_id: string | null;
    redirect_url: string | null;
    success_message: Record<string, string>;
  }>;
}): Promise<FormActionResult> {
  const result = await apiMutate<{ data: FormView }>(`/api/v1/forms/${input.id}`, {
    method: 'PATCH',
    workspaceId: input.workspaceId,
    body: input.body,
  });
  if (!result.ok) return toFailure(result.problem);
  return done(input.id);
}

/**
 * Založení e-mailu k formuláři a jeho rovnou navázání.
 *
 * JEDNA AKCE, ne dvě. Uživatel klikne „Vytvořit e-mail" a čeká, že bude hotovo:
 * kdyby se šablona jen založila a navázání zůstalo na něm, skončil by v editoru
 * s e-mailem, který formulář neposílá, a nikde by se to nedozvěděl.
 *
 * `kind: 'transactional'`, ne `'campaign'`. Je to zpráva, kterou si člověk vyžádal
 * odesláním formuláře, ne rozesílka, a doména šablon na ni má vlastní validační
 * profil (`validationProfileFor`).
 */
export async function createDeliveryTemplateAction(input: {
  workspaceId: string;
  formId: string;
  name: string;
  document: unknown;
}): Promise<FormActionResult> {
  const created = await apiMutate<{ id: string }>('/api/v1/templates', {
    method: 'POST',
    workspaceId: input.workspaceId,
    body: { name: input.name, kind: 'transactional', document: input.document },
  });
  if (!created.ok) return toFailure(created.problem);

  const linked = await apiMutate<{ data: FormView }>(`/api/v1/forms/${input.formId}`, {
    method: 'PATCH',
    workspaceId: input.workspaceId,
    body: { delivery_template_id: created.data.id },
  });
  if (!linked.ok) return toFailure(linked.problem);

  // Vrací se identifikátor ŠABLONY, ne formuláře: volající s ním rovnou otevírá editor.
  return done(created.data.id);
}

/** Pole formuláře v těle požadavku. Popisek je prostý řetězec, převod řeší API. */
export type FormFieldBody = {
  target: string | { attribute: string };
  label: string;
  required: boolean;
  type: string;
  options?: { value: string; label: string }[];
};

/**
 * Uložení celé sady polí naráz.
 *
 * Po polích to nejde: pořadí je vlastnost SEZNAMU, ne jednotlivého pole, a formulář
 * má strop patnácti položek, který se dá vyhodnotit taky jen nad celkem.
 */
export async function saveFormFieldsAction(input: {
  workspaceId: string;
  id: string;
  fields: FormFieldBody[];
}): Promise<FormActionResult> {
  const result = await apiMutate<{ data: FormView }>(`/api/v1/forms/${input.id}`, {
    method: 'PATCH',
    workspaceId: input.workspaceId,
    body: { fields: input.fields },
  });
  if (!result.ok) return toFailure(result.problem);
  return done(input.id);
}

/**
 * Založení vlastního pole kontaktu PŘÍMO ZE STAVITELE formuláře.
 *
 * Bez téhle cesty by uživatel musel odejít do Nastavení, založit pole, vrátit se
 * a znovu najít, kde skončil. Přesně tam se dnes lidé ztrácejí, takže se zakládá
 * odsud a formulář si nové pole rovnou vezme.
 */
export async function createContactFieldAction(input: {
  workspaceId: string;
  key: string;
  label: string;
  type: string;
  options?: Record<string, unknown>;
}): Promise<
  | { status: 'success'; id: string; key: string }
  | { status: 'error'; code: string; detail: string; fieldErrors: Record<string, string> }
> {
  const result = await apiMutate<{ data: { id: string; key: string } }>('/api/v1/contact-fields', {
    method: 'POST',
    workspaceId: input.workspaceId,
    body: {
      key: input.key,
      // Katalog polí drží popisky jako mapu jazyků s povinným `en`, stejně jako formulář.
      label: { en: input.label, cs: input.label },
      type: input.type,
      ...(input.options === undefined ? {} : { options: input.options }),
    },
  });
  if (!result.ok) {
    const failure = toFailure(result.problem);
    if (failure.status === 'error') return failure;
  }
  const created = result.ok ? result.data.data : null;
  if (created === null) {
    return { status: 'error', code: 'unknown', detail: '', fieldErrors: {} };
  }
  revalidatePath(DETAIL_PATH, 'page');
  return { status: 'success', id: created.id, key: created.key };
}

export async function deleteFormAction(input: {
  workspaceId: string;
  id: string;
}): Promise<FormActionResult> {
  const result = await apiMutate<unknown>(`/api/v1/forms/${input.id}`, {
    method: 'DELETE',
    workspaceId: input.workspaceId,
  });
  if (!result.ok) return toFailure(result.problem);
  return done(input.id);
}
