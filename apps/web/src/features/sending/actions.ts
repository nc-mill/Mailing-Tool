'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client/fetch';
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

/**
 * Zapnutí a vypnutí zkušebního režimu. Rozhoduje uložená hodnota, ne stav domény:
 * jakmile se uživatel vyjádří, platí jeho volba (viz `resolveTrialMode` v jádru).
 */
export async function setTrialModeAction(input: {
  workspaceId: string;
  enabled: boolean;
}): Promise<ActionResult> {
  const result = await apiMutate<unknown>('/api/v1/settings/trial', {
    method: 'PATCH',
    workspaceId: input.workspaceId,
    body: { trial_mode: input.enabled },
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(SENDING_PATH, 'page');
  return { status: 'success' };
}

export type AddTrialAddressResult =
  | { status: 'success'; verificationUrl: string | null }
  | { status: 'error'; code: string; detail: string };

/**
 * Přidání ověřované adresy. Adresa vzniká jako NEPOTVRZENÁ; ověřenou se stane až
 * tím, že někdo otevře odkaz z e-mailu. `verificationUrl` přichází ze serveru jen
 * mimo produkci, aby šel režim dokončit i bez zapojené odesílací pipeline.
 */
export async function addTrialAddressAction(input: {
  workspaceId: string;
  email: string;
}): Promise<AddTrialAddressResult> {
  const result = await apiMutate<{ verification_url: string | null }>(
    '/api/v1/settings/trial/addresses',
    { method: 'POST', workspaceId: input.workspaceId, body: { email: input.email } },
  );
  if (!result.ok) {
    return { status: 'error', code: result.problem.code, detail: result.problem.detail };
  }
  revalidatePath(SENDING_PATH, 'page');
  return { status: 'success', verificationUrl: result.data.verification_url };
}

/**
 * Odebrání adresy ze seznamu. Adres je nejvýš deset, takže bez odebrání by projekt
 * po deseti pokusech neměl kam přidat další.
 */
export async function removeTrialAddressAction(input: {
  workspaceId: string;
  email: string;
}): Promise<ActionResult> {
  const result = await apiMutate<unknown>(
    `/api/v1/settings/trial/addresses/${encodeURIComponent(input.email)}`,
    { method: 'DELETE', workspaceId: input.workspaceId },
  );
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(SENDING_PATH, 'page');
  return { status: 'success' };
}

export type CreateDomainResult =
  { status: 'success'; domainId: string } | { status: 'error'; code: string; detail: string };

/**
 * Založení odesílací domény. Tvar těla je opsaný z `createDomainRoute`
 * v `packages/core/src/providers/api/providers.routes.ts`, kde je schéma
 * `.strict()`: `{ domain, provider_id }` a nic navíc. Cokoli dalšího by
 * skončilo na 422 `validation_failed`.
 *
 * `provider_id` je POVINNÝ, ne odvozený z výchozího účtu: doména se v jádru
 * zapisuje k jednomu konkrétnímu účtu (`addDomain`) a podle jeho regionu se
 * skládají DNS záznamy. Bez účtu se doména založit nedá vůbec.
 *
 * Odpověď nese i hotové záznamy, ale ty se tady zahazují schválně: po úspěchu
 * se jde na detail domény, kam tatáž data přicházejí z `GET /api/v1/domains/{id}`
 * a navíc se stavem kontrol. Druhá cesta k témuž obsahu by se rozešla.
 */
export async function createDomainAction(input: {
  workspaceId: string;
  domain: string;
  providerId: string;
}): Promise<CreateDomainResult> {
  const result = await apiMutate<{ domain: { id: string } }>('/api/v1/domains', {
    method: 'POST',
    workspaceId: input.workspaceId,
    body: { domain: input.domain, provider_id: input.providerId },
  });
  if (!result.ok) {
    return { status: 'error', code: result.problem.code, detail: result.problem.detail };
  }
  revalidatePath(SENDING_PATH, 'page');
  return { status: 'success', domainId: result.data.domain.id };
}

export type DeleteDomainResult =
  | { status: 'success' }
  /**
   * `reason` chodí ze serveru v `params` a je jediný způsob, jak u kódu `conflict`
   * rozlišit dva úplně jiné případy: `domain_in_use` (běžící nebo naplánovaná
   * kampaň, stačí počkat) a `domain_has_campaigns` (doménu drží hotová kampaň
   * přes cizí klíč `ON DELETE RESTRICT`, tam čekání nepomůže). Registrovaný kód
   * je na oba jeden.
   */
  | { status: 'error'; code: string; reason: string | null; count: number | null; detail: string };

/**
 * Odebrání odesílací domény. Server sám rozhoduje, kdy to nejde, a jeho důvod se
 * nepřebíjí ani neschovává: bez konkrétního důvodu uživatel neví, jestli má počkat,
 * zrušit kampaň, nebo něco smazat natrvalo.
 */
export async function deleteDomainAction(input: {
  workspaceId: string;
  domainId: string;
}): Promise<DeleteDomainResult> {
  const result = await apiMutate<undefined>(`/api/v1/domains/${input.domainId}`, {
    method: 'DELETE',
    workspaceId: input.workspaceId,
  });
  if (!result.ok) {
    const params = result.problem.params ?? {};
    return {
      status: 'error',
      code: result.problem.code,
      reason: typeof params['reason'] === 'string' ? params['reason'] : null,
      count: typeof params['count'] === 'number' ? params['count'] : null,
      detail: result.problem.detail,
    };
  }
  // Obě cesty: seznam domén i detail té odebrané. Bez první by odebraná doména
  // v seznamu zůstala viset až do tvrdé obnovy stránky.
  revalidatePath(SENDING_PATH, 'page');
  revalidatePath(DOMAIN_PATH, 'page');
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

/**
 * Vstup úpravy odesílacího účtu. Tvar je opsaný z `PatchSendingProviderRequest`
 * v `packages/contracts/openapi.json`, tedy JEDEN objekt bez rozlišovače `type`:
 * typ účtu se úpravou nemění, mění se jeho nastavení.
 *
 * Tajemství (`secret_access_key`, `password`) se ze serveru nikdy nevracejí,
 * takže se posílají JEN tehdy, když je uživatel opravdu vyplnil. Prázdný řetězec
 * se neposílá vůbec: neprošel by na `min(1)` a znamenal by pokus vymazat heslo.
 */
export type UpdateProviderInput = {
  name?: string;
  region?: string;
  configuration_set_name?: string;
  access_key_id?: string;
  secret_access_key?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  encryption?: 'starttls' | 'tls' | 'none';
};

export type UpdateProviderResult =
  | { status: 'success'; credentialsRotated: boolean }
  | { status: 'error'; code: string; detail: string };

/**
 * Úprava odesílacího účtu. Stejně jako u zakládání jde tajemství přes serverovou
 * akci, nikdy z prohlížeče přímo na API.
 */
export async function updateProviderAction(input: {
  workspaceId: string;
  providerId: string;
  patch: UpdateProviderInput;
}): Promise<UpdateProviderResult> {
  const result = await apiMutate<{ credentials_rotated: boolean }>(
    `/api/v1/providers/${input.providerId}`,
    { method: 'PATCH', workspaceId: input.workspaceId, body: input.patch },
  );
  if (!result.ok) {
    return { status: 'error', code: result.problem.code, detail: result.problem.detail };
  }
  revalidatePath(SENDING_PATH, 'page');
  return { status: 'success', credentialsRotated: result.data.credentials_rotated === true };
}

export type DeleteProviderResult =
  { status: 'success' } | { status: 'error'; code: string; detail: string };

/**
 * Odebrání odesílacího účtu. Server sám vrací `conflict`, když přes účet běží
 * nebo je naplánovaná kampaň; ta odpověď se nepřebíjí ani neschovává, protože
 * je to jediný důvod, proč odebrání nejde dokončit.
 */
export async function deleteProviderAction(input: {
  workspaceId: string;
  providerId: string;
}): Promise<DeleteProviderResult> {
  const result = await apiMutate<undefined>(`/api/v1/providers/${input.providerId}`, {
    method: 'DELETE',
    workspaceId: input.workspaceId,
  });
  if (!result.ok) {
    return { status: 'error', code: result.problem.code, detail: result.problem.detail };
  }
  revalidatePath(SENDING_PATH, 'page');
  return { status: 'success' };
}

/**
 * Stav účtu tak, jak ho server ZAPSAL při tomhle ověření, a co konkrétně brání
 * odesílání. Obojí chodí i s chybou, protože i nezdar mění stav účtu.
 *
 * Existuje kvůli rozporu, který byl vidět na obrazovce: odznak se kreslil ze
 * seznamu načteného dřív, výsledek testu z čerstvé odpovědi, a vedle sebe pak
 * stálo „Neověřený" a „Ověřeno, účet je připravený odesílat". Od téhle chvíle
 * pochází obojí z JEDNÉ odpovědi.
 */
export type ProviderStatusView = {
  providerStatus: string;
  blockers: string[];
  /**
   * Region účtu a co v něm má Amazon ověřené, ze STEJNÉ odpovědi jako stav.
   *
   * Bez toho by obrazovka po testu ukazovala čerstvý odznak vedle regionu
   * a identit z předchozího načtení, což je přesně ten druh rozporu, kvůli
   * kterému celá tahle úprava vznikla. `null` u počtu znamená „nezjišťovali
   * jsme" a NESMÍ se číst jako „ani jedna".
   */
  region: string | null;
  verifiedIdentities: string[];
  verifiedIdentityCount: number | null;
};

export type TestProviderResult =
  | ({ status: 'success'; detail: string; sandbox: boolean } & ProviderStatusView)
  /**
   * `reason` chodí ze serveru v `params` a je to jediný způsob, jak u SES rozlišit
   * špatný klíč od chybějícího oprávnění nebo špatného regionu: registrovaný kód
   * je na všechny tři případy jeden (`provider_credentials_invalid`).
   *
   * `detail` je syrová odpověď poskytovatele. Nenahrazuje radu, doplňuje ji:
   * uživatel podle rady ví, co opravit, a podle detailu to může poslat podpoře.
   */
  | ({ status: 'error'; code: string; reason: string | null; detail: string } & ProviderStatusView);

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function countOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Test připojení odesílacího účtu.
 *
 * ZMĚNA PROTI PŮVODNÍMU ZNĚNÍ: test stav účtu MĚNÍ. Dřív tu stálo „nemění stav
 * účtu, jen ho ověří na místě", a přesně to byla vada: účet zůstal navždy na
 * `unverified`, i když test právě doložil, že údaje fungují. Server teď výsledek
 * zapíše a vrátí ho, takže se odznak a výsledek nemají jak rozejít.
 */
export async function testProviderAction(input: {
  workspaceId: string;
  providerId: string;
}): Promise<TestProviderResult> {
  const result = await apiMutate<{
    ok: true;
    detail: string;
    sandbox?: boolean;
    status?: string;
    status_detail?: {
      blockers?: unknown;
      region?: unknown;
      verified_identities?: unknown;
      verified_identity_count?: unknown;
    };
  }>(`/api/v1/providers/${input.providerId}/test`, {
    method: 'POST',
    workspaceId: input.workspaceId,
    body: {},
  });
  if (!result.ok) {
    const params = result.problem.params ?? {};
    const reason = typeof params['reason'] === 'string' ? params['reason'] : null;
    // Přednost má syrová odpověď poskytovatele z `params.detail`. `problem.detail`
    // je obecný text z katalogu podle kódu, takže je to až druhá volba.
    const raw = typeof params['detail'] === 'string' ? params['detail'] : '';
    return {
      status: 'error',
      code: result.problem.code,
      reason,
      detail: raw === '' ? result.problem.detail : raw,
      // `unverified` jako záložní hodnota, ne `ready`: když server stav
      // nepošle, je jediná bezpečná odpověď „neověřeno".
      providerStatus: typeof params['status'] === 'string' ? params['status'] : 'unverified',
      blockers: stringsOf(params['blockers']),
      region: stringOrNull(params['region']),
      verifiedIdentities: stringsOf(params['verified_identities']),
      verifiedIdentityCount: countOrNull(params['verified_identity_count']),
    };
  }
  const detail = result.data.status_detail ?? {};
  return {
    status: 'success',
    detail: result.data.detail,
    sandbox: result.data.sandbox === true,
    // Chybějící stav znamená „nevíme", ne „připravený". Obrazovka to řekne.
    providerStatus: typeof result.data.status === 'string' ? result.data.status : 'unknown',
    blockers: stringsOf(detail.blockers),
    region: stringOrNull(detail.region),
    verifiedIdentities: stringsOf(detail.verified_identities),
    verifiedIdentityCount: countOrNull(detail.verified_identity_count),
  };
}

/* ------------------------------------------------------------------ *
 * OVĚŘENÍ ADRESY ODESÍLATELE PŘÍMO U AMAZONU
 * ------------------------------------------------------------------ */

/**
 * Stav adresy podle Amazonu. Hodnoty jsou doslova ty z `GetEmailIdentity`,
 * jen malými písmeny; `unknown` znamená „nevíme", ne „nepovedlo se".
 */
export type IdentityState =
  'verified' | 'pending' | 'failed' | 'temporary_failure' | 'not_started' | 'unknown';

export type EmailIdentityView = {
  region: string;
  email: string;
  status: IdentityState;
  verified: boolean;
  /** Adresu měl účet u Amazonu založenou už předtím, takže nový e-mail nepřišel. */
  already_existed: boolean;
};

export type IdentityResult =
  | { status: 'success'; identity: EmailIdentityView }
  | { status: 'error'; code: string; detail: string };

/**
 * Ověření adresy odesílatele u Amazonu, tedy `CreateEmailIdentity` v regionu
 * účtu. Amazon na adresu pošle potvrzovací odkaz; ověřená je až po kliknutí.
 *
 * POSÍLÁ HO AMAZON, NE MY. Je to podstatný rozdíl pro uživatele, který ten
 * e-mail bude hledat: přijde od Amazon Web Services, ne z naší aplikace,
 * a odkaz v něm má omezenou platnost.
 */
export async function verifyIdentityAction(input: {
  workspaceId: string;
  providerId: string;
  email: string;
}): Promise<IdentityResult> {
  const result = await apiMutate<EmailIdentityView>(
    `/api/v1/providers/${input.providerId}/identities`,
    { method: 'POST', workspaceId: input.workspaceId, body: { email: input.email } },
  );
  if (!result.ok) {
    const params = result.problem.params ?? {};
    const raw = typeof params['detail'] === 'string' ? params['detail'] : '';
    return {
      status: 'error',
      code: result.problem.code,
      detail: raw === '' ? result.problem.detail : raw,
    };
  }
  revalidatePath(SENDING_PATH, 'page');
  return { status: 'success', identity: result.data };
}

/**
 * Dotaz na stav jedné adresy. Ptá se AMAZONU, ne naší paměti.
 *
 * Čte se přes `apiFetch`, ne `apiMutate`: je to GET a `apiMutate` posílá tělo
 * i CSRF token, které tenhle koncový bod nemá kam dát.
 */
export async function identityStatusAction(input: {
  workspaceId: string;
  providerId: string;
  email: string;
}): Promise<IdentityResult> {
  const result = await apiFetch<EmailIdentityView>(
    `/api/v1/providers/${input.providerId}/identities/${encodeURIComponent(input.email)}`,
    { workspaceId: input.workspaceId },
  );
  if (!result.ok) {
    const params = result.problem.params ?? {};
    const raw = typeof params['detail'] === 'string' ? params['detail'] : '';
    return {
      status: 'error',
      code: result.problem.code,
      detail: raw === '' ? result.problem.detail : raw,
    };
  }
  return { status: 'success', identity: result.data };
}

export type ProductionAccessResult =
  | { status: 'success'; region: string }
  | { status: 'error'; code: string; reason: string | null; detail: string };

/**
 * Žádost o vyřazení z testovacího režimu u Amazonu (`PutAccountDetails`).
 *
 * Ověřeno v dokumentaci SESv2 (4. 8. 2026): jde to z API a příručka SES tuhle
 * cestu sama nabízí. Amazon chce dva údaje povinně, druh pošty a adresu webu,
 * a žádost pak posuzuje člověk. Během posuzování se údaje měnit nedají, takže
 * druhý pokus skončí na 409 `conflict`.
 */
export async function requestProductionAccessAction(input: {
  workspaceId: string;
  providerId: string;
  mailType: 'MARKETING' | 'TRANSACTIONAL';
  websiteUrl: string;
  additionalContactEmails: string[];
}): Promise<ProductionAccessResult> {
  const contacts = input.additionalContactEmails.filter((e) => e.trim() !== '');
  const result = await apiMutate<{ region: string }>(
    `/api/v1/providers/${input.providerId}/production-access`,
    {
      method: 'POST',
      workspaceId: input.workspaceId,
      body: {
        mail_type: input.mailType,
        website_url: input.websiteUrl,
        ...(contacts.length === 0 ? {} : { additional_contact_emails: contacts }),
      },
    },
  );
  if (!result.ok) {
    const params = result.problem.params ?? {};
    const raw = typeof params['detail'] === 'string' ? params['detail'] : '';
    return {
      status: 'error',
      code: result.problem.code,
      reason: typeof params['reason'] === 'string' ? params['reason'] : null,
      detail: raw === '' ? result.problem.detail : raw,
    };
  }
  revalidatePath(SENDING_PATH, 'page');
  return { status: 'success', region: result.data.region };
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
