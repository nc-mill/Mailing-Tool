'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { apiMutate } from '@/lib/api-client/mutate';
import type { Problem } from '@/lib/api-client/problem';
import { failed, succeeded, type ActionState } from '@/lib/feedback/action-result';
import { blankEmailDocument, workingCopyName } from './blank-email';
import { NO_SELECTION } from './no-selection';
import {
  decodeSenderIdentityFingerprints,
  matchSenderIdentity,
  senderFingerprint,
} from './sender-fingerprint';

export type ActionResult = { status: 'success' } | { status: 'error'; code: string };

const CAMPAIGNS_PATH = '/[locale]/w/[workspaceSlug]/campaigns';
const CAMPAIGN_DETAIL_PATH = '/[locale]/w/[workspaceSlug]/campaigns/[id]';
const TEMPLATES_PATH = '/[locale]/w/[workspaceSlug]/templates';

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

/* ------------------------------------------------------------------------ *
 * Krok 1: obsah e-mailu
 *
 * Samostatné `createCampaignAction` tu bylo do chvíle, než zakládání dostalo
 * první krok. Zůstat nesmělo: každý export ze souboru `'use server'` je
 * volatelný koncový bod, takže akce, kterou žádná obrazovka nepoužívá, je
 * plocha navíc bez užitku. Zakládání teď dělá `createDraft` níž, a to vždycky
 * jako součást rozhodnutí o obsahu.
 * ------------------------------------------------------------------------ */

export type StartCampaignResult =
  | { status: 'success'; campaignId: string; templateId: string | null }
  | { status: 'error'; code: string };

/**
 * Kampaň vzniká UŽ V PRVNÍM KROKU, ne až na konci průvodce.
 *
 * Obsah e-mailu nemá kde bydlet, dokud kampaň neexistuje: `campaigns.design`
 * je sloupec kampaně a šablona, ze které se plní, je taky řádek v databázi.
 * Kdyby se kampaň zakládala až na konci, musel by průvodce držet rozdělaný
 * e-mail v prohlížeči a zavřená karta by ho vzala s sebou. Takhle je kampaň
 * hned po prvním kroku vidět v seznamu jako rozepsaná, dá se k ní vrátit
 * a dá se i smazat.
 *
 * Zakládá se až tím prvním rozhodnutím o obsahu, ne otevřením průvodce.
 * Samotné otevření obrazovky nic nevytvoří, takže odchod z ní nenechává
 * v seznamu prázdné kampaně, které nikdo nechtěl.
 */
async function createDraft(
  workspaceId: string,
  name: string,
): Promise<{ ok: true; id: string } | { ok: false; code: string }> {
  const created = await apiMutate<{ id: string }>('/api/v1/campaigns', {
    method: 'POST',
    workspaceId,
    body: { name },
  });
  if (!created.ok) return { ok: false, code: created.problem.code };
  return { ok: true, id: created.data.id };
}

/**
 * Propojení kampaně se šablonou. Používá se `PATCH`, ne `apply-template`.
 *
 * `apply-template` totiž hned po zkopírování dokumentu kampaň KOMPILUJE
 * a kompilace vyžaduje předmět (`campaign_subject_missing`). Čerstvá kampaň
 * žádný předmět nemá, takže by první krok průvodce skončil chybou, přestože
 * se obsah přenesl. `PATCH template_id` obsah do prázdné kampaně vyplní taky
 * (výraz `FILL_TEMPLATE_DESIGN` v jádru) a nekompiluje; kompilace přijde sama
 * při uložení nastavení, tedy až bude předmět vyplněný.
 */
async function linkTemplate(
  workspaceId: string,
  campaignId: string,
  templateId: string,
): Promise<{ ok: true } | { ok: false; code: string }> {
  const patched = await apiMutate<{ id: string }>(`/api/v1/campaigns/${campaignId}`, {
    method: 'PATCH',
    workspaceId,
    body: { template_id: templateId },
  });
  if (!patched.ok) return { ok: false, code: patched.problem.code };
  return { ok: true };
}

