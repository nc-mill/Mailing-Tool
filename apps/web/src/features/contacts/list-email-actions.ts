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
 * Kroky, u kterých seznam rozhoduje, co návštěvník uvidí. Jsou to povrchy
 * z oddílu 3 plánu `2026-08-07-designovatelne-verejne-stranky.md`.
 *
 * Děkovací stránka formuláře tu SCHVÁLNĚ NENÍ: chodí se na ni bez tokenu hned
 * po odeslání, takže se v tu chvíli neví, o který seznam jde, a vlastní ji
 * výhradně formulář.
 */
export type ListPageSurface = 'confirmed' | 'already_subscribed' | 'unsubscribed';

/** Návrh stránky podle kroku. Sloupce přibyly migrací 0029. */
const PAGE_TEMPLATE_FIELD: Record<ListPageSurface, string> = {
  confirmed: 'confirmed_template_id',
  already_subscribed: 'already_subscribed_template_id',
  unsubscribed: 'unsubscribed_template_id',
};

/** Přesměrování téhož kroku. Sloupce existují od začátku, jen se jinak jmenují. */
const PAGE_REDIRECT_FIELD: Record<ListPageSurface, string> = {
  confirmed: 'confirm_redirect_url',
  already_subscribed: 'already_subscribed_redirect_url',
  unsubscribed: 'unsubscribe_redirect_url',
};

/**
 * Co uvidí návštěvník po jednom kroku: vestavěný text, vlastní stránka, nebo
 * přesměrování na cizí web.
 *
 * UKLÁDÁ SE CELÁ TROJICE NARÁZ, ne jen zvolená polovina. Vlastní stránka
 * a přesměrování si odporují: kdyby v datech zůstalo obojí, veřejná trasa pošle
 * 303 na cizí web a navržená stránka se nikdy nevykreslí. Proto zápis vždycky
 * vynuluje tu druhou možnost, i když se jí uživatel netkl.
 *
 * Prázdná adresa se posílá jako `null`, ne jako prázdný řetězec: „nevyplněno"
 * a „prázdná adresa" jsou dvě různé věci a `ck_lists__confirm_redirect_url_len`
 * prázdný řetězec zakazuje.
 */
export async function saveListPageChoiceAction(input: {
  workspaceId: string;
  listId: string;
  surface: ListPageSurface;
  templateId: string | null;
  redirectUrl: string | null;
}): Promise<ListEmailResult> {
  const url = input.redirectUrl?.trim() ?? '';
  const result = await apiMutate<unknown>(`/api/v1/lists/${input.listId}`, {
    method: 'PATCH',
    workspaceId: input.workspaceId,
    body: {
      [PAGE_TEMPLATE_FIELD[input.surface]]: input.templateId,
      [PAGE_REDIRECT_FIELD[input.surface]]: url === '' ? null : url,
    },
  });
  if (!result.ok) {
    return { status: 'error', code: result.problem.code, detail: result.problem.detail };
  }
  return done();
}

/**
 * Založení veřejné stránky k seznamu a její rovnou navázání.
 *
 * JEDNA AKCE, ne dvě, ze stejného důvodu jako u e-mailů seznamu a u formuláře.
 * `kind: 'page'` má vlastní validační profil: zakazuje blok syrového HTML
 * (stránka běží na NAŠÍ doméně) i patičku s odhlašovacím odkazem.
 *
 * Zápis rovnou nuluje přesměrování téhož kroku, viz `saveListPageChoiceAction`.
 */
export async function createListPageAction(input: {
  workspaceId: string;
  listId: string;
  surface: ListPageSurface;
  name: string;
  document: unknown;
}): Promise<ListEmailResult> {
  const created = await apiMutate<{ id: string }>('/api/v1/templates', {
    method: 'POST',
    workspaceId: input.workspaceId,
    body: { name: input.name, kind: 'page', document: input.document },
  });
  if (!created.ok) {
    return { status: 'error', code: created.problem.code, detail: created.problem.detail };
  }

  const linked = await apiMutate<unknown>(`/api/v1/lists/${input.listId}`, {
    method: 'PATCH',
    workspaceId: input.workspaceId,
    body: {
      [PAGE_TEMPLATE_FIELD[input.surface]]: created.data.id,
      [PAGE_REDIRECT_FIELD[input.surface]]: null,
    },
  });
  if (!linked.ok) {
    return { status: 'error', code: linked.problem.code, detail: linked.problem.detail };
  }

  // Vrací se identifikátor ŠABLONY, ne seznamu: volající s ním rovnou otevírá editor.
  return done(created.data.id);
}

/**
 * Rozsah odhlášení ze seznamu.
 *
 * NENÍ TO JEN ROZSAH. `global` znamená, že kliknutí na odhlašovací odkaz navíc
 * zablokuje adresu pro CELÝ projekt (`suppressions`), takže se z ní nikdy nic
 * nepošle, ani z jiného seznamu, ani transakčně. Proto je to vlastní akce
 * s vlastní odezvou a proto to rozhraní u té volby říká doslova.
 */
export async function saveListUnsubscribeScopeAction(input: {
  workspaceId: string;
  listId: string;
  unsubscribeScope: 'list' | 'global';
}): Promise<ListEmailResult> {
  const result = await apiMutate<unknown>(`/api/v1/lists/${input.listId}`, {
    method: 'PATCH',
    workspaceId: input.workspaceId,
    body: { unsubscribe_scope: input.unsubscribeScope },
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
