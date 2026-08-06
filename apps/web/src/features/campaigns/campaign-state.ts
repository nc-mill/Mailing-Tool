/**
 * Co se s kampaní v daném stavu smí dělat.
 *
 * JEDNO MÍSTO, NE ČTVRTÁ KOPIE. Do 6. 8. 2026 byl výčet stavů, ve kterých se dá
 * upravovat obsah, opsaný ve dvou stránkách (`campaigns/[id]/page.tsx`
 * a `campaigns/[id]/content/page.tsx`) a výčet stavů, ze kterých se kampaň smaže,
 * ve dvou dalších souborech (`campaign-list.tsx`, `delete-campaign-section.tsx`).
 * Řádková nabídka by z obojího udělala pátou a šestou kopii. Rozejité kopie téhle
 * povahy nás v tomhle repozitáři potkaly opakovaně a poznají se vždycky až tím, že
 * rozhraní nabídne akci, kterou server odmítne.
 *
 * Soubor je schválně BEZ `'use client'` a bez komponent, stejně jako sousední
 * `campaign-target.ts` a `campaign-rename.ts`: ptají se ho i serverové stránky,
 * když rozhodují, co vůbec vykreslit. Kdyby bydlel v klientské komponentě, Next.js
 * by volání ze serveru odmítl.
 *
 * Vrací klíče akcí, ne texty a ne komponenty. Dá se tedy testovat bez React
 * kontextu a bez katalogu překladů, stejně jako `contacts/contact-state.ts`.
 */

import { canRenameCampaign } from './campaign-rename';

/**
 * Stavy, ve kterých se dá upravovat OBSAH kampaně.
 *
 * Naplánovaná kampaň tu schválně není: ve stavu `scheduled` je obsah zamčený
 * (`packages/core/src/campaigns/control/schedule.ts:65`), jinak by kampaň odešla
 * s obsahem, který nikdo neviděl v náhledu. Cesta ven je „Zrušit plán".
 */
const CONTENT_EDITABLE_STATUSES = new Set(['draft', 'schedule_missed']);

/**
 * Stavy, ze kterých API kampaň smaže. TÝŽ výčet jako `DELETABLE_STATUSES`
 * v jádru (`packages/core/src/campaigns/api/service.ts:338`): kampaň, ze které
 * něco odešlo, se nemaže nikdy.
 */
const DELETABLE_STATUSES = new Set(['draft', 'schedule_missed']);

/** Stavy, ve kterých rozesílka běží a dá se pozastavit. */
const PAUSABLE_STATUSES = new Set(['queueing', 'sending']);

/**
 * Stavy, ze kterých se dá zrušit ZBYTEK rozesílky.
 *
 * ODCHYLKA OD API, A JE ÚMYSLNÁ. `packages/core/src/campaigns/control/cancel.ts:27`
 * pustí zrušení i u `scheduled` a `schedule_missed`. V řádkové nabídce se tam
 * NENABÍZÍ: u naplánované kampaně je správná odpověď „Zrušit plán", po které je
 * z kampaně zase koncept a dá se smazat. Postavit vedle sebe vratnou a nevratnou
 * akci, které dělají skoro totéž, je past na uživatele.
 */
const CANCELLABLE_STATUSES = new Set(['queueing', 'sending', 'paused']);

export function canEditCampaignContent(status: string): boolean {
  return CONTENT_EDITABLE_STATUSES.has(status);
}

export function canDeleteCampaign(status: string): boolean {
  return DELETABLE_STATUSES.has(status);
}

/** Akce nabízené v řádku seznamu kampaní. Pořadí je pořadím v nabídce. */
export type CampaignRowAction =
  'editContent' | 'rename' | 'duplicate' | 'unschedule' | 'pause' | 'resume' | 'cancel' | 'delete';

