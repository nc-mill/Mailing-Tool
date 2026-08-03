import { keyringFromEnv, type Keyring } from '@mlain/contracts/keyring';
import { withWorkspace } from '../../tx';
import { buildConsentEvidence, consentTextEvidence } from '../consents/evidence';
import { normalizeEmail } from '../email';
import { coerceValue, type FieldDefinition } from '../fields/coerce';
import { subscribeToList } from '../lists/subscribe-service';
import { storeIpEnabled } from '../privacy';
import { listContactFields } from '../repo/contact-fields';
import { recordConsent } from '../repo/consents';
import { assertActiveForm, publicFormRef, recordSubmission, type PublicForm } from '../repo/forms';
import { writeContact } from '../repo/contacts';
import { checkSingleSuppression } from '../repo/suppressions';
import { addTagsToContact } from '../repo/tags';
import { readContactsSettings } from '../settings';
import { formFieldName } from './definition';
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

  const redirect = (): SubmitResult => ({
    status: 303,
    response: UNIFORM_RESPONSE,
    location: active.redirectUrl ?? `/f/${publicFormRef(active)}/thanks`,
  });
  const finish = (): SubmitResult =>
    input.contentType === 'application/json'
      ? { status: 200, response: UNIFORM_RESPONSE }
      : redirect();

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

  // 10. Odpověď, vždy stejná.
  return finish();
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
