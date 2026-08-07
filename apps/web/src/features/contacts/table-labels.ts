'use client';

import { useFormatter, useTranslations } from 'next-intl';
import type { DataTableLabels } from '@mlain/ui/patterns/data-table';

/**
 * Popisky pro `DataTable` (K1) v jazyce rozhraní.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM. Plán počítal s propy `caption`, `selectAllLabel`,
 * `rowSelectionLabel(row)`, `selectedIds` a `cursor: { nextHref, prevHref }`. Komponenta,
 * kterou P05 skutečně dodal, bere jeden objekt `labels`, popisek řádku je **jeden řetězec
 * pro všechny řádky** (ne funkce nad řádkem) a stránkuje callbacky `onPrevious`/`onNext`,
 * ne odkazy. Tenhle soubor je přechodka mezi katalogem a tím tvarem.
 */
export function useContactsTableLabels(namespaceKeys: {
  selectRow: string;
  selectAllOnPage: string;
  /**
   * Jak má pruh výběru pojmenovat, co je vybrané.
   *
   * `'contacts'` je výchozí a mluví o kontaktech („Vybrán 1 kontakt na této
   * stránce"). `'generic'` bere věty z `common.table`, které žádné podstatné
   * jméno nemají („Vybráno na této stránce: 1").
   *
   * PROČ TO TU JE. Tenhle hook si berou i obrazovky, které s kontakty nemají nic
   * společného: Seznamy, Formuláře, Vlastní pole, Přepisy jmen a Blokované adresy.
   * Do 7. 8. 2026 jim tedy pruh nad tabulkou hlásil „Vybrány 2 kontakty na této
   * stránce" a hned vedle stálo tlačítko „Smazat 2 formuláře". Obecné znění
   * v `common.table` se toho dne zkrátilo právě proto, jenže sem nedosáhlo:
   * tyhle obrazovky si berou znění z `contacts.selection`.
   */
  selectionWording?: 'contacts' | 'generic';
}): DataTableLabels {
  const t = useTranslations('contacts');
  // Zavření panelu sloupců je obecná akce, ne pojem kontaktů, takže má klíč
  // v `common`. Bez něj panel nemá čím zavřít, když si spouštěč drží obrazovka.
  const tCommon = useTranslations('common');
  const format = useFormatter();

  return {
    selectRow: namespaceKeys.selectRow,
    selectAllOnPage: namespaceKeys.selectAllOnPage,
    previous: t('list.previousPage'),
    next: t('list.nextPage'),
    // Vlnovka jen u odhadovaného počtu. U přesného by byla lež opačným směrem
    // (kapitola 60 plánu, princip P7 části 6).
    showing: (shown, total, estimated) =>
      estimated
        ? t('list.shown', { shown: format.number(shown), total: format.number(total) })
        : t('list.shownExact', { shown: format.number(shown), total: format.number(total) }),
    ...(namespaceKeys.selectionWording === 'generic'
      ? {
          selectedOnPage: (count: number) => tCommon('table.selectedOnPage', { count }),
          selectAllMatching: (total: number) => tCommon('table.selectAllMatching', { total }),
          selectedAllMatching: (total: number) => tCommon('table.selectedAllMatching', { total }),
        }
      : {
          selectedOnPage: (count: number) => t('selection.pageOnly', { count }),
          selectAllMatching: (total: number) => t('selection.selectAllMatching', { total }),
          selectedAllMatching: (total: number) => t('selection.allMatching', { total }),
        }),
    clearSelection: t('selection.clear'),
    cursorInvalid: t('list.staleCursor'),
    sortNotAvailable: t('list.sortNotAvailable'),
    sortedAscending: t('list.sortedAscending'),
    sortedDescending: t('list.sortedDescending'),
    columnSettings: t('list.columnSettings'),
    closeColumnSettings: tCommon('actions.close'),
    columnVisible: (column) => t('list.columnVisible', { column }),
  };
}
