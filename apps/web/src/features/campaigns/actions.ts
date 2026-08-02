'use server';

import { revalidatePath } from 'next/cache';
import { apiMutate } from '@/lib/api-client/mutate';

export type ActionResult = { status: 'success' } | { status: 'error'; code: string };

const CAMPAIGNS_PATH = '/[locale]/w/[workspaceSlug]/campaigns';

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
