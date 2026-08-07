'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiMutate } from '@/lib/api-client/mutate';
import type { Problem } from '@/lib/api-client/problem';
import { failed, succeeded, type ActionState } from '@/lib/feedback/action-result';

function validationProblem(
  instance: string,
  issues: Array<{ path: string; code: string; message: string }>,
): Problem {
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

/**
 * Cesta SOUBORU stránky, ne adresa v prohlížeči.
 *
 * `revalidatePath('/w/eshop-kolo/settings/general')` nedělalo nic ze dvou
 * důvodů najednou. Za prvé next-intl adresu bez jazykového prefixu PŘEPISUJE
 * na `/cs/w/…`, takže záznam v cache leží pod jinou cestou, než jakou akce
 * uváděla (dokumentace `revalidatePath`: u přepisu se uvádí cílová cesta,
 * ne ta, kterou vidí prohlížeč). Za druhé cesta s dynamickými segmenty
 * potřebuje druhý argument `'page'`; bez něj Next volání jen odloží s
 * varováním do konzole serveru a neudělá nic.
 *
 * Následek byl přesně ten, kvůli kterému přišlo hlášení „tlačítko nic
 * nedělá": změna se do databáze uložila, ale serverová stránka se
 * nepřekreslila, takže přepínač zůstal na staré hodnotě. Tvar
 * `'/[locale]/w/[workspaceSlug]/…'` s `'page'` používá zbytek aplikace,
 * viz `features/contacts/actions.ts`.
 */
const GENERAL_PAGE_PATH = '/[locale]/w/[workspaceSlug]/settings/general';

const GeneralSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  locale: z.string().min(2),
  timezone: z.string().min(1),
  /**
   * Poštovní adresa odesílatele. Prázdná je v pořádku: projekt, který teprve
   * zkouší, nemá být kvůli ní zastavený. Že chybí, řekne kontrolní seznam
   * před odesláním kampaně.
   */
  postal_address: z.string().trim().max(500),
});

export async function updateWorkspaceAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = GeneralSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    name: formData.get('name'),
    slug: formData.get('slug'),
    locale: formData.get('locale'),
    timezone: formData.get('timezone'),
    // `?? ''` drží zpětnou kompatibilitu formuláře bez tohohle pole: chybějící
    // hodnota by jinak spadla na validaci a uložení by přestalo fungovat celé.
    postal_address: formData.get('postal_address') ?? '',
  });

  if (!parsed.success) {
    return failed(
      'inline',
      validationProblem(
        '/api/v1/workspaces',
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      ),
    );
  }

  const { workspace_id: workspaceId, ...body } = parsed.data;
  /**
   * OPRAVA VADY „uložení skočí na /w/undefined/settings/general".
   *
   * Typový parametr tu dřív zněl `{ slug: string }`, jenže to bylo TVRZENÍ,
   * ne kontrola: `readResponse` vrací tělo odpovědi tak, jak přišlo, a nic
   * nerozbaluje. `PATCH /api/v1/workspaces/{id}` přitom vrací projekt
   * ZABALENÝ do `{ workspace: … }` (viz `c.json({ workspace }, 200)`
   * v `packages/core/src/identity/api/workspaces.routes.ts` a schéma
   * odpovědi 200 v `packages/contracts/openapi.json`). `result.data.slug`
   * byl proto vždycky `undefined`, podmínka „slug se změnil" platila při
   * KAŽDÉM uložení a uživatel skončil na `/w/undefined/settings/general`,
   * tedy na 404, i když adresu vůbec neměnil.
   *
   * Stejné rozbalení už jednou opravoval `lib/identity/workspace-access.ts`.
   */
  const result = await apiMutate<{ workspace: { slug: string } }>(
    `/api/v1/workspaces/${workspaceId}`,
    { method: 'PATCH', body, workspaceId },
  );
  if (!result.ok) return failed('inline', result.problem);

  // Překreslení patří PŘED `redirect()`: ten vyhazuje výjimku, takže cokoli
  // za ním se u změněné adresy nikdy neprovede.
  revalidatePath(GENERAL_PAGE_PATH, 'page');

  // Slug je součástí cesty, takže po jeho změně musí uživatel skončit na nové
  // adrese. Podmínka `nextSlug` je pojistka: na prázdnou hodnotu se
  // nepřesměrovává nikdy, přesně tak vznikla adresa /w/undefined/…
  const nextSlug = result.data.workspace.slug;
  if (nextSlug && nextSlug !== formData.get('current_slug')) {
    redirect(`/w/${nextSlug}/settings/general`);
  }

  return succeeded({ channel: 'inline', messageKey: 'shared.saved' });
}

const AddressFormSchema = z.object({
  workspace_id: z.string().min(1),
  address_form: z.enum(['formal', 'informal']),
});

