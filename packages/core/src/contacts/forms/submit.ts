import { keyringFromEnv, type Keyring } from '@mlain/contracts/keyring';
import { loadConfig } from '../../config';
import { withWorkspace } from '../../tx';
import { buildConsentEvidence, consentTextEvidence } from '../consents/evidence';
import { normalizeEmail } from '../email';
import { coerceValue, type FieldDefinition } from '../fields/coerce';
import { subscribeToList } from '../lists/subscribe-service';
import { storeIpEnabled } from '../privacy';
import { listContactFields } from '../repo/contact-fields';
import { recordConsent } from '../repo/consents';
import { assertActiveForm, publicFormRef, recordSubmission, type PublicForm } from '../repo/forms';
import { byId as listById } from '../repo/lists';
import { writeContact } from '../repo/contacts';
import { checkSingleSuppression } from '../repo/suppressions';
import { ALREADY_SUBSCRIBED_QUERY } from '../public/page-render';
import { resolvePageTemplateId } from '../public/page-template';
import { addTagsToContact } from '../repo/tags';
import { readContactsSettings } from '../settings';
import { formFieldName } from './definition';
import { sendFormDeliveryEmail } from './delivery-email';
import { checkProtection } from './protection';
import { sharedFormRateLimiter, type FormRateLimiter } from './rate-limit';

/**
 * Jednotná odpověď. Vrací se ve VŠECH případech, kdy odeslání není chyba schématu:
 * u nového kontaktu, u existujícího nepotvrzeného, u existujícího potvrzeného,
 * u adresy na suppression listu i u tichého zahození botem.
 *
 * Bezpečnostní podmínka od zadavatele: formulář musí odpovědět stejně, ať kontakt
 * existuje, nebo ne. Kdyby u známé adresy napsal „už jste přihlášen", stal by se
 * z formuláře nástroj na zjišťování, kdo je v databázi. U citlivého oboru je to
 * reálný problém.
 */
export const UNIFORM_RESPONSE = { ok: true, double_opt_in: true } as const;

export type SubmitInput = {
  fields: Record<string, unknown>;
  origin: string | null;
  nonce: string | undefined;
  ip: string;
  userAgent: string;
  pageUrl: string;
  elapsedSeconds: number;
  contentType: 'application/json' | 'application/x-www-form-urlencoded' | 'multipart/form-data';
  captchaToken?: string;
};

export type SubmitResponse =
  typeof UNIFORM_RESPONSE | { ok: false; details: { field: string; code: string }[] };

export type SubmitResult = {
  status: 200 | 303 | 422 | 429;
  response: SubmitResponse;
  location?: string;
  retryAfterSeconds?: number;
};

export type SubmitDeps = {
  keyring?: Keyring;
  limiter?: FormRateLimiter;
};

type Validated = {
  ok: true;
  email: string;
  firstName: string | null;
  lastName: string | null;
  locale: string | null;
  attributes: Record<string, unknown>;
  values: Record<string, unknown>;
};

type ValidationFailure = { ok: false; details: { field: string; code: string }[] };

/**
 * Zpracování odeslaného formuláře podle 4.13.6 části 2.
 *
 * ODCHYLKA OD PLÁNU, VĚDOMÁ. Plán psal kroky 4 až 9 (upsert kontaktu, přihlášení,
 * stavový automat, souhlas, potvrzovací e-mail) jako vlastní funkce `upsertFromForm`,
 * `subscribeFromForm` a `sendConfirmationEmail`. Ty už v repozitáři existují pod jménem
 * `subscribeToList` z úkolu 26 a dělají přesně to samé včetně pravidla „kdo už je
 * potvrzený, druhý potvrzovací e-mail nedostane" a včetně škrcení opakovaného odeslání.
 * Druhá implementace téhož by se rozešla se stavovým automatem, takže se volá ta hotová.
 */
