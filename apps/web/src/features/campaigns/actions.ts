'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { apiMutate } from '@/lib/api-client/mutate';
import type { Problem } from '@/lib/api-client/problem';
import { failed, succeeded, type ActionState } from '@/lib/feedback/action-result';
import { NO_SELECTION } from './no-selection';

export type ActionResult = { status: 'success' } | { status: 'error'; code: string };

const CAMPAIGNS_PATH = '/[locale]/w/[workspaceSlug]/campaigns';
const CAMPAIGN_DETAIL_PATH = '/[locale]/w/[workspaceSlug]/campaigns/[id]';

/**
 * `workspaceId` se do každé akce předává schválně. `apiMutate` posílá hlavičku
 * `X-Workspace-Id` jen tehdy, když ji dostane, a bez ní běží požadavek mimo kontext
 * projektu: ověřeno spuštěním proti běžící aplikaci, kde `POST /campaigns/{id}/send`
 * bez té hlavičky vrátil 404 a obrazovka mlčela.
 */
export async function sendCampaignAction(input: {
  workspaceId: string;
  campaignId: string;
  confirmRecipientCount: number;
}): Promise<ActionResult> {
  const result = await apiMutate<{ id: string }>(`/api/v1/campaigns/${input.campaignId}/send`, {
    method: 'POST',
    workspaceId: input.workspaceId,
    body: { confirm_recipient_count: input.confirmRecipientCount },
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(CAMPAIGNS_PATH, 'page');
  return { status: 'success' };
}

/**
 * Založení rozepsané kampaně. Obsah se dopisuje v editoru šablon (P12), tady vzniká
 * jen řádek se jménem, aby prázdný stav nabízel akci, která opravdu něco udělá.
 */
export async function createCampaignAction(input: {
  workspaceId: string;
  name: string;
}): Promise<{ status: 'success'; id: string } | { status: 'error'; code: string }> {
  const result = await apiMutate<{ id: string }>('/api/v1/campaigns', {
    method: 'POST',
    workspaceId: input.workspaceId,
    body: { name: input.name },
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(CAMPAIGNS_PATH, 'page');
  return { status: 'success', id: result.data.id };
}

async function control(
  workspaceId: string,
  campaignId: string,
  action: string,
): Promise<ActionResult> {
  /*
   * Prázdné tělo `{}` je tu schválně. Kostra API kontroluje `Content-Type` u každého
   * POST a `apiMutate` hlavičku posílá jen tehdy, když nějaké tělo dostane. Bez toho
   * vracely pauza, pokračování, zrušení i vzetí zpět 415 `unsupported_media_type`
   * a obrazovka mlčela. Ověřeno spuštěním proti běžící aplikaci.
   */
  const result = await apiMutate<unknown>(`/api/v1/campaigns/${campaignId}/${action}`, {
    method: 'POST',
    workspaceId,
    body: {},
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(CAMPAIGNS_PATH, 'page');
  return { status: 'success' };
}

/** Pauza působí jen na zprávy ve stavu pending. Zprávy v claimed doběhnou. */
export async function pauseCampaignAction(input: {
  workspaceId: string;
  campaignId: string;
}): Promise<ActionResult> {
  return control(input.workspaceId, input.campaignId, 'pause');
}

export async function resumeCampaignAction(input: {
  workspaceId: string;
  campaignId: string;
}): Promise<ActionResult> {
  return control(input.workspaceId, input.campaignId, 'resume');
}

/** Zrušení zbytku rozesílky. Odeslané zprávy zpátky vzít nejde a UI to říká nahlas. */
export async function cancelCampaignAction(input: {
  workspaceId: string;
  campaignId: string;
}): Promise<ActionResult> {
  return control(input.workspaceId, input.campaignId, 'cancel');
}

/** Vzetí zpět jde jen v okně, kdy je zaručeno, že neodešel ani jeden mail. */
export async function undoCampaignAction(input: {
  workspaceId: string;
  campaignId: string;
}): Promise<ActionResult> {
  return control(input.workspaceId, input.campaignId, 'undo');
}

/**
 * Zrušení plánu, tedy návrat naplánované kampaně do stavu `draft`.
 *
 * Je to jediná cesta, jak se naplánovaná kampaň dá zase upravit: `PATCH` u ní
 * pustí jen tři klíče plánu a na cokoli dalšího vrátí 409 `campaign_locked`.
 * Bez téhle akce by uzamčená obrazovka jen konstatovala, že to nejde.
 */
export async function unscheduleCampaignAction(input: {
  workspaceId: string;
  campaignId: string;
}): Promise<ActionResult> {
  return control(input.workspaceId, input.campaignId, 'unschedule');
}

/* ------------------------------------------------------------------------ *
 * Nastavení kampaně
 * ------------------------------------------------------------------------ */

type Issue = { path: string; code: string; message: string };

function validationProblem(instance: string, issues: Issue[]): Problem {
  return {
    type: 'https://docs.mlain.dev/errors/validation_failed',
    title: 'Validation failed',
    status: 422,
    detail: '',
    instance,
    code: 'validation_failed',
    request_id: '',
    errors: issues,
  };
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function optionalId(formData: FormData, name: string): string | null {
  const value = text(formData, name);
  return value === '' || value === NO_SELECTION ? null : value;
}

function ids(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .filter((value): value is string => typeof value === 'string' && value !== '');
}

/**
 * Adresa se ověřuje TADY, ne až podle odpovědi API. `PatchCampaignRequest` má
 * `from_email` jako `z.email()`, takže by neplatná adresa skončila obecnou 422
 * bez cesty k poli a formulář by neměl u čeho chybu ukázat.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Uložení nastavení kampaně: předmět, odesílatel, šablona, publikum a měření.
 *
 * Posílá se JEN to, co obrazovka opravdu nese. `PATCH /campaigns/{id}` je
 * částečný zápis se `.strict()` schématem, takže vynechané pole zůstane, jak
 * bylo, a klíč navíc by celý požadavek shodil na 422.
 *
 * `workspaceId` se předává stejně jako u ostatních akcí souboru. Bez něj chybí
 * hlavička `X-Workspace-Id` a API vrátí 404 na kampaň, která existuje.
 */
export async function updateCampaignSettingsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const t = await getTranslations('campaigns.settings.errors');

  const workspaceId = text(formData, 'workspace_id');
  const campaignId = text(formData, 'campaign_id');
  const instance = `/api/v1/campaigns/${campaignId}`;

  const name = text(formData, 'name');
  const subject = text(formData, 'subject');
  const preheader = text(formData, 'preheader');
  const fromName = text(formData, 'from_name');
  const fromEmail = text(formData, 'from_email');
  const replyTo = text(formData, 'reply_to');
  const includeLists = ids(formData, 'include_list');
  const includeSegments = ids(formData, 'include_segment');

  const issues: Issue[] = [];
  if (name === '') issues.push({ path: 'name', code: 'required', message: t('nameRequired') });
  if (name.length > 200) issues.push({ path: 'name', code: 'too_long', message: t('nameTooLong') });
  if (subject === '') {
    issues.push({ path: 'subject', code: 'required', message: t('subjectRequired') });
  }
  if (subject.length > 255) {
    issues.push({ path: 'subject', code: 'too_long', message: t('subjectTooLong') });
  }
  if (preheader.length > 255) {
    issues.push({ path: 'preheader', code: 'too_long', message: t('preheaderTooLong') });
  }
  if (fromEmail !== '' && !EMAIL.test(fromEmail)) {
    issues.push({ path: 'from_email', code: 'invalid', message: t('emailInvalid') });
  }
  if (replyTo !== '' && !EMAIL.test(replyTo)) {
    issues.push({ path: 'reply_to', code: 'invalid', message: t('emailInvalid') });
  }
  // Prázdné publikum odmítá i `campaignAudienceSchema` v jádru, jenže jeho 422
  // dorazí s cestou `include`, kterou obrazovka nezná. Vlastní kontrola drží
  // chybu u té skupiny zaškrtávátek, kterou uživatel vidí.
  if (includeLists.length + includeSegments.length === 0) {
    issues.push({ path: 'audience', code: 'required', message: t('audienceRequired') });
  }

  if (issues.length > 0) return failed('inline', validationProblem(instance, issues));

  const body: Record<string, unknown> = {
    name,
    subject,
    preheader,
    from_name: fromName,
    template_id: optionalId(formData, 'template_id'),
    provider_id: optionalId(formData, 'provider_id'),
    sender_domain_id: optionalId(formData, 'sender_domain_id'),
    unsubscribe_list_id: optionalId(formData, 'unsubscribe_list_id'),
    reply_to: replyTo === '' ? null : replyTo,
    track_opens: formData.get('track_opens') !== null,
    track_clicks: formData.get('track_clicks') !== null,
    audience: {
      include: { lists: includeLists, segments: includeSegments },
      exclude: {
        lists: ids(formData, 'exclude_list'),
        segments: ids(formData, 'exclude_segment'),
      },
    },
  };
  // Prázdná adresa odesílatele se NEPOSÍLÁ. Schéma API ji má jako `z.email()`
  // bez nullable, takže prázdný řetězec je 422, ne „nech, jak bylo".
  if (fromEmail !== '') body['from_email'] = fromEmail;

  const result = await apiMutate<{ id: string }>(instance, {
    method: 'PATCH',
    workspaceId,
    body,
  });
  if (!result.ok) return failed('inline', result.problem);

  revalidatePath(CAMPAIGN_DETAIL_PATH, 'page');
  revalidatePath(CAMPAIGNS_PATH, 'page');
  return succeeded({ channel: 'inline', messageKey: 'settings.saved' });
}