export async function updateAddressFormAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = AddressFormSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    address_form: formData.get('address_form'),
  });
  if (!parsed.success) {
    return failed(
      'page',
      validationProblem('/api/v1/workspaces', [
        { path: 'address_form', code: 'invalid', message: 'Vyberte vykání, nebo tykání.' },
      ]),
    );
  }

  const { workspace_id: workspaceId, address_form: addressForm } = parsed.data;
  const result = await apiMutate<void>(`/api/v1/workspaces/${workspaceId}`, {
    method: 'PATCH',
    body: { address_form: addressForm },
    workspaceId,
  });
  if (!result.ok) return failed('page', result.problem);

  revalidatePath(GENERAL_PAGE_PATH, 'page');
  return succeeded({ channel: 'page', messageKey: 'general.addressForm.started' });
}

const GreetingEnabledSchema = z.object({
  workspace_id: z.string().min(1),
  greeting_enabled: z.enum(['true', 'false']),
});

/**
 * VYPÍNAČ OSLOVENÍ A 5. PÁDU.
 *
 * Nezařazuje žádný přepočet a nemaže žádná data. Sloupce `contacts.greeting`,
 * `first_name_vocative` i `vocative_locked` se počítají dál při každém zápisu
 * kontaktu, takže zapnutí zpátky vrátí přesně to, co tam bylo, a šablona,
 * ve které `{{ contact.greeting }}` už stojí, posílá správnou větu i s vypnutou
 * volbou.
 *
 * Překresluje se `layout`, ne `page`: přepínač řídí i položku „Kontrola oslovení"
 * v hlavní navigaci, a ta se vykresluje v layoutu projektu. Bez toho by v menu
 * zůstala viset cesta na obrazovku, která už nic nevrací.
 */
export async function updateGreetingEnabledAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = GreetingEnabledSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    greeting_enabled: formData.get('greeting_enabled'),
  });
  if (!parsed.success) {
    return failed(
      'page',
      validationProblem('/api/v1/workspaces', [
        { path: 'greeting_enabled', code: 'invalid', message: 'Chybí hodnota přepínače.' },
      ]),
    );
  }

  const { workspace_id: workspaceId } = parsed.data;
  const enabled = parsed.data.greeting_enabled === 'true';
  const result = await apiMutate<void>(`/api/v1/workspaces/${workspaceId}`, {
    method: 'PATCH',
    body: { greeting_enabled: enabled },
    workspaceId,
  });
  if (!result.ok) return failed('page', result.problem);

  revalidatePath('/[locale]/w/[workspaceSlug]', 'layout');
  return succeeded({
    channel: 'page',
    messageKey: enabled ? 'general.greetingEnabled.turnedOn' : 'general.greetingEnabled.turnedOff',
  });
}

const GreetingLocaleSchema = z.object({ workspace_id: z.string().min(1) });

/**
 * HROMADNÉ SJEDNOCENÍ JAZYKA OSLOVENÍ.
 *
 * Zápis dělá API (`POST /api/v1/greeting-locale:align`), ne tahle akce: přepočet
 * sahá na jazyk, 5. pád i hotovou větu u každého kontaktu projektu, takže jde přes
 * frontu a odpovídá 202. Vlastní SQL by znamenalo druhou implementaci pravidel
 * oslovení a obešlo by zámek ručně potvrzených tvarů i audit.
 *
 * Hlásí se „přepočítáváme", ne „přepočítáno": job běží na pozadí a lhát o rychlosti
 * u operace nad desítkami tisíc řádků nemá smysl.
 */
export async function alignGreetingLocaleAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = GreetingLocaleSchema.safeParse({ workspace_id: formData.get('workspace_id') });
  if (!parsed.success) {
    return failed(
      'page',
      validationProblem('/api/v1/greeting-locale:align', [
        { path: 'workspace_id', code: 'required', message: 'Chybí identifikátor projektu.' },
      ]),
    );
  }

  const workspaceId = parsed.data.workspace_id;
  const result = await apiMutate<{ mode: 'queued' }>('/api/v1/greeting-locale:align', {
    method: 'POST',
    body: {},
    workspaceId,
  });
  if (!result.ok) return failed('page', result.problem);

  revalidatePath(GENERAL_PAGE_PATH, 'page');
  return succeeded({ channel: 'page', messageKey: 'general.greetingLocale.started' });
}

const DeleteSchema = z.object({
  workspace_id: z.string().min(1),
  confirm_name: z.string().min(1),
});

export async function deleteWorkspaceAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = DeleteSchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    confirm_name: formData.get('confirm_name'),
  });
  if (!parsed.success) {
    return failed(
      'page',
      validationProblem('/api/v1/workspaces', [
        { path: 'confirm_name', code: 'required', message: 'Opište název projektu.' },
      ]),
    );
  }

  const { workspace_id: workspaceId, confirm_name: confirmName } = parsed.data;
  const result = await apiMutate<void>(`/api/v1/workspaces/${workspaceId}`, {
    method: 'DELETE',
    body: { confirm_name: confirmName },
    workspaceId,
  });
  if (!result.ok) return failed('page', result.problem);

  redirect('/no-workspace');
}
