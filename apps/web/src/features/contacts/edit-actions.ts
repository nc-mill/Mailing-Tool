'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiMutate } from '@/lib/api-client/mutate';
import type { Problem } from '@/lib/api-client/problem';
import { failed, succeeded, type ActionState } from '@/lib/feedback/action-result';

/**
 * Server Actions pro ruční založení a úpravu jednoho kontaktu.
 *
 * Vlastní soubor, ne `actions.ts`: ten drží hromadné operace nad výběrem a mění ho
 * souběžně jiná práce. Rozdělení je i významové, hromadná akce a editace jednoho
 * záznamu mají jiná pravidla potvrzování.
 */

const CONTACTS_PATH = '/[locale]/w/[workspaceSlug]/contacts';
const CONTACT_DETAIL_PATH = `${CONTACTS_PATH}/[id]`;

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

/** Typy vlastních polí podle 4.2 části 2. Rozhoduje o převodu textu z formuláře na JSON. */
type FieldType =
  | 'text'
  | 'long_text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'enum'
  | 'multi_enum'
  | 'url'
  | 'email'
  | 'phone';

/**
 * Převod hodnoty z formuláře na tvar, který patří do `attributes`.
 *
 * Formulář posílá všechno jako text, JSONB si ale typ pamatuje. Kdyby se číslo uložilo
 * jako `"42"`, segment s podmínkou „věrnostní body > 40" by ten kontakt NENAŠEL a nikde
 * by se nic nepokazilo viditelně: pole by v detailu vypadalo správně vyplněné.
 * Proto se převádí tady, ne až v hlavě uživatele.
 *
 * Prázdná hodnota je `null`, ne prázdný řetězec. Server dělá `jsonb_strip_nulls`, takže
 * `null` klíč z atributů opravdu smaže; `""` by ho nechal jako vyplněný a prázdný.
 */
function coerceAttribute(
  raw: string,
  type: FieldType,
): string | number | boolean | string[] | null {
  const value = raw.trim();
  if (value === '') return null;

  switch (type) {
    case 'number': {
      // Čárka jako desetinný oddělovač je v českém prostředí běžnější než tečka.
      const parsed = Number(value.replace(/\s/g, '').replace(',', '.'));
      return Number.isFinite(parsed) ? parsed : value;
    }
    case 'boolean':
      return value === 'true' || value === 'on' || value === '1';
    case 'multi_enum':
      return value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    default:
      return value;
  }
}

/**
 * Pole formuláře, která popisují kontakt. Sdílí je založení i úprava, protože je to
 * tentýž formulář; liší se jen tím, že u založení je adresa povinná a měnitelná.
 */
function readContactFields(formData: FormData): {
  first_name: string | null;
  last_name: string | null;
  title_prefix: string | null;
  title_suffix: string | null;
  gender: 'female' | 'male' | 'unknown';
  attributes: Record<string, string | number | boolean | string[] | null>;
  tags: string[];
} {
  const text = (name: string): string | null => {
    const value = formData.get(name);
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  };

  const attributes: Record<string, string | number | boolean | string[] | null> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('attr:') || typeof value !== 'string') continue;
    const fieldKey = key.slice('attr:'.length);
    const type = formData.get(`attrtype:${fieldKey}`);
    attributes[fieldKey] = coerceAttribute(
      value,
      typeof type === 'string' ? (type as FieldType) : 'text',
    );
  }

  // Zaškrtnutá políčka existujících štítků plus volný text pro nové, oddělený čárkami.
  const tags = new Set<string>();
  for (const value of formData.getAll('tag')) {
    if (typeof value === 'string' && value.trim() !== '') tags.add(value.trim());
  }
  const fresh = formData.get('new_tags');
  if (typeof fresh === 'string') {
    for (const part of fresh.split(',')) {
      if (part.trim() !== '') tags.add(part.trim());
    }
  }

  const genderRaw = formData.get('gender');
  const gender = genderRaw === 'female' || genderRaw === 'male' ? genderRaw : ('unknown' as const);

  return {
    first_name: text('first_name'),
    last_name: text('last_name'),
    title_prefix: text('title_prefix'),
    title_suffix: text('title_suffix'),
    gender,
    attributes,
    tags: [...tags],
  };
}