/* ------------------------------------------------------------------------ *
 * Pracovní obsah kampaně
 *
 * KDE OBSAH KAMPANĚ BYDLÍ. Rozeslat se dá jedině to, co je v `campaigns.design`:
 * `compileCampaign` čte ten sloupec a nic jiného, `template_id` se do odesílací
 * cesty vůbec nedostane. Obsah tedy patří kampani a šablona je jen původ.
 *
 * PROČ PŘESTO VZNIKÁ ŘÁDEK V `templates`. Editor umí upravovat výhradně šablonu
 * (`PATCH /api/v1/templates/{id}`), jiný koncový bod pro rozepsaný dokument
 * neexistuje. Kampaň proto dostane VLASTNÍ pracovní řádek, `kind = 'system'`,
 * který je z knihovny šablon vyloučený (viz `listConditions` v jádru). Je to
 * plátno kampaně, ne šablona, a uživatel se o něm nemá dozvědět.
 *
 * PRACOVNÍ KOPIE JE VŽDY VLASTNÍ, I KDYŽ KAMPAŇ ZAČÍNÁ ZE ŠABLONY. Kdyby
 * `template_id` mířilo na knihovní šablonu, vedlo by tlačítko „Upravit obsah"
 * do editoru TÉ šablony a úprava jedné kampaně by přepsala šablonu i všem
 * ostatním. Zadání to zakazuje výslovně a odesílací cesta na tom nic
 * nezachrání: `campaigns.design` je kopie, ale editovaný dokument by byl sdílený.
 * ------------------------------------------------------------------------ */

/**
 * Založí kampani její pracovní obsah a propojí ho s ní.
 *
 * Vrací `templateId` pracovního řádku, protože jen přes něj se dá otevřít
 * editor. `linkTemplate` zároveň naplní `campaigns.design`, takže kampaň má
 * obsah hned, ne až po prvním uložení v editoru.
 */
async function createWorkingCopy(input: {
  workspaceId: string;
  campaignId: string;
  campaignName: string;
  document: unknown;
}): Promise<{ ok: true; templateId: string } | { ok: false; code: string }> {
  const created = await apiMutate<{ id: string }>('/api/v1/templates', {
    method: 'POST',
    workspaceId: input.workspaceId,
    body: {
      name: workingCopyName(input.campaignName, input.campaignId),
      // `system` znamená „vyrobila aplikace, do knihovny to nepatří". Týž
      // význam, jaký má `campaigns.kind = 'system'` u skryté kampaně pro
      // testovací odeslání. Na kontrolu dokumentu to nemá vliv: jádro pro
      // něj používá profil kampaně (`validationProfileFor`).
      kind: 'system',
      document: input.document,
    },
  });
  if (!created.ok) return { ok: false, code: created.problem.code };

  const linked = await linkTemplate(input.workspaceId, input.campaignId, created.data.id);
  if (!linked.ok) return { ok: false, code: linked.code };
  return { ok: true, templateId: created.data.id };
}

/** Dokument knihovní šablony. Úsporná podoba `view=summary` ho neposílá. */
async function readTemplateDocument(
  workspaceId: string,
  templateId: string,
): Promise<{ ok: true; document: unknown } | { ok: false; code: string }> {
  const found = await apiFetch<{ design: unknown }>(`/api/v1/templates/${templateId}`, {
    workspaceId,
  });
  if (!found.ok) return { ok: false, code: found.problem.code };
  return { ok: true, document: found.data.design };
}

/**
 * Prázdný e-mail: založí kampaň, k ní pracovní obsah s nejmenším platným
 * dokumentem a obojí propojí. Uživatel pak pokračuje rovnou do editoru.
 *
 * `locale` přichází z obrazovky, protože jazyk dokumentu určuje, jak se
 * e-mail zkompiluje, a serverová akce ho sama z požadavku nevyčte.
 */