export type CampaignStateInput = {
  /** Výčet stavů je OTEVŘENÝ (část 4a, 4.1.1), proto `string`, ne sjednocení. */
  status: string;
  /**
   * Pracovní obsah kampaně. Bez něj nemá „Upravit obsah" co otevřít; stránka
   * kroku 1 dělá tutéž kontrolu, než odkaz do editoru vůbec vykreslí.
   */
  template_id: string | null;
  /**
   * Proč je kampaň pozastavená. Server odmítne `resume` u kampaně zastavené
   * poskytovatelem (`campaigns.routes.ts:915`), takže se v takovém řádku položka
   * nenabízí vůbec. Odpověď seznamu ho nese, dotahovat se nic nemusí.
   */
  pause_reason: unknown;
};

/**
 * Práva přihlášeného člověka. Počítá je stránka přes `hasPermission`, tabulka je
 * jen předává dál: klientská komponenta se na role ptát nemá.
 */
export type CampaignPermissions = {
  /** `templates:write`, obsah kampaně je řádek v `templates`. */
  editContent: boolean;
  /** `campaigns:write`, tedy `PATCH /campaigns/{id}` a duplikace. */
  write: boolean;
  /** `campaigns:send`, tedy zrušení plánu. */
  send: boolean;
  /** `campaigns:control`, tedy pozastavení, pokračování a zrušení rozesílky. */
  control: boolean;
  /** `campaigns:delete`. */
  remove: boolean;
};

/** Je kampaň zastavená poskytovatelem, tedy `resume` skončí na 422? */
function blockedByProvider(pauseReason: unknown): boolean {
  if (typeof pauseReason !== 'object' || pauseReason === null) return false;
  return (pauseReason as { code?: unknown }).code === 'provider_blocked';
}

/**
 * Které akce dávají u téhle kampaně smysl.
 *
 * CO NEDÁVÁ SMYSL, SE NENABÍZÍ, ne zašedle: zašedlá položka bez vysvětlení je
 * zakázaná (kritérium 18 části 6) a vysvětlení, proč zrovna tuhle kampaň nejde
 * smazat, se do řádku tabulky nevejde. Patří na detail, kde je vidět celý stav.
 *
 * Prázdné pole znamená, že se nekreslí ani spouštěč nabídky.
 */
export function campaignRowActions(
  campaign: CampaignStateInput,
  permissions: CampaignPermissions,
): CampaignRowAction[] {
  const actions: CampaignRowAction[] = [];
  const { status } = campaign;

  if (permissions.editContent && canEditCampaignContent(status) && campaign.template_id !== null) {
    actions.push('editContent');
  }
  if (permissions.write && canRenameCampaign(status)) actions.push('rename');
  /*
   * Duplikovat jde kampaň v JAKÉMKOLI stavu, včetně odeslané a zrušené.
   * `duplicateCampaign` v jádru se stavu neptá, filtruje jen smazané a pracovní
   * kopie, a kopie vzniká vždycky jako `draft`. U odeslané kampaně je to navíc
   * jediná akce, která tam vůbec zbývá: opakované odeslání téže kampaně stav
   * neumožňuje schválně, protože je to nejčastější příčina odhlášení.
   */
  if (permissions.write) actions.push('duplicate');
  if (permissions.send && status === 'scheduled') actions.push('unschedule');
  if (permissions.control && PAUSABLE_STATUSES.has(status)) actions.push('pause');
  if (permissions.control && status === 'paused' && !blockedByProvider(campaign.pause_reason)) {
    actions.push('resume');
  }
  if (permissions.control && CANCELLABLE_STATUSES.has(status)) actions.push('cancel');
  if (permissions.remove && canDeleteCampaign(status)) actions.push('delete');

  return actions;
}

/**
 * Akce, které se v nabídce oddělují čarou a kreslí červeně. Zrušení rozesílky je
 * mezi nimi schválně: zbytek příjemců e-mail nedostane a vrátit to nejde.
 */
export const DESTRUCTIVE_CAMPAIGN_ACTIONS: readonly CampaignRowAction[] = ['cancel', 'delete'];