/** Rozdíl mezi zaškrtnutými seznamy a těmi, ve kterých kontakt byl při vykreslení formuláře. */
function readListChange(formData: FormData): { subscribe: string[]; unsubscribe: string[] } {
  const wanted = new Set(
    formData.getAll('list').filter((value): value is string => typeof value === 'string'),
  );
  const before = new Set(
    formData.getAll('list_before').filter((value): value is string => typeof value === 'string'),
  );

  return {
    subscribe: [...wanted].filter((id) => !before.has(id)),
    unsubscribe: [...before].filter((id) => !wanted.has(id)),
  };
}

const IdentitySchema = z.object({
  workspace_id: z.string().min(1),
  workspace_slug: z.string().min(1),
});

/**
 * Úprava kontaktu. Jde přes PUT, ne PATCH, a to je podstatné: PATCH běží v režimu
 * `update`, kde prázdná hodnota starou NEPŘEPÍŠE, takže „smazal jsem příjmení a ono
 * tam pořád je" by bylo očekávané chování serveru. PUT znamená „takhle to má vypadat".
 *
 * Adresa se tudy NEMĚNÍ. Na to je `changeContactEmailAction`, protože změna adresy má
 * jiné následky a uživatel je musí vidět zvlášť.
 */
export async function saveContactAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const identity = IdentitySchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    workspace_slug: formData.get('workspace_slug'),
  });
  const contactId = formData.get('contact_id');
  if (!identity.success || typeof contactId !== 'string' || contactId === '') {
    return failed(
      'inlineBlock',
      validationProblem('/api/v1/contacts', [
        {
          path: '',
          code: 'invalid_value',
          message: 'Formulář přišel bez identifikátoru kontaktu.',
        },
      ]),
    );
  }

  const workspaceId = identity.data.workspace_id;
  const fields = readContactFields(formData);

  const result = await apiMutate<{ data: { id: string } }>(`/api/v1/contacts/${contactId}`, {
    method: 'PUT',
    body: fields,
    workspaceId,
  });
  if (!result.ok) return failed('inlineBlock', result.problem);

  // Přihlášení do seznamů jde vlastní cestou, ne v těle úpravy. Přihlásit kontakt
  // znamená spustit dvojí potvrzení včetně odeslaného e-mailu, což je samostatná
  // operace s vlastním auditem; kdyby se schovala do uložení formuláře, uživatel by
  // netušil, že právě někomu odešla pošta.
  const listChange = readListChange(formData);
  const email = formData.get('email');
  const listProblem = await applyListChange(workspaceId, listChange, {
    email: typeof email === 'string' ? email : '',
  });
  if (listProblem !== null) return failed('inlineBlock', listProblem);

  revalidatePath(CONTACT_DETAIL_PATH, 'page');
  revalidatePath(CONTACTS_PATH, 'page');
  redirect(`/w/${identity.data.workspace_slug}/contacts/${contactId}`);
}

/**
 * Volba správce při ručním zadání: zakládám kontakt jako přihlášeného k odběru,
 * nebo jako nepotvrzeného?
 *
 * Výchozí je přihlášený. Ruční zadání dělá správce, který adresu odněkud má, a je to
 * on, kdo za tvrzení o souhlasu ručí; my mu ho nemáme co vyvracet. Nepotvrzený zůstává
 * dostupný pro adresy, u kterých si jistý není.
 *
 * `pending` NENÍ totéž co „pošleme potvrzovací e-mail". Přihlášení se zapíše rovnou,
 * jen jako nepotvrzené; potvrzovací e-mail rozesílá samostatná akce z detailu kontaktu.
 */
