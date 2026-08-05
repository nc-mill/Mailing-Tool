'use server';

import { revalidatePath } from 'next/cache';
import { apiMutate } from '@/lib/api-client/mutate';
import type { Problem } from '@/lib/api-client/problem';

/**
 * Serverové akce předvoleb odesílatele.
 *
 * Tvar je opsaný z `features/sending/actions.ts`, ať se v repozitáři neobjeví
 * druhý způsob, jak volat totéž API: `workspaceId` je povinný parametr každé
 * akce (bez hlavičky `X-Workspace-Id` běží požadavek mimo kontext projektu
 * a API vrací 404), výsledek je diskriminovaná unie a na konci se vždycky
 * revaliduje cesta se ZÁSTUPNÝMI segmenty.
 */
export type SenderActionResult =
  | { status: 'success' }
  /**
   * `fieldErrors` nese chyby z `422 validation_failed`, aby dosedly k tomu poli,
   * které je způsobilo. Bez toho by dialog uměl říct jen „něco je špatně",
   * přestože server přesně ví, jestli je vadná adresa, nebo doména.
   */
  | { status: 'error'; code: string; detail: string; fieldErrors: Record<string, string> };

const SENDERS_PATH = '/[locale]/w/[workspaceSlug]/settings/senders';
/** Rozbalovací seznam u kampaně čte tytéž předvolby, takže se revaliduje i tam. */
const CAMPAIGN_PATH = '/[locale]/w/[workspaceSlug]/campaigns/[id]';

export type SenderIdentityBody = {
  name: string;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  provider_id: string;
  sender_domain_id: string;
  is_default: boolean;
};

function toFailure(problem: Problem): SenderActionResult {
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

function done(): SenderActionResult {
  revalidatePath(SENDERS_PATH, 'page');
  revalidatePath(CAMPAIGN_PATH, 'page');
  return { status: 'success' };
}

export async function createSenderAction(input: {
  workspaceId: string;
  body: SenderIdentityBody;
}): Promise<SenderActionResult> {
  const result = await apiMutate<unknown>('/api/v1/senders', {
    method: 'POST',
    workspaceId: input.workspaceId,
    body: input.body,
  });
  if (!result.ok) return toFailure(result.problem);
  return done();
}

/**
 * Úprava je `PUT`, ne `PATCH`, a je to shodné s API: předvolba je jedna sada
 * pěti údajů, které dávají smysl jen dohromady, takže se posílá celá.
 */
export async function updateSenderAction(input: {
  workspaceId: string;
  id: string;
  body: SenderIdentityBody;
}): Promise<SenderActionResult> {
  const result = await apiMutate<unknown>(`/api/v1/senders/${input.id}`, {
    method: 'PUT',
    workspaceId: input.workspaceId,
    body: input.body,
  });
  if (!result.ok) return toFailure(result.problem);
  return done();
}

export async function deleteSenderAction(input: {
  workspaceId: string;
  id: string;
}): Promise<SenderActionResult> {
  const result = await apiMutate<unknown>(`/api/v1/senders/${input.id}`, {
    method: 'DELETE',
    workspaceId: input.workspaceId,
  });
  if (!result.ok) return toFailure(result.problem);
  return done();
}

export async function setDefaultSenderAction(input: {
  workspaceId: string;
  id: string;
}): Promise<SenderActionResult> {
  const result = await apiMutate<unknown>(`/api/v1/senders/${input.id}/default`, {
    method: 'POST',
    workspaceId: input.workspaceId,
  });
  if (!result.ok) return toFailure(result.problem);
  return done();
}

/**
 * Použití předvolby na kampani.
 *
 * ZAPISUJE SE ROVNOU, ne že by se jen předvyplnil formulář v prohlížeči, a je
 * to vynucené tvarem obrazovky nastavení kampaně: účet i doména jsou tam
 * `SelectField`, který si hodnotu drží ve vlastním stavu a zvenčí ji přepsat
 * nejde. Kdyby předvolba měnila jen skrytá pole, ukazoval by rozbalovací seznam
 * pořád starý účet a formulář by lhal.
 *
 * Zapsat a překreslit je proti tomu poctivé: `router.refresh()` přinese nové
 * hodnoty, `selectKey` v nastavení kampaně na jejich změnu reaguje přemountováním
 * a uživatel vidí přesně to, co je uložené. Rozdělaný text v ostatních polích
 * přitom zůstává, protože ta jsou neřízená a `refresh` je nepřemountuje.
 *
 * Je to týž vzor, jaký v tom formuláři už je: „Zrušit plán a upravit" taky dělá
 * vlastní zápis a refresh, ne odeslání celého formuláře.
 */
export async function applySenderToCampaignAction(input: {
  workspaceId: string;
  campaignId: string;
  identity: {
    id: string;
    from_name: string;
    from_email: string;
    reply_to: string | null;
    provider_id: string;
    sender_domain_id: string;
  };
}): Promise<SenderActionResult> {
  const result = await apiMutate<unknown>(`/api/v1/campaigns/${input.campaignId}`, {
    method: 'PATCH',
    workspaceId: input.workspaceId,
    body: {
      from_name: input.identity.from_name,
      from_email: input.identity.from_email,
      reply_to: input.identity.reply_to,
      provider_id: input.identity.provider_id,
      sender_domain_id: input.identity.sender_domain_id,
      sender_identity_id: input.identity.id,
    },
  });
  if (!result.ok) return toFailure(result.problem);
  revalidatePath(CAMPAIGN_PATH, 'page');
  return { status: 'success' };
}