export async function submitForm(
  form: PublicForm,
  input: SubmitInput,
  deps: SubmitDeps = {},
): Promise<SubmitResult> {
  const active = assertActiveForm(form);
  const ctx = active.ctx;

  /**
   * Kam po odeslání. `alreadySubscribed` je vlastní stránka seznamu pro toho,
   * kdo v něm už potvrzený je (`lists.already_subscribed_redirect_url`).
   *
   * PLATÍ JEN PRO ODPOVĚĎ 303, tedy pro hostovanou stránku a pro čistě HTML
   * formulář. Vkládaný skript posílá JSON, dostane 200 a vypíše svou hlášku;
   * chová se tak i dnešní `redirectUrl` samotného formuláře, takže to není
   * nová výjimka, ale tatáž hranice. Kdyby se skript měl přesměrovat, musel by
   * adresu dostat v těle, a to je právě ten rozdíl v odpovědi, kvůli kterému
   * je celá funkce vypnutá, dokud si ji správce nezapne.
   */
  const redirect = (alreadySubscribed?: string | null): SubmitResult => ({
    status: 303,
    response: UNIFORM_RESPONSE,
    location: alreadySubscribed ?? active.redirectUrl ?? `/f/${publicFormRef(active)}/thanks`,
  });
  const finish = (alreadySubscribed?: string | null): SubmitResult =>
    input.contentType === 'application/json'
      ? { status: 200, response: UNIFORM_RESPONSE }
      : redirect(alreadySubscribed);

  // 1. Pět vrstev ochrany. Tiché zahození vypadá navenek jako úspěch.
  const keyring = deps.keyring ?? keyringFromEnv();
  const limiter = deps.limiter ?? sharedFormRateLimiter();
  const protection = checkProtection(
    keyring,
    {
      id: active.id,
      honeypotField: active.honeypotField,
      minFillSeconds: active.minFillSeconds,
      allowedOrigins: active.allowedOrigins,
      captchaProvider: active.captchaProvider,
    },
    input,
    limiter,
  );

  if (protection.outcome === 'drop') {
    await recordSubmission(ctx, {
      formId: active.id,
      status: 'dropped',
      errorCode: protection.reason,
    });
    return finish();
  }
  if (protection.outcome === 'rate_limited') {
    await recordSubmission(ctx, {
      formId: active.id,
      status: 'rejected',
      errorCode: `rate_limited_${protection.scope}`,
    });
    return {
      status: 429,
      response: { ok: false, details: [{ field: '', code: 'rate_limited' }] },
      retryAfterSeconds: protection.retryAfterSeconds,
    };
  }
  if (protection.outcome === 'reject') {
    await recordSubmission(ctx, {
      formId: active.id,
      status: 'rejected',
      errorCode: protection.code,
    });
    return {
      status: 422,
      response: { ok: false, details: [{ field: '', code: protection.code }] },
    };
  }

  // 2. Validace polí. Payload se u chyby NEUKLÁDÁ, mohl by obsahovat nesmysly z botů.
  const validation = await validateSubmissionValues(active, input.fields);
  if (!validation.ok) {
    await recordSubmission(ctx, {
      formId: active.id,
      status: 'rejected',
      errorCode: 'validation_failed',
      payload: {},
    });
    return { status: 422, response: { ok: false, details: validation.details } };
  }

  // 3. až 9. Zápis kontaktu, přihlášení, štítky, souhlas, potvrzovací e-mail.
  //
  //     Kontrola suppression je uvnitř `subscribeToList`: adresa se stížností ani
  //     s výmazem podle článku 17 nezaloží kontakt a nedostane e-mail. Navenek je
  //     výsledek k nerozeznání od úspěchu (rozhodnutí R9).
  let contactId: string | null = null;
  let suppressed = false;
  /**
   * Seznamy, ve kterých byla adresa už POTVRZENÁ, tedy odeslání pro ně nic
   * nezměnilo a žádný e-mail z nich neodejde (stavový automat u `confirmed`
   * nedělá nic, viz `lists/state-machine.ts`). Podle toho se vybírá vlastní
   * stránka „už jste přihlášeni".
   */
  const alreadyConfirmedListIds: string[] = [];

  if (active.listIds.length === 0) {
    // Formulář bez seznamu jen zakládá kontakt. `writeContact` má tutéž bránu
    // suppression jako přihlášení, takže se blokovaná adresa nezapíše ani tudy.
    const written = await writeContact(ctx, {
      email: validation.email,
      firstName: validation.firstName,
      lastName: validation.lastName,
      ...(validation.locale === null ? {} : { locale: validation.locale }),
      source: 'form',
      sourceRef: active.id,
      attributes: validation.attributes,
      mode: 'update',
    });
    if (written.rejected === 'suppressed') suppressed = true;
    else contactId = written.id;
  } else {
    for (const listId of active.listIds) {
      const result = await subscribeToList(ctx, {
        listId,
        email: validation.email,
        firstName: validation.firstName,
        lastName: validation.lastName,
        attributes: validation.attributes,
        locale: validation.locale,
        source: 'form',
        sourceRef: active.id,
        // Formulář nikdy neobchází dvojí potvrzení sám od sebe: rozhoduje o tom
        // definice formuláře a nastavení seznamu, ne tělo požadavku.
        skipConfirmation: !active.doubleOptIn,
        consentText: active.consentText,
        requestIp: input.ip,
        userAgent: input.userAgent,
        pageUrl: input.pageUrl,
      });
      if (result.contactId !== null) contactId = result.contactId;
      if (result.outcome === 'blocked_complaint' || result.outcome === 'blocked_suppressed') {
        suppressed = true;
      }
      if (result.outcome === 'already_confirmed') alreadyConfirmedListIds.push(listId);
    }
  }

  if (suppressed && contactId === null) {
    await recordSubmission(ctx, {
      formId: active.id,
      status: 'accepted',
      errorCode: 'suppressed',
    });
    return finish();
  }

  // Štítky mají vlastní transakci, protože `addTagsToContact` hlídá strop štítků
  // na kontakt a otevírá si ji sám. Vnořovat transakce by znamenalo držet dvě spojení.
  if (contactId !== null && active.tagIds.length > 0) {
    await addTagsToContact(ctx, contactId, active.tagIds);
  }

  // Pravidlo 4 na souhlas z formuláře. Přihlášení do seznamu hlídá `subscribeToList`,
  // tenhle souhlas ale vzniká mimo něj, takže by se blokované adrese zapsal bez ohledu
  // na suppression. Kontrola je zvlášť, protože adresa sem doteče oběma větvemi.
  //
  // Odhlášený člověk se tím z formuláře vrátit může, ale POUZE přes dvojí potvrzení:
  // souhlas mu vznikne až kliknutím na odkaz (4.8.1), ne odesláním formuláře.
  const consentAllowed =
    contactId === null || (await checkSingleSuppression(ctx, validation.email)) === null;

  await withWorkspace(ctx, async (tx) => {
    if (contactId !== null && active.consentText !== null && consentAllowed) {
      await recordConsent(ctx, {
        contactId,
        purpose: 'email_marketing',
        status: 'granted',
        legalBasis: active.legalBasis,
        scopeListId: null,
        source: 'form',
        sourceRef: active.id,
        consentText: active.consentText,
        evidence: buildConsentEvidence({
          storeIp: await storeIpEnabled(tx, ctx),
          ip: input.ip,
          user_agent: input.userAgent,
          page_url: input.pageUrl,
          form_id: active.id,
          ...consentTextEvidence(active.consentText),
        }),
        tx,
      });
    }

    await recordSubmission(ctx, {
      formId: active.id,
      status: 'accepted',
      contactId,
      payload: validation.values,
      ip: input.ip,
      userAgent: input.userAgent,
      pageUrl: input.pageUrl,
      tx,
    });
  });

  // 10. Slíbený e-mail, typicky odkaz ke stažení. Odchází JEN u formuláře
  //     s vypnutým potvrzováním adresy; se zapnutým ho posílá až potvrzovací
  //     odkaz (`confirm-service.ts`), aby slíbenou věc nedostal někdo, kdo
  //     o ni nepožádal a jen mu někdo cizí zadal adresu.
  //
  //     ZÁMĚRNĚ AŽ ZA ZÁPISEM a mimo jeho transakci: odeslání je vedlejší
  //     účinek a nesmí zdržet ani shodit potvrzení odeslání formuláře.
  if (!active.doubleOptIn && contactId !== null && active.deliveryTemplateId !== null) {
    await deliverFormEmail(ctx, active, contactId, validation.email);
  }

  // 11. Odpověď. Stejná pro všechny, jen s jednou výjimkou, kterou si správce
  //     musí sám zapnout, viz `alreadySubscribedPage`.
  return finish(await alreadySubscribedPage(ctx, active, alreadyConfirmedListIds));
}