export type ManualSubscription = 'confirmed' | 'pending';

function readSubscriptionChoice(formData: FormData): ManualSubscription {
  // Cokoliv jiného než výslovné `pending` je `confirmed`, včetně chybějící hodnoty:
  // výchozí stav formuláře je přihlášený a ten musí platit i tehdy, když se pole
  // z jakéhokoliv důvodu nepošle.
  return formData.get('subscription') === 'pending' ? 'pending' : 'confirmed';
}

/**
 * Ruční založení kontaktu.
 *
 * Neobchází nic, co platí pro import: `POST /contacts` volá `writeContact`, tedy všech
 * šest pravidel ze 4.1.2 části 2 včetně kontroly blokovaných adres. Zůstává v platnosti
 * i pravidlo 3: zamknutý stav (odhlášen, odraz, stížnost) tahle akce nepřepíše, ať
 * správce zvolí cokoliv.
 *
 * Co volba mění: stav kontaktu (`active` versus `unconfirmed`), stav přihlášení
 * do zaškrtnutých seznamů (`confirmed` versus `pending`) a to, jestli vznikne záznam
 * souhlasu. Trojice se posílá v JEDNOM požadavku schválně: kdyby se stav a přihlášení
 * zapisovaly zvlášť, mohl by druhý krok selhat a kontakt by zůstal v podobě, kterou
 * si nikdo nevybral.
 *
 * `on_conflict` se neposílá, takže platí výchozí `update`: když adresa v projektu už
 * je, formulář existující kontakt doplní místo toho, aby spadl na kolizi. Odpověď
 * rozlišuje 201 a 200, takže uživatel pozná rozdíl.
 */
export async function createContactAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const identity = IdentitySchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    workspace_slug: formData.get('workspace_slug'),
  });
  if (!identity.success) {
    return failed(
      'inlineBlock',
      validationProblem('/api/v1/contacts', [
        { path: '', code: 'invalid_value', message: 'Formulář přišel bez projektu.' },
      ]),
    );
  }

  const emailRaw = formData.get('email');
  const email = typeof emailRaw === 'string' ? emailRaw.trim() : '';
  if (email === '') {
    return failed(
      'inlineBlock',
      validationProblem('/api/v1/contacts', [
        { path: 'email', code: 'required_field_missing', message: 'Vyplňte e-mailovou adresu.' },
      ]),
    );
  }

  const workspaceId = identity.data.workspace_id;
  const fields = readContactFields(formData);
  const lists = formData
    .getAll('list')
    .filter((value): value is string => typeof value === 'string');
  const subscription = readSubscriptionChoice(formData);

  const result = await apiMutate<{ data: { id: string } }>('/api/v1/contacts', {
    method: 'POST',
    body: {
      ...fields,
      email,
      // Zdroj `manual` je jedna z hodnot, které dovoluje omezení `ck_contacts__source`.
      // Bez něj by kontakt vypadal, že přišel přes API, a v reportu původu by lhal.
      source: 'manual',
      // Stav kontaktu a stav přihlášení do seznamů drží tatáž volba. Rozejít je
      // by znamenalo kontakt, který je v seznamu potvrzený, ale sám je nepotvrzený,
      // tedy dvě protichůdné odpovědi na otázku „smím mu poslat e-mail?".
      status: subscription === 'confirmed' ? 'active' : 'unconfirmed',
      ...(lists.length > 0
        ? { lists: lists.map((id) => ({ list_id: id, status: subscription })) }
        : {}),
      // Souhlas se zapisuje STEJNĚ jako u importu ze souboru, ne vlastním způsobem:
      // účel `email_marketing`, právní důvod `consent` a prohlášení správce v evidenci
      // (tvar `ImportOptions.consent` z `packages/core/src/contacts/import/options.ts`).
      // Tabulka souhlasů je append only, takže tenhle zápis nic nepřepisuje, jen přidá
      // řádek do dokladové historie kontaktu.
      //
      // U nepotvrzeného se souhlas NEZAPISUJE. Správce nic netvrdí, takže by řádek
      // dokládal projev vůle, který se nestal, a smazat ho už nejde.
      ...(subscription === 'confirmed'
        ? {
            consent: [
              {
                purpose: 'email_marketing',
                status: 'granted',
                legal_basis: 'consent',
                evidence: { declaration: true },
              },
            ],
          }
        : {}),
    },
    workspaceId,
  });
  if (!result.ok) return failed('inlineBlock', result.problem);

  revalidatePath(CONTACTS_PATH, 'page');
  redirect(`/w/${identity.data.workspace_slug}/contacts/${result.data.data.id}`);
}

