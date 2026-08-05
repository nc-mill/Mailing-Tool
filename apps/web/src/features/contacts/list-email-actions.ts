'use server';

import { revalidatePath } from 'next/cache';
import { defaultSubscriptionEmail, type SubscriptionEmailKind } from '@mlain/core/contacts';
import { apiMutate } from '@/lib/api-client/mutate';

/**
 * Nastavení tří e-mailů seznamu: potvrzení přihlášení, uvítání, rozloučení.
 *
 * VLASTNÍ ZNĚNÍ ZAKLÁDÁ ŠABLONU, ne pole s předmětem a textem. Rozhodnutí
 * zadavatele z 5. 8. 2026. Vzorem je `features/forms/actions.ts`, kde tlačítko
 * „Vytvořit e-mail" založí šablonu a rovnou ji naváže: druhý vzorec pro tutéž
 * věc by byl matoucí a znamenal by druhý editor, druhou validaci a druhou cestu
 * k merge tagům.
 *
 * `NULL` u šablony NENÍ chybějící hodnota, ale „použije se obecné znění", tedy
 * konstanta typu `Document` v `packages/core/src/contacts/lists/default-emails.ts`.
 * Nová šablona se z ní PŘEDVYPLNÍ, takže uživatel začíná na tom, co by mu jinak
 * odešlo, a ne na prázdné stránce.
 */

const LISTS_PATH = '/[locale]/w/[workspaceSlug]/lists';

export type ListEmailResult =
  { status: 'success'; templateId?: string } | { status: 'error'; code: string; detail: string };

/** Sloupec na seznamu podle druhu e-mailu. Tvar drží `PatchListSchema`. */
const TEMPLATE_FIELD: Record<SubscriptionEmailKind, string> = {
  confirmation: 'confirmation_template_id',
  welcome: 'welcome_template_id',
  goodbye: 'goodbye_template_id',
};

function done(templateId?: string): ListEmailResult {
  revalidatePath(`${LISTS_PATH}/[id]`, 'page');
  revalidatePath(LISTS_PATH, 'page');
  return templateId === undefined ? { status: 'success' } : { status: 'success', templateId };
}

/**
 * Založení vlastního znění a jeho rovnou navázání.
 *
 * JEDNA AKCE, ne dvě, ze stejného důvodu jako u formulářů: uživatel klikne
 * „Napsat vlastní" a čeká, že bude hotovo. Kdyby se šablona jen založila,
 * skončil by v editoru s e-mailem, který seznam neposílá, a nikde by se to
 * nedozvěděl.
 *
 * `kind: 'transactional'`, ne `'campaign'`. E-maily seznamu odcházejí
 * s `messages.kind = 'transactional'` a jen ten profil povoluje v Liquidu kořen
 * `data`, bez kterého by do potvrzovacího e-mailu nešel dosadit odkaz.
 */
export async function createListEmailTemplateAction(input: {
  workspaceId: string;
  listId: string;
  listName: string;
  kind: SubscriptionEmailKind;
  /** Jazyk projektu. Rozhoduje, ve které řeči bude předvyplněné znění. */
  language: 'cs' | 'en';
}): Promise<ListEmailResult> {
  const document = defaultSubscriptionEmail(input.kind, input.language);
  const name = `${document.meta.name} · ${input.listName}`.slice(0, 120);

  const created = await apiMutate<{ id: string }>('/api/v1/templates', {
    method: 'POST',
    workspaceId: input.workspaceId,
    body: { name, kind: 'transactional', document },
  });
  if (!created.ok) {
    return { status: 'error', code: created.problem.code, detail: created.problem.detail };
  }

  const linked = await apiMutate<unknown>(`/api/v1/lists/${input.listId}`, {
    method: 'PATCH',
    workspaceId: input.workspaceId,
    body: { [TEMPLATE_FIELD[input.kind]]: created.data.id },
  });
  if (!linked.ok) {
    return { status: 'error', code: linked.problem.code, detail: linked.problem.detail };
  }

  // Vrací se identifikátor ŠABLONY, ne seznamu: volající s ním rovnou otevírá editor.
  return done(created.data.id);
}

/**
 * Odpojení vlastního znění. Šablona se NEMAŽE, jen se přestane používat:
 * je to obsah, který někdo psal, a mohl si ho připojit i jiný seznam.
 */
export async function detachListEmailTemplateAction(input: {
  workspaceId: string;
  listId: string;
  kind: SubscriptionEmailKind;
}): Promise<ListEmailResult> {
  const result = await apiMutate<unknown>(`/api/v1/lists/${input.listId}`, {
    method: 'PATCH',
    workspaceId: input.workspaceId,
    body: { [TEMPLATE_FIELD[input.kind]]: null },
  });
  if (!result.ok) {
    return { status: 'error', code: result.problem.code, detail: result.problem.detail };
  }
  return done();
}