export async function startCampaignFromBlankAction(input: {
  workspaceId: string;
  name: string;
  locale: string;
}): Promise<StartCampaignResult> {
  const draft = await createDraft(input.workspaceId, input.name);
  if (!draft.ok) return { status: 'error', code: draft.code };

  const working = await createWorkingCopy({
    workspaceId: input.workspaceId,
    campaignId: draft.id,
    campaignName: input.name,
    document: blankEmailDocument(input.locale, input.name),
  });
  // Kampaň už existuje a v seznamu zůstane jako rozepsaná. Nemažeme ji:
  // obsah si uživatel může založit znovu z kroku obsahu, nebo ji smazat sám.
  revalidatePath(CAMPAIGNS_PATH, 'page');
  if (!working.ok) return { status: 'error', code: working.code };
  return { status: 'success', campaignId: draft.id, templateId: working.templateId };
}

/**
 * Start ze šablony: založí kampaň a udělá si z vybrané šablony VLASTNÍ kopii.
 *
 * Nepropojuje se přímo s knihovní šablonou. Kdyby ano, mířil by editor obsahu
 * kampaně do ní a psaní jednoho newsletteru by přepisovalo šablonu, kterou má
 * uživatel uloženou pro příště.
 */
export async function startCampaignFromTemplateAction(input: {
  workspaceId: string;
  name: string;
  templateId: string;
}): Promise<StartCampaignResult> {
  const source = await readTemplateDocument(input.workspaceId, input.templateId);
  // Čte se PŘED založením kampaně: nedostupná šablona by jinak nechala
  // v seznamu prázdnou kampaň, kterou si nikdo nevyžádal.
  if (!source.ok) return { status: 'error', code: source.code };

  const draft = await createDraft(input.workspaceId, input.name);
  if (!draft.ok) return { status: 'error', code: draft.code };

  const working = await createWorkingCopy({
    workspaceId: input.workspaceId,
    campaignId: draft.id,
    campaignName: input.name,
    document: source.document,
  });
  revalidatePath(CAMPAIGNS_PATH, 'page');
  if (!working.ok) return { status: 'error', code: working.code };
  return { status: 'success', campaignId: draft.id, templateId: working.templateId };
}

/**
 * Založení pracovního obsahu kampani, která žádný nemá.
 *
 * Potřebují to kampaně z doby před tímhle uspořádáním (`template_id` je NULL
 * a obsah nemají kde vzniknout) a kampaně, u kterých založení obsahu poprvé
 * selhalo. Bez téhle akce by v kroku obsahu zbyla jen věta „kampaň nemá
 * šablonu" a žádná cesta ven.
 */
export async function createCampaignContentAction(input: {
  workspaceId: string;
  campaignId: string;
  campaignName: string;
  locale: string;
}): Promise<StartCampaignResult> {
  const working = await createWorkingCopy({
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    campaignName: input.campaignName,
    document: blankEmailDocument(input.locale, input.campaignName),
  });
  revalidatePath(CAMPAIGN_DETAIL_PATH, 'page');
  if (!working.ok) return { status: 'error', code: working.code };
  return { status: 'success', campaignId: input.campaignId, templateId: working.templateId };
}

/* ------------------------------------------------------------------------ *
 * Smazání kampaně
 * ------------------------------------------------------------------------ */

export type DeleteCampaignResult =
  | { status: 'success' }
  /**
   * `campaignStatus` chodí ze serveru v `params` a je jediný způsob, jak
   * u kódu `conflict` poznat, co se s kampaní má stát dřív: naplánovanou stačí
   * odplánovat, běžící pozastavit a zrušit, odeslanou nesmaže nikdy nic.
   */
  | { status: 'error'; code: string; campaignStatus: string | null; detail: string };

/**
 * Smazání kampaně do koše.
 *
 * Je to MĚKKÉ smazání: řádek v databázi zůstává a jen ho všechna čtení
 * přeskočí. Cizí klíče proto nikde nepadají, protože se vůbec nevyhodnocují,
 * a chyba 23503 tudy vzniknout nemůže. Zámek na odesílací doméně tu ale
 * překážel jinak: kampaň v koši doménu držela dál, takže ji pak nešlo odebrat.
 * Jádro proto při mazání odesílací účet i doménu od kampaně odpojuje.
 *
 * Obnova z koše neexistuje, žádná cesta API ji neumí. Dialog to říká nahlas,
 * místo aby sliboval košík, ze kterého se nic nevrací.
 */