/**
 * Změna adresy. Samostatná trasa, protože musí přepočítat otisky adresy a ověřit, že
 * novou adresu nemá jiný živý kontakt.
 *
 * CO ZMĚNA ADRESY NEDĚLÁ (ověřeno v `repo/contacts.ts`, funkce `changeContactEmail`):
 * nemění stav kontaktu, neruší přihlášení do seznamů ani zaznamenané souhlasy.
 * Kontakt tedy zůstane potvrzený i na adrese, kterou nikdo nepotvrdil. Formulář to
 * musí říct nahlas, protože je to jediné místo, kde se to dá poznat.
 */
export async function changeContactEmailAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const identity = IdentitySchema.safeParse({
    workspace_id: formData.get('workspace_id'),
    workspace_slug: formData.get('workspace_slug'),
  });
  const contactId = formData.get('contact_id');
  const emailRaw = formData.get('email');
  const email = typeof emailRaw === 'string' ? emailRaw.trim() : '';

  if (!identity.success || typeof contactId !== 'string' || contactId === '') {
    return failed(
      'inlineBlock',
      validationProblem('/api/v1/contacts', [
        {
          path: '',
          code: 'invalid_value',
          message: 'Formulář přišel bez identifikátoru kontaktu.',
        },
      ]),
    );
  }
  if (email === '') {
    return failed(
      'inlineBlock',
      validationProblem(`/api/v1/contacts/${contactId}/change-email`, [
        { path: 'email', code: 'required_field_missing', message: 'Vyplňte novou adresu.' },
      ]),
    );
  }

  const result = await apiMutate<void>(`/api/v1/contacts/${contactId}/change-email`, {
    method: 'POST',
    body: { email },
    workspaceId: identity.data.workspace_id,
  });
  if (!result.ok) return failed('inlineBlock', result.problem);

  revalidatePath(CONTACT_DETAIL_PATH, 'page');
  return succeeded({ channel: 'inlineBlock', messageKey: 'form.emailChanged' });
}

export type ContactActionResult = { status: 'success' } | { status: 'error'; code: string };

/**
 * Přihlášení a odhlášení ze seznamů podle rozdílu proti stavu při vykreslení formuláře.
 *
 * Vrací první problém, ne souhrn: kdyby se hlásily všechny, uživatel by u kontaktu
 * v deseti seznamech dostal deset hlášek, ze kterých by stejně opravoval první.
 */
async function applyListChange(
  workspaceId: string,
  change: { subscribe: string[]; unsubscribe: string[] },
  contact: { email: string },
): Promise<Problem | null> {
  for (const listId of change.subscribe) {
    const result = await apiMutate<unknown>(`/api/v1/lists/${listId}/subscribe`, {
      method: 'POST',
      body: {
        email: contact.email,
        // Potvrzení se NEPŘESKAKUJE. `skip_confirmation` vyžaduje prohlášení
        // o doloženém souhlasu a tohle je zaškrtnutí políčka správcem, ne doklad.
        // Kontakt dostane potvrzovací e-mail a přihlásí se, až na něj klikne.
        skip_confirmation: false,
        declaration: false,
      },
      workspaceId,
    });
    if (!result.ok) return result.problem;
  }

  for (const listId of change.unsubscribe) {
    const result = await apiMutate<unknown>(`/api/v1/lists/${listId}/subscribe`, {
      method: 'DELETE',
      body: { email: contact.email },
      workspaceId,
    });
    if (!result.ok) return result.problem;
  }

  return null;
}

