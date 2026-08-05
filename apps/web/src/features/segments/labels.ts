import type { QueryBuilderLabels } from '@mlain/ui/patterns/query-builder';
import type { DataTableLabels } from '@mlain/ui/patterns/data-table';

export type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * Popisky K2. Všechny klíče má komponenta jako povinné, protože do
 * `packages/ui` se texty nepíšou. Katalog je `segments`, ne `common`.
 */
export function builderLabels(t: Translate): QueryBuilderLabels {
  return {
    addRule: t('builder.addCondition'),
    addGroup: t('builder.addGroup'),
    removeRule: t('builder.removeCondition'),
    removeGroup: t('builder.removeCondition'),
    chooseField: t('builder.fieldLabel'),
    chooseOperator: t('builder.operatorLabel'),
    value: t('builder.valueLabel'),
    valueFrom: t('builder.valueLabel'),
    valueTo: t('builder.valueLabel'),
    valueList: t('builder.valueLabel'),
    // Vlastní klíč, ne „Přidat podmínku". Ve výběru hodnoty je to úvodní
    // položka rozbalovacího seznamu a nabízet tam „Přidat podmínku" mátlo.
    addValue: t('builder.addValue'),
    removeValue: (item) => t('builder.removeValue', { value: item }),
    listLimit: (max) => t('builder.listLimit', { limit: max }),
    unknownValue: (value) => t('builder.unknownValue', { value }),
    noOptions: t('builder.noOptions'),
    rangeOrder: t('builder.valueLabel'),
    showJson: t('builder.showJson'),
    depthLimit: t('builder.noDeeper'),
    childLimit: t('limits.tooComplex', { limit: 50 }),
    negationHint: t('builder.negationHint.andNot'),
    notNullHint: t('notNullHint'),
    addEmptyCondition: t('addEmptyCondition'),
    all: t('builder.quantifier.all'),
    atLeastOne: t('builder.quantifier.any'),
    is: t('builder.polarity.match'),
    isNot: t('builder.polarity.notMatch'),
  };
}

/**
 * Popisky K1 pro tabulku kontaktů segmentu. Bere dva překladače, protože
 * obecné texty tabulky vlastní katalog `common` (P05) a doménové `segments`.
 */
export function contactTableLabels(common: Translate, segments: Translate): DataTableLabels {
  return {
    selectRow: common('table.selectRow'),
    selectAllOnPage: common('table.selectAllOnPage'),
    previous: common('table.previous'),
    next: common('table.next'),
    showing: (shown, total, estimated) =>
      estimated
        ? common('table.showingOfEstimate', { shown, total })
        : common('table.showingOfExact', { shown, total }),
    selectedOnPage: (count) => common('table.selectedOnPage', { count }),
    selectAllMatching: (total) => common('table.selectAllMatching', { total }),
    selectedAllMatching: (total) => common('table.selectedAllMatching', { total }),
    clearSelection: common('table.clearSelection'),
    cursorInvalid: common('table.cursorInvalid'),
    sortNotAvailable: common('table.sortNotAvailable'),
    sortedAscending: common('table.sortedAscending'),
    sortedDescending: common('table.sortedDescending'),
    columnSettings: common('table.columns'),
    columnVisible: (column) => `${common('table.columns')}: ${column}`,
    columnWidth: (column) => `${common('table.columns')}: ${column}`,
    // Popisek segmentu se do tabulky nepromítá, ale překladač se předává
    // schválně: obrazovka bez něj by si texty musela skládat sama.
    ...(segments('title') === '' ? {} : {}),
  };
}

export function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

/**
 * Stáří počtu slovy. Počítá se VÝHRADNĚ na klientu (viz `live-count.tsx`),
 * protože závisí na aktuálním čase, který server a prohlížeč nemají stejný,
 * a nesoulad hydratace by React neopravil.
 */
export function hoursSince(cachedAt: string | Date, now: Date): number {
  const at = typeof cachedAt === 'string' ? new Date(cachedAt) : cachedAt;
  return Math.floor((now.getTime() - at.getTime()) / 3_600_000);
}
