/**
 * Co se se segmentem dá dělat a kam vedou jeho akce.
 *
 * JEDNO MÍSTO, stejně jako `campaigns/campaign-state.ts`. Podmínky segmentu jsou
 * jednodušší než u kampaně, ale platí pro ně totéž pravidlo: rozhodnutí, co se
 * v řádku nabídne, nesmí bydlet v komponentě, kde se nedá zkoušet bez Reactu
 * a bez katalogu překladů, a nesmí se opsat podruhé na detailu.
 *
 * Soubor je schválně BEZ `'use client'` a bez komponent: adresu do kontaktů
 * potřebuje i serverová stránka, kdyby na ni odkazovala odjinud.
 *
 * Vrací klíče akcí, ne texty a ne komponenty.
 */

import { contactsHref } from '../contacts/filters';

/** Akce nabízené v řádku seznamu segmentů. Pořadí je pořadím v nabídce. */
export type SegmentRowAction = 'recount' | 'viewContacts' | 'edit' | 'delete';

/**
 * Práva přihlášeného člověka. Počítá je stránka přes `hasPermission`, seznam je
 * jen předává dál: klientská komponenta se na role ptát nemá.
 */
export type SegmentPermissions = {
  /**
   * `segments:write`. Drží úpravu, smazání i PŘEPOČET: `POST /segments/{id}/recount`
   * si v `segments.routes.ts:549` vyžádá zápis, přestože se čtenáři jeví jako čtení.
   * Do 6. 8. 2026 se přepočet nabízel všem a čtenáři skončil na 403.
   */
  write: boolean;
  /** `contacts:read`, bez něj nemá „Zobrazit kontakty" kam vést. */
  readContacts: boolean;
};

/**
 * Které akce dávají u tohohle segmentu smysl.
 *
 * CO NEDÁVÁ SMYSL, SE NENABÍZÍ, ne zašedle. Prázdné pole znamená, že se nekreslí
 * ani spouštěč nabídky.
 */
export function segmentRowActions(permissions: SegmentPermissions): SegmentRowAction[] {
  const actions: SegmentRowAction[] = [];
  if (permissions.write) actions.push('recount');
  if (permissions.readContacts) actions.push('viewContacts');
  if (permissions.write) actions.push('edit', 'delete');
  return actions;
}

/** Akce, které se v nabídce oddělují čarou a kreslí červeně. */
export const DESTRUCTIVE_SEGMENT_ACTIONS: readonly SegmentRowAction[] = ['delete'];

/**
 * Seznam kontaktů zúžený na tenhle segment.
 *
 * Skládá ho `contactsHref` z domény kontaktů, ne vlastní šablona řetězce: filtry
 * kontaktů žijí v URL a jejich jména vlastní `contacts/filters.ts`. Druhá kopie
 * názvu parametru by se rozešla první změnou filtru a poznalo by se to až tím,
 * že odkaz otevře nefiltrovaný seznam všech kontaktů.
 */
export function segmentContactsHref(workspaceSlug: string, segmentId: string): string {
  return contactsHref(`/w/${workspaceSlug}/contacts`, { segment_id: segmentId });
}