/**
 * Přepínače „posílat uvítání" a „posílat rozloučení".
 *
 * Potvrzovací e-mail vlastní přepínač NEMÁ a mít nesmí: na seznamu s dvojím
 * potvrzením je to jediná cesta, jak přihlášení dokončit, takže vypnout ho
 * znamená rozbít seznam. Kdo ho nechce, přepne seznam na jeden krok.
 */
export async function setListEmailEnabledAction(input: {
  workspaceId: string;
  listId: string;
  kind: 'welcome' | 'goodbye';
  enabled: boolean;
}): Promise<ListEmailResult> {
  const field = input.kind === 'welcome' ? 'send_welcome' : 'send_goodbye';
  const result = await apiMutate<unknown>(`/api/v1/lists/${input.listId}`, {
    method: 'PATCH',
    workspaceId: input.workspaceId,
    body: { [field]: input.enabled },
  });
  if (!result.ok) {
    return { status: 'error', code: result.problem.code, detail: result.problem.detail };
  }
  return done();
}

/**
 * Přehození výchozího seznamu projektu.
 *
 * ENDPOINT `POST /lists/{id}/default` EXISTOVAL OD ZAČÁTKU A NIKDO HO NEVOLAL,
 * stejně jako `getDefault()` v repozitáři. Bez téhle akce se výchozí seznam
 * nedal změnit odnikud, takže ten, který projekt dostane při založení nebo
 * dosypáním migrací 0018, by byl navždy.
 *
 * `is_default` řídí, co je předem zaškrtnuté při ručním přidání kontaktu a co
 * je předvybrané v průvodci importem. Není to jen ozdoba: přehodit ho na
 * seznam, který znamená nárok, znamená, že se do něj lidé začnou přidávat
 * jedním kliknutím. Proto je to vědomé rozhodnutí na obrazovce seznamu,
 * ne něco, co by produkt měnil sám.
 */
export async function setDefaultListAction(input: {
  workspaceId: string;
  listId: string;
}): Promise<ListEmailResult> {
  const result = await apiMutate<unknown>(`/api/v1/lists/${input.listId}/default`, {
    method: 'POST',
    workspaceId: input.workspaceId,
  });
  if (!result.ok) {
    return { status: 'error', code: result.problem.code, detail: result.problem.detail };
  }
  return done();
}

/**
 * Kam poslat člověka po potvrzení přihlášení a po odhlášení ze seznamu.
 *
 * Prázdné pole se posílá jako `null`, ne jako prázdný řetězec: „nevyplněno"
 * a „prázdná adresa" jsou dvě různé věci a omezení
 * `ck_lists__confirm_redirect_url_len` prázdný řetězec zakazuje.
 *
 * `null` znamená „zůstane naše stránka", což je pro většinu projektů správně:
 * naše stránka říká, co se právě stalo, a nabídne opravu, kdyby to bylo omylem.
 */
export async function saveListRedirectsAction(input: {
  workspaceId: string;
  listId: string;
  confirmRedirectUrl: string;
  unsubscribeRedirectUrl: string;
}): Promise<ListEmailResult> {
  const result = await apiMutate<unknown>(`/api/v1/lists/${input.listId}`, {
    method: 'PATCH',
    workspaceId: input.workspaceId,
    body: {
      confirm_redirect_url:
        input.confirmRedirectUrl.trim() === '' ? null : input.confirmRedirectUrl.trim(),
      unsubscribe_redirect_url:
        input.unsubscribeRedirectUrl.trim() === '' ? null : input.unsubscribeRedirectUrl.trim(),
    },
  });
  if (!result.ok) {
    return { status: 'error', code: result.problem.code, detail: result.problem.detail };
  }
  return done();
}

/**
 * Základní údaje seznamu: jméno, popis, platnost potvrzovacího odkazu a strop
 * opakovaných odeslání.
 *
 * Platnost a strop tu nejsou pro parádu. Potvrzovací odkaz s krátkou platností
 * je nejčastější důvod, proč lidem přihlášení „nejde", a strop tří odeslání za
 * 24 hodin je ochrana cizí schránky před tím, aby se z formuláře dal poslat
 * e-mail komukoli opakovaně.
 */
export async function saveListBasicsAction(input: {
  workspaceId: string;
  listId: string;
  name: string;
  description: string;
  confirmationTtlHours: number;
  confirmationMaxResends: number;
}): Promise<ListEmailResult> {
  const result = await apiMutate<unknown>(`/api/v1/lists/${input.listId}`, {
    method: 'PATCH',
    workspaceId: input.workspaceId,
    body: {
      name: input.name.trim(),
      // Prázdný popis je „nevyplněno", ne prázdný text.
      description: input.description.trim() === '' ? null : input.description.trim(),
      confirmation_ttl_hours: input.confirmationTtlHours,
      confirmation_max_resends: input.confirmationMaxResends,
    },
  });
  if (!result.ok) {
    return { status: 'error', code: result.problem.code, detail: result.problem.detail };
  }
  return done();
}
