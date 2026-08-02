'use server';

import { revalidatePath } from 'next/cache';
import { apiMutate } from '@/lib/api-client/mutate';
import type { GuardSettings } from './guard-thresholds';

export type ActionResult = { status: 'success' } | { status: 'error'; code: string };

const SENDING_PATH = '/[locale]/w/[workspaceSlug]/settings/sending';
const DOMAIN_PATH = '/[locale]/w/[workspaceSlug]/settings/sending/domains/[id]';

/**
 * `workspaceId` je povinný parametr každé akce: bez hlavičky `X-Workspace-Id`
 * běží požadavek mimo kontext projektu a API vrací 404. Ověřeno spuštěním.
 *
 * Uložení brzd doručitelnosti. Server přijme jen přísnější hodnotu než instalační
 * strop a jinak vrací 422 `validation_failed`. Formulář tutéž mez hlídá i v prohlížeči,
 * ale rozhoduje server: kontrola v prohlížeči je pohodlí, ne ochrana.
 */
export async function saveGuardsAction(input: {
  workspaceId: string;
  settings: GuardSettings;
}): Promise<ActionResult> {
  const result = await apiMutate<unknown>('/api/v1/settings/deliverability', {
    method: 'PATCH',
    workspaceId: input.workspaceId,
    body: input.settings,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(SENDING_PATH, 'page');
  return { status: 'success' };
}

/** Kontrola DNS na jedno kliknutí. Rychlejší opakování než jednou za 30 s vrací 429. */
export async function checkDomainAction(input: {
  workspaceId: string;
  domainId: string;
}): Promise<ActionResult> {
  // Prázdné tělo `{}`: bez něj `apiMutate` neposílá `Content-Type` a kostra API
  // odpoví 415. Týž důvod jako u ovládacích akcí kampaně.
  const result = await apiMutate<unknown>(`/api/v1/domains/${input.domainId}/check`, {
    method: 'POST',
    workspaceId: input.workspaceId,
    body: {},
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(DOMAIN_PATH, 'page');
  revalidatePath(SENDING_PATH, 'page');
  return { status: 'success' };
}

/**
 * Vstup zakládání odesílacího účtu. Tvar je opsaný z `CreateSendingProviderRequest`
 * v `packages/contracts/openapi.json`, tedy rozlišená sjednocení podle `type`.
 *
 * ODCHYLKA OD PLÁNU P13: plán počítal se samostatnou stránkou
 * `settings/sending/new/page.tsx` (kapitola 6, strom souborů). Zakládání je
 * ale krátký formulář bez vlastní adresy, ke které by se uživatel vracel,
 * takže je v dialogu na téže obrazovce. Serverová akce je stejná v obou
 * případech, mění se jen to, co ji zavolá.
 *
 * ODCHYLKA OD KONTRAKTU, vynucená skutečným API: `configuration_set_name`
 * je v `openapi.json` u SES uvedená mezi vlastnostmi, ale ne mezi `required`,
 * a Hono ji má `.optional()`. Když se nepošle, doplní ji server jako
 * `mlain-<prvních 8 znaků workspace id>`. Dialog ji proto nabízí jako
 * nepovinnou a prázdnou hodnotu vůbec neposílá, ne jako prázdný řetězec:
 * ten by v `providerConfigSchema` neprošel na `min(1)`.
 */
export type CreateProviderInput =
  | {
      type: 'ses';
      name: string;
      region: string;
      access_key_id: string;
      secret_access_key: string;
      configuration_set_name?: string;
      is_default?: boolean;
    }
  | {
      type: 'smtp';
      name: string;
      host: string;
      port: number;
      username: string;
      password: string;
      encryption: 'starttls' | 'tls' | 'none';
      is_default?: boolean;
    };

export type CreateProviderResult =
  { status: 'success'; providerId: string } | { status: 'error'; code: string; detail: string };

/**
 * Založení odesílacího účtu. Tajemství (`secret_access_key`, `password`) jde
 * přes serverovou akci, tedy nikdy z prohlížeče přímo na API: `apiMutate`
 * doplní hlavičku `X-Workspace-Id`, CSRF token a origin. Volání ze `fetch`
 * v prohlížeči by bez `X-Workspace-Id` skončilo na 404.
 */
export async function createProviderAction(input: {
  workspaceId: string;
  provider: CreateProviderInput;
}): Promise<CreateProviderResult> {
  const result = await apiMutate<{ id: string }>('/api/v1/providers', {
    method: 'POST',
    workspaceId: input.workspaceId,
    body: input.provider,
  });
  if (!result.ok) {
    return { status: 'error', code: result.problem.code, detail: result.problem.detail };
  }
  revalidatePath(SENDING_PATH, 'page');
  return { status: 'success', providerId: result.data.id };
}

/** Test připojení odesílacího účtu. Nemění stav účtu, jen ho ověří na místě. */
export async function testProviderAction(input: {
  workspaceId: string;
  providerId: string;
}): Promise<{ status: 'success'; detail: string } | { status: 'error'; code: string }> {
  const result = await apiMutate<{ ok: true; detail: string }>(
    `/api/v1/providers/${input.providerId}/test`,
    {
      method: 'POST',
      workspaceId: input.workspaceId,
      body: {},
    },
  );
  if (!result.ok) return { status: 'error', code: result.problem.code };
  return { status: 'success', detail: result.data.detail };
}

/** Nastavení výchozího odesílacího účtu. Nový výchozí okamžitě nahradí předchozí. */
export async function setDefaultProviderAction(input: {
  workspaceId: string;
  providerId: string;
}): Promise<ActionResult> {
  const result = await apiMutate<unknown>(`/api/v1/providers/${input.providerId}/default`, {
    method: 'POST',
    workspaceId: input.workspaceId,
    body: {},
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(SENDING_PATH, 'page');
  return { status: 'success' };
}