/**
 * Opakované odeslání potvrzovacího e-mailu. Server hlídá limit tří odeslání za 24 hodin
 * a při jeho překročení vrací 200 s `outcome: 'resend_throttled'`, ne chybu. Rozhraní
 * proto musí číst `outcome`, ne jen stavový kód, jinak by uživateli tvrdilo, že e-mail
 * odešel, i když ho limit zastavil.
 */
export async function resendConfirmationAction(input: {
  workspaceId: string;
  listId: string;
  contactId: string;
}): Promise<ContactActionResult> {
  const result = await apiMutate<{ outcome: string }>(
    `/api/v1/lists/${input.listId}/resend-confirmation`,
    { method: 'POST', body: { contact_id: input.contactId }, workspaceId: input.workspaceId },
  );
  if (!result.ok) return { status: 'error', code: result.problem.code };
  // Jediný výsledek, po kterém opravdu odešel e-mail. `resend_throttled`,
  // `already_confirmed` i `blocked_*` vracejí 200 a znamenají, že se nic neodeslalo;
  // kód se vrací volajícímu, aby uměl říct co a proč.
  if (result.data.outcome !== 'confirmation_sent') {
    return { status: 'error', code: result.data.outcome };
  }
  revalidatePath(CONTACT_DETAIL_PATH, 'page');
  return { status: 'success' };
}

/**
 * Zrušení pozastavení odběru ve všech seznamech kontaktu.
 *
 * `workspaceId` je u všech tří akcí tohohle souboru POVINNÝ, ne pohodlí. `apiMutate`
 * z něj skládá hlavičku `X-Workspace-Id` a bez ní běží požadavek mimo kontext projektu:
 * autentizace projde, řádek se nenajde a rozhraní dostane 404 na kontakt, který
 * evidentně existuje. Naměřeno v prohlížeči, viz i táž poznámka v `features/sending/actions.ts`.
 */
export async function cancelSnoozeAction(input: {
  workspaceId: string;
  id: string;
}): Promise<ContactActionResult> {
  const result = await apiMutate<{ cleared: number }>(
    `/api/v1/contacts/${input.id}/cancel-snooze`,
    { method: 'POST', body: {}, workspaceId: input.workspaceId },
  );
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(CONTACT_DETAIL_PATH, 'page');
  return { status: 'success' };
}

export type GreetingPreview = {
  greeting: string;
  vocative_confidence: 'high' | 'low' | 'none';
  gender: 'female' | 'male' | 'unknown';
};

/**
 * Náhled oslovení pro formulář. Počítá ho server, ne prohlížeč: skloňování stojí na
 * slovníku, na přepisech projektu a na nastavení vykání, a nic z toho v prohlížeči není.
 *
 * Když náhled selže, vrací `null` a formulář náhled prostě neukáže. Rozbité skloňování
 * nesmí zabránit uložení jména.
 */
export async function previewGreetingAction(input: {
  workspaceId: string;
  first_name: string | null;
  last_name: string | null;
  title_prefix: string | null;
  gender: 'female' | 'male' | 'unknown';
}): Promise<GreetingPreview | null> {
  const result = await apiMutate<{ data: GreetingPreview }>('/api/v1/name-preview', {
    method: 'POST',
    body: {
      first_name: input.first_name,
      last_name: input.last_name,
      title_prefix: input.title_prefix,
      gender: input.gender,
    },
    workspaceId: input.workspaceId,
  });
  return result.ok ? result.data.data : null;
}