export async function deleteCampaignAction(input: {
  workspaceId: string;
  campaignId: string;
}): Promise<DeleteCampaignResult> {
  const result = await apiMutate<undefined>(`/api/v1/campaigns/${input.campaignId}`, {
    method: 'DELETE',
    workspaceId: input.workspaceId,
  });
  if (!result.ok) {
    const params = result.problem.params ?? {};
    return {
      status: 'error',
      code: result.problem.code,
      campaignStatus: typeof params['status'] === 'string' ? params['status'] : null,
      detail: result.problem.detail,
    };
  }
  // Obě cesty: seznam i detail smazané kampaně. Bez první by smazaná kampaň
  // v seznamu visela až do tvrdé obnovy stránky.
  revalidatePath(CAMPAIGNS_PATH, 'page');
  revalidatePath(CAMPAIGN_DETAIL_PATH, 'page');
  return { status: 'success' };
}

/**
 * Duplikace kampaně. Kopie je vždycky `draft` se jménem „… (kopie)".
 *
 * ENDPOINT EXISTOVAL BEZ VOLAJÍCÍHO. `POST /campaigns/{id}/duplicate` je v jádru
 * od začátku a kopíruje i pracovní obsah, aby úprava kopie nepřepsala předlohu
 * (`packages/core/src/campaigns/api/service.ts:444`). V rozhraní pro něj do 6. 8. 2026
 * neexistovalo jediné tlačítko: jediný odkaz, který se jako duplikace tvářil, vedl
 * z reportu na `/campaigns/new?duplicate={id}`, což je adresa, jejíž stránka ten
 * parametr vůbec nečte, takže se otevřel prázdný průvodce.
 *
 * Vrací id KOPIE, ne předlohy. Bez něj by se uživatel po duplikaci nedozvěděl, že
 * se něco stalo: kopie se v seznamu objeví mezi ostatními a nic ji neoznačuje.
 */