/**
 * Vlastní stránka pro toho, kdo v seznamu už potvrzený je, nebo `null`.
 *
 * PROČ VŮBEC. Dnes dostane takový člověk tutéž děkovací stránku jako nový
 * zájemce, tedy typicky text „podívejte se do e-mailu a potvrďte přihlášení".
 * Žádný e-mail mu ale nepřijde, protože potvrzenému se nic neposílá, takže mu
 * produkt řekne nepravdu a on ji nemá jak prohlédnout. Vlastní stránka je
 * jediné místo, kde mu jde říct „vy už jste přihlášeni, nic dělat nemusíte".
 *
 * DVĚ PODMÍNKY, obě nutné:
 *
 *  1. VŠECHNY seznamy formuláře hlásí `already_confirmed`. Když formulář
 *     přihlašuje do dvou seznamů a člověk je zatím jen v jednom, tak se
 *     odesláním něco doopravdy stalo a „už jste přihlášeni" by byla nepravda.
 *  2. Seznam má vyplněnou adresu. `NULL` je výchozí a znamená dnešní chování.
 *
 * PROLAMUJE TO JEDNOTNOU ODPOVĚĎ (R9) A JE TO VĚDOMÉ. Jiná odpověď na známou
 * adresu prozradí, že ta adresa v databázi je. Proto se to nezapíná samo, proto
 * je výchozí `NULL` a proto na ten následek upozorňuje rozhraní u toho pole.
 * Adresa neznámá i adresa blokovaná dál dostanou přesně tutéž odpověď jako nový
 * zájemce, takže se rozdíl týká jen potvrzených.
 */
