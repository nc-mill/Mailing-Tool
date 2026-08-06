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
    selectedOnPage: (count) => t('selection.pageOnly', { count }),
    selectAllMatching: (total) => t('selection.selectAllMatching', { total }),
    selectedAllMatching: (total) => t('selection.allMatching', { total }),
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