export async function duplicateCampaignAction(input: {
  workspaceId: string;
  campaignId: string;
}): Promise<{ status: 'success'; campaignId: string } | { status: 'error'; code: string }> {
  const result = await apiMutate<{ id: string }>(
    `/api/v1/campaigns/${input.campaignId}/duplicate`,
    {
      method: 'POST',
      workspaceId: input.workspaceId,
      // Prázdné tělo ze stejného důvodu jako u `control` níž: bez `Content-Type`
      // vrací kostra API 415 a obrazovka mlčí.
      body: {},
    },
  );
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(CAMPAIGNS_PATH, 'page');
  return { status: 'success', campaignId: result.data.id };
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
 * Přeskočení odpočtu, tedy tlačítko „Odeslat teď".
 *
 * NENÍ to jen ukončení čekání v prohlížeči. Odpočet je odložený start
 * na serveru: materializace zapsala každé zprávě `next_attempt_at = release_at`
 * a odesílací proces si ji do té chvíle nevezme. Akce tedy volá server, který
 * ten čas posune na teď; bez toho by prohlížeč přestal počítat a nic by se
 * nezměnilo.
 *
 * Je to NEVRATNÉ: jakmile se okno uzavře, vzít odeslání zpět už nejde.
 */
export async function sendCampaignNowAction(input: {
  workspaceId: string;
  campaignId: string;
}): Promise<ActionResult> {
  return control(input.workspaceId, input.campaignId, 'send-now');
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

  /*
   * JMÉNO SE TUDY UŽ NEUKLÁDÁ. Má vlastní akci `renameCampaignAction`, kterou
   * volá pole v hlavičce obou kroků, a vlastní podmínku `canRenameCampaign`.
   *
   * Dokud jméno jezdilo tímhle formulářem, nešlo ho u čerstvé kampaně uložit
   * vůbec: validace níž běží nad celým formulářem, takže přejmenování spadlo
   * na prázdném předmětu a prázdném publiku, tedy na věcech, které s ním
   * nesouvisí. Vyjmutí z validace by nestačilo, `PATCH` by jméno stejně
   * posílal a u naplánované kampaně by celé uložení narazilo na
   * `campaign_locked`.
   */
  const subject = text(formData, 'subject');
  const preheader = text(formData, 'preheader');
  const fromName = text(formData, 'from_name');
  const fromEmail = text(formData, 'from_email');
  const replyTo = text(formData, 'reply_to');
  const includeLists = ids(formData, 'include_list');
  const includeSegments = ids(formData, 'include_segment');

  const issues: Issue[] = [];
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

  const providerId = optionalId(formData, 'provider_id');
  const senderDomainId = optionalId(formData, 'sender_domain_id');

  const body: Record<string, unknown> = {
    subject,
    preheader,
    from_name: fromName,
    /*
     * `template_id` se ODSUD NEPOSÍLÁ. Obsah kampaně je věc kampaně a její
     * pracovní kopii vlastní krok obsahu, ne formulář nastavení.
     *
     * Dokud tu ten klíč byl, byla to past: rozbalovací seznam nabízel jen
     * knihovní šablony, takže pracovní kopie mezi jeho položkami nikdy nebyla,
     * a první uložení nastavení by poslalo zástupnou hodnotu „nevybráno".
     * `template_id` by se vynulovalo, tlačítko do editoru by zmizelo a obsah
     * kampaně by zůstal viset bez čehokoli, čím ho upravit.
     */
    provider_id: providerId,
    sender_domain_id: senderDomainId,
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

  /*
   * ODKAZ NA ULOŽENOU PŘEDVOLBU ODESÍLATELE se odvozuje z HODNOT, ne přenáší
   * z minula.
   *
   * `sender_identity_id` je poznámka „těchhle pět údajů vzniklo z předvolby X".
   * Formulář ta pole pouští k ruční úpravě, takže bez odvození by poznámka
   * zůstala viset i nad adresou, kterou uživatel přepsal, a rozbalovací seznam
   * by nad kampaní ukazoval cizí jméno. Když se údaje s předvolbou rozejdou,
   * zapíše se `null` a seznam poctivě spadne na „Vyplněno ručně".
   *
   * PRÁZDNÝ SEZNAM OTISKŮ ZNAMENÁ „NEVÍM", ne „žádná předvolba nesedí". Stane
   * se to jedině tehdy, když se seznam předvoleb nepodařilo načíst; nulovat
   * kvůli výpadku číselníku uložený odkaz by byla ztráta dat za nic, takže se
   * klíč v tom případě neposílá vůbec a v databázi zůstane, jak byl.
   */
  const identities = decodeSenderIdentityFingerprints(text(formData, 'sender_identity_options'));
  if (identities.length > 0) {
    body['sender_identity_id'] = matchSenderIdentity(
      identities,
      senderFingerprint({
        from_name: fromName,
        from_email: fromEmail,
        reply_to: replyTo === '' ? null : replyTo,
        provider_id: providerId,
        sender_domain_id: senderDomainId,
      }),
      text(formData, 'sender_identity_id'),
    );
  }

  const result = await apiMutate<{ id: string }>(instance, {
    method: 'PATCH',
    workspaceId,
    body,
  });
  if (!result.ok) return failed('inline', result.problem);

  /*
   * Kompilace hned po uložení. Je to jediná cesta, kterou se uživatel z rozhraní
   * dostane k odeslatelné kampani: bez `compiled_html` hlásí předletová kontrola
   * `campaign_not_compiled` navždy a tlačítko Odeslat zůstane zamčené.
   *
   * Volá se jen tehdy, když kampaň OBSAH MÁ. Bez obsahu vrací kompilace
   * `campaign_not_compiled` při každém uložení, tedy chybu u kroku, který se
   * obsahu vůbec netýkal. Že obsah chybí, řekne kontrolní seznam.
   *
   * Rozhoduje skryté pole `has_design`, které nese odpověď serveru. Dřív se
   * tu četlo `template_id` z těla požadavku, jenže to už se neposílá a hlavně
   * to nikdy nebyla ta správná otázka: kampaň může mít `template_id` a přitom
   * `design` prázdný, když založení obsahu selhalo.
   *
   * Ptá se na DOKUMENT, ne na to, jestli v něm něco je. Zkompilovat se má
   * i prázdný e-mail: kompilace je technický krok a to, že je e-mail prázdný,
   * říká krok obsahu i kontrola před odesláním, ne chyba při ukládání.
   *
   * Chyba kompilace se ukazuje, netlumí. Je to skutečná vada obsahu (rozbitý
   * dokument, smazané pole) a nastavení už uložené je, takže se o ni nepřijde.
   */
  if (formData.get('has_design') === 'true') {
    const compiled = await apiMutate<unknown>(`${instance}/compile`, {
      method: 'POST',
      workspaceId,
      body: {},
    });
    if (!compiled.ok) {
      revalidatePath(CAMPAIGN_DETAIL_PATH, 'page');
      return failed('inline', compiled.problem);
    }
  }

  revalidatePath(CAMPAIGN_DETAIL_PATH, 'page');
  revalidatePath(CAMPAIGNS_PATH, 'page');
  return succeeded({ channel: 'inline', messageKey: 'settings.saved' });
}

/**
 * Přejmenování kampaně z hlavičky obrazovky.
 *
 * SAMOSTATNÁ AKCE, ne `updateCampaignSettingsAction` s jedním polem. Ta akce
 * posílá celý stav formuláře (předmět, odesílatele, publikum, měření) a po
 * uložení ještě kompiluje obsah. Z kroku 1 přitom žádný formulář neexistuje,
 * takže by se musely dopisovat hodnoty, o kterých hlavička nic neví, a
 * přejmenování by mohlo spadnout na chybě publika, se kterým nemá co dělat.
 *
 * `PATCH` s jediným klíčem `name` je zároveň jediný tvar, který projde
 * u NAPLÁNOVANÉ kampaně: `EDITABLE_WHILE_SCHEDULED` v doméně povoluje mimo
 * `draft` a `schedule_missed` právě `name`, `scheduled_at` a `schedule_timezone`.
 * Klíč navíc by celý požadavek shodil na `campaign_locked`.
 *
 * Meze se tu ZÁMĚRNĚ NEKONTROLUJÍ: hlídá je obrazovka (stejné hlášky jako
 * krok 2) a schéma `PatchCampaignRequest` na serveru (`min(1).max(200)`).
 * Třetí kopie pravidla by se jen rozešla s oběma.
 */
export async function renameCampaignAction(input: {
  workspaceId: string;
  campaignId: string;
  name: string;
}): Promise<ActionResult> {
  const result = await apiMutate<unknown>(`/api/v1/campaigns/${input.campaignId}`, {
    method: 'PATCH',
    body: { name: input.name.trim() },
    workspaceId: input.workspaceId,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  /*
   * Jméno kampaně nese seznam kampaní, detail i drobečky nad editorem. Bez
   * obou cest by se uživatel po přejmenování vrátil na krok 2 nebo do seznamu
   * a viděl tam jméno staré, přestože v databázi je nové.
   */
  revalidatePath(CAMPAIGN_DETAIL_PATH, 'page');
  revalidatePath(CAMPAIGNS_PATH, 'page');
  return { status: 'success' };
}

/* ------------------------------------------------------------------------ *
 * Obsah kampaně a knihovna šablon
 * ------------------------------------------------------------------------ */

/**
 * Převzetí knihovní šablony do obsahu kampaně.
 *
 * Jde to přes PRACOVNÍ KOPII kampaně, ne přímým propojením s knihovní šablonou.
 * Kdyby se `template_id` přesměrovalo na knihovní šablonu, otevřel by editor
 * obsahu kampaně tu šablonu a další úprava kampaně by ji přepsala. Proto se
 * dokument nejdřív zapíše do pracovní kopie kampaně a teprve ta se na kampaň
 * použije; knihovní šablona se od té chvíle vůbec neúčastní.
 *
 * Tři kroky, ne jeden, protože jeden koncový bod pro „vezmi cizí dokument,
 * ulož ho jako můj a zkompiluj" neexistuje. Rozpad je vidět i v chybách:
 * kterýkoli krok může selhat sám a hlášení pak míří na to, co se nepovedlo.
 *
 * `overwritten` je údaj ze serveru, ne odhad z toho, co obrazovka viděla
 * před kliknutím.
 */
export async function useLibraryTemplateAction(input: {
  workspaceId: string;
  campaignId: string;
  /** Pracovní kopie kampaně, tedy `campaigns.template_id`. */
  workingCopyId: string;
  /** Šablona z knihovny, ze které se obsah bere. */
  templateId: string;
}): Promise<{ status: 'success'; overwritten: boolean } | { status: 'error'; code: string }> {
  const source = await readTemplateDocument(input.workspaceId, input.templateId);
  if (!source.ok) return { status: 'error', code: source.code };

  /*
   * `if_design_hash` se schválně NEPOSÍLÁ. Optimistický zámek chrání před tím,
   * aby si dva editoři přepsali práci, jenže tady uživatel VÝSLOVNĚ řekl
   * „přepiš obsah šablonou" a hash by musel přijít z obrazovky, která ho nemá.
   * Potvrzovací dialog před tím je ta správná pojistka, ne 412 bez vysvětlení.
   */
  const written = await apiMutate<{ id: string }>(`/api/v1/templates/${input.workingCopyId}`, {
    method: 'PATCH',
    workspaceId: input.workspaceId,
    body: { design: source.document },
  });
  if (!written.ok) return { status: 'error', code: written.problem.code };

  const applied = await apiMutate<{ overwritten: boolean }>(
    `/api/v1/campaigns/${input.campaignId}/apply-template`,
    {
      method: 'POST',
      workspaceId: input.workspaceId,
      body: { template_id: input.workingCopyId },
    },
  );
  revalidatePath(CAMPAIGN_DETAIL_PATH, 'page');
  revalidatePath(CAMPAIGNS_PATH, 'page');
  if (!applied.ok) return { status: 'error', code: applied.problem.code };
  return { status: 'success', overwritten: applied.data.overwritten };
}

/**
 * Uložení obsahu kampaně do knihovny šablon. VÝSLOVNÁ akce, nikdy ne mimoděk.
 *
 * Vzniká NOVÝ řádek `kind = 'campaign'`, ne odkaz. Od té chvíle jsou kampaň
 * a šablona dvě nezávislé věci: pozdější úprava kampaně uloženou šablonu
 * nezmění a úprava šablony nezmění kampaň. Přesně to zadání vyžaduje a je to
 * i jediný tvar, který snese odeslaná kampaň, protože ta se měnit nesmí vůbec.
 *
 * Bere se dokument PRACOVNÍ KOPIE, tedy to, co uživatel vidí v editoru.
 * `campaigns.design` je jeho kopie pořízená posledním převzetím obsahu a mohla
 * by být starší; uložit do knihovny něco jiného, než je na obrazovce, by byla
 * tichá záměna.
 */
export async function saveCampaignContentAsTemplateAction(input: {
  workspaceId: string;
  /** Pracovní kopie kampaně, tedy `campaigns.template_id`. */
  workingCopyId: string;
  name: string;
}): Promise<{ status: 'success'; templateId: string } | { status: 'error'; code: string }> {
  const name = input.name.trim();
  if (name === '' || name.length > 120) return { status: 'error', code: 'validation_failed' };

  const source = await readTemplateDocument(input.workspaceId, input.workingCopyId);
  if (!source.ok) return { status: 'error', code: source.code };

  const created = await apiMutate<{ id: string }>('/api/v1/templates', {
    method: 'POST',
    workspaceId: input.workspaceId,
    // `kind` se neuvádí, výchozí je `campaign`. Šablona v knihovně je šablona
    // uživatele, ne pracovní obsah, takže tady `system` být nesmí.
    body: { name, document: source.document },
  });
  if (!created.ok) return { status: 'error', code: created.problem.code };
  // Knihovna šablon je jiná cesta než kampaň, takže ji `router.refresh()`
  // ze stránky kampaně nepřekreslí. Bez tohohle by tam nová šablona chyběla
  // až do tvrdé obnovy a uživatel by uložil podruhé.
  revalidatePath(TEMPLATES_PATH, 'page');
  return { status: 'success', templateId: created.data.id };
}