async function alreadySubscribedPage(
  ctx: PublicForm['ctx'],
  form: PublicForm,
  alreadyConfirmedListIds: readonly string[],
): Promise<string | null> {
  if (form.listIds.length === 0) return null;
  if (alreadyConfirmedListIds.length !== form.listIds.length) return null;

  // Seznamy se čtou v pořadí, v jakém je má formulář: první vyplněná adresa
  // vyhrává. Hádat mezi dvěma vyplněnými by znamenalo pravidlo, které by nikdo
  // nečekal, a pořadí formuláře je jediné, které uživatel sám určil.
  for (const listId of form.listIds) {
    const list = await listById(ctx, listId);
    const url = list?.alreadySubscribedRedirectUrl ?? null;
    if (url !== null) return url;
  }

  /*
   * NAVRŽENÁ STRÁNKA „už jste přihlášeni" (plán 2026-08-07, povrch
   * `already_subscribed`). Je to třetí možnost vedle dnešního přesměrování
   * na cizí web a vedle vestavěné děkovací věty.
   *
   * Adresa vede na naši děkovací trasu s parametrem, protože stránku vykresluje
   * `/f/{slug}/thanks`; sama by tu větev nepoznala, odeslání formuláře je
   * jediné místo, které ví, že adresa je ve všech seznamech už potvrzená.
   *
   * JEDNOTNÁ ODPOVĚĎ (R9) TÍM NESLÁBNE VÍC, NEŽ UŽ SLÁBNE. Parametr se přidá
   * výhradně tehdy, když si autor stránku sám nastavil, tedy za týchž dvou
   * podmínek jako přesměrování o kus výš. Bez nastavené stránky je odpověď
   * bajtově táž jako pro neznámou adresu.
   */
  for (const listId of form.listIds) {
    const templateId = await withWorkspace(ctx, (tx) =>
      resolvePageTemplateId(tx, ctx, {
        surface: 'already_subscribed',
        formId: form.id,
        listId,
      }),
    );
    if (templateId !== null) {
      return `/f/${publicFormRef(form)}/thanks?${ALREADY_SUBSCRIBED_QUERY}=1`;
    }
  }
  return null;
}

