/**
 * Co se se seznamem dá dělat.
 *
 * JEDNO MÍSTO, stejně jako `campaigns/campaign-state.ts`, `segments/segment-state.ts`,
 * `templates/template-state.ts` a `forms/form-state.ts`. Soubor je schválně BEZ
 * `'use client'` a bez komponent, takže se tabulka dá zkoušet bez Reactu a bez
 * katalogu překladů, a ptát se jí může i serverová stránka.
 */

import { contactsHref } from './filters';

/** Akce nabízené v řádku seznamu. Pořadí je pořadím v nabídce. */
export type ListRowAction = 'viewContacts' | 'edit' | 'setDefault' | 'confirmPending' | 'archive';

export type ListStateInput = {
  /** Je to výchozí seznam projektu? Tomu se „Nastavit jako výchozí" nenabízí. */
  is_default: boolean;
  /**
   * Archivovaný seznam. `setDefault` v jádru volá `requireLive`, takže by na
   * archivovaném skončil chybou, a archivovat ho podruhé nejde vůbec.
   */
  archived: boolean;
  /** Dvojí potvrzení. Bez něj žádná přihlášení nečekají a potvrzovat není co. */
  double_opt_in: boolean;
  /** Kolik přihlášení čeká na potvrzení. */
  pending_count: number;
};

/**
 * Které akce dávají u tohohle seznamu smysl.
 *
 * CO NEDÁVÁ SMYSL, SE NENABÍZÍ, ne zašedle:
 *  - výchozímu seznamu se „Nastavit jako výchozí" nenabízí, protože už je,
 *  - archivovanému se nenabízí ani to, ani archivace znovu,
 *  - „Potvrdit čekající" má smysl jen u dvojího potvrzení s nenulovým počtem;
 *    u jednokrokového seznamu nikdo nečeká a položka by vždycky potvrdila nulu.
 *
 * Prázdné pole znamená, že se nekreslí ani spouštěč nabídky.
 */
export function listRowActions(
  list: ListStateInput,
  permissions: { write: boolean; readContacts: boolean },
): ListRowAction[] {
  const actions: ListRowAction[] = [];
  if (permissions.readContacts) actions.push('viewContacts');
  if (permissions.write) actions.push('edit');
  if (permissions.write && !list.is_default && !list.archived) actions.push('setDefault');
  if (permissions.write && list.double_opt_in && list.pending_count > 0) {
    actions.push('confirmPending');
  }
  if (permissions.write && !list.archived) actions.push('archive');
  return actions;
}

/**
 * Seznam kontaktů zúžený na tenhle seznam.
 *
 * Skládá ho `contactsHref` z domény kontaktů, ne vlastní šablona řetězce: filtry
 * kontaktů žijí v URL a jejich jména vlastní `filters.ts`. Druhá kopie názvu
 * parametru by se rozešla první změnou filtru a poznalo by se to až tím, že
 * odkaz otevře nefiltrovaný seznam všech kontaktů.
 */
export function listContactsHref(workspaceSlug: string, listId: string): string {
  return contactsHref(`/w/${workspaceSlug}/contacts`, { list_id: listId });
}

/**
 * Akce, které se v nabídce oddělují čarou a kreslí červeně.
 *
 * ARCHIVACE JE TO, ČEMU SE JINDE ŘÍKÁ SMAZÁNÍ: jiné mazání seznamu produkt nemá,
 * `DELETE /lists/{id}` nastaví `deleted_at` a seznam zmizí ze všech nabídek.
 * Proto stojí červeně za oddělovačem, i když se nejmenuje „Smazat".
 */
export const DESTRUCTIVE_LIST_ACTIONS: readonly ListRowAction[] = ['archive'];