/**
 * Odeslání slíbeného e-mailu. Nikdy nevyhodí výjimku a nikdy nezmění odpověď
 * formuláře: kontakt je v tuhle chvíli zapsaný a odpověď musí zůstat stejná pro
 * všechny (rozhodnutí R9). Neodeslání se pozná z počtu zpráv, ne ze stránky.
 */
async function deliverFormEmail(
  ctx: PublicForm['ctx'],
  form: PublicForm,
  contactId: string,
  email: string,
): Promise<void> {
  try {
    await sendFormDeliveryEmail(ctx, {
      form,
      contactId,
      email,
      assetBaseUrl: loadConfig().ASSET_BASE_URL,
    });
  } catch {
    // Viz hlavička.
  }
}

/**
 * Validace hodnot proti definici formuláře a katalogu vlastních polí.
 *
 * Pole, které ve formuláři není, se ZAHAZUJE. Kdyby se zapisovalo, stal by se
 * z veřejného endpointu zapisovač do libovolného sloupce kontaktu.
 */
export async function validateSubmissionValues(
  form: PublicForm,
  raw: Record<string, unknown>,
): Promise<Validated | ValidationFailure> {
  const details: { field: string; code: string }[] = [];
  const values: Record<string, unknown> = {};
  const attributes: Record<string, unknown> = {};

  const custom = await listContactFields(form.ctx);
  const settings = await withWorkspace(form.ctx, async (tx) => readContactsSettings(tx, form.ctx));
  const coerceSettings = {
    numberFormat: settings.number_format,
    dateFormat: settings.date_format,
    defaultCountry: settings.default_country,
  };

  let firstName: string | null = null;
  let lastName: string | null = null;
  let locale: string | null = null;
  let email: string | null = null;

  for (const field of form.fields) {
    const name = formFieldName(field);
    const value = raw[name];
    const text = value === undefined || value === null ? '' : String(value).trim();

    if (text === '') {
      if (field.required) details.push({ field: name, code: 'required_field_missing' });
      continue;
    }
    values[name] = text;

    const target = field.target;
    if (typeof target === 'object') {
      const definition = custom.find((candidate) => candidate.key === target.attribute);
      if (definition === undefined) {
        // Katalog se od uložení formuláře změnil. Hodnota se zahodí, ale odeslání
        // kvůli tomu nespadne: člověk za smazané pole nemůže.
        continue;
      }
      const coerced = coerceValue(text, toFieldDefinition(definition), coerceSettings);
      if (!coerced.ok) details.push({ field: name, code: coerced.code });
      else attributes[definition.key] = coerced.value;
      continue;
    }

    switch (target) {
      case 'email':
        email = text;
        break;
      case 'first_name':
        firstName = text;
        break;
      case 'last_name':
        lastName = text;
        break;
      case 'full_name': {
        // Rozdělení jména vlastní modul oslovení, který běží uvnitř zápisu kontaktu.
        const parts = text.split(/\s+/);
        firstName = parts[0] ?? null;
        lastName = parts.length > 1 ? parts.slice(1).join(' ') : null;
        break;
      }
      case 'locale':
        locale = text;
        break;
    }
  }

  // Adresa je jediné pole, bez kterého se odeslání nedá zpracovat, i kdyby ho definice
  // formuláře nevyžadovala: bez ní není koho přihlásit.
  const rawEmail = email ?? (raw['email'] === undefined ? '' : String(raw['email']).trim());
  const normalized = normalizeEmail(rawEmail);
  if (!normalized.ok) details.push({ field: 'email', code: normalized.code });

  if (details.length > 0) return { ok: false, details };
  if (!normalized.ok) return { ok: false, details: [{ field: 'email', code: 'invalid_email' }] };

  values['email'] = normalized.email;
  return {
    ok: true,
    email: normalized.email,
    firstName,
    lastName,
    locale,
    attributes,
    values,
  };
}

function toFieldDefinition(field: {
  key: string;
  type: string;
  options: Record<string, unknown>;
}): FieldDefinition {
  return { key: field.key, type: field.type as FieldDefinition['type'], options: field.options };
}
