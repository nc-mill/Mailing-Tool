'use client';

import { useTranslations } from 'next-intl';

/**
 * Nabídka se řídí typovou maticí, kterou vlastní kompilátor. Operátor, který
 * se k typu pole nehodí, se nikdy nesmí objevit: server ho odmítne a uživatel
 * by nepochopil proč.
 *
 * U seznamů je `is_confirmed` PŘED `is_member`, protože „je v seznamu" většina
 * lidí čte jako „potvrzeně odebírá", což není totéž, a první položka nabídky
 * je ta, kterou vybere nejvíc lidí.
 */
export const OPERATORS_BY_CLASS: Record<string, string[]> = {
  text: ['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'is_not_empty'],
  boolean: ['is_true', 'is_false', 'is_empty'],
  date: ['on', 'before', 'after', 'between', 'in_last_days', 'not_in_last_days', 'in_next_days', 'is_empty', 'is_not_empty'],
  datetime: ['on', 'before', 'after', 'between', 'in_last_days', 'not_in_last_days', 'in_next_days', 'is_empty', 'is_not_empty'],
  enum: ['eq', 'neq', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  multi_enum: ['has_any', 'has_all', 'has_none', 'is_empty', 'is_not_empty'],
  tag: ['has_any', 'has_all', 'has_none'],
  list: ['is_confirmed', 'is_member', 'is_not_member', 'is_pending', 'is_unsubscribed'],
  consent: ['is_granted', 'is_withdrawn', 'is_missing'],
  suppression: ['is_suppressed', 'is_not_suppressed'],
  engagement: ['did', 'did_not', 'count_gte', 'count_lte'],
  event: ['did', 'did_not', 'count_gte', 'count_lte'],
  segment: ['in', 'not_in'],
};

/** Operátory, u kterých je rozdíl v důsledcích tak velký, že patří do nabídky. */
const HINTED = new Set(['is_member', 'is_missing', 'is_withdrawn']);

export function OperatorPicker({
  fieldClass,
  value,
  onChange,
}: {
  fieldClass: string;
  value: string;
  onChange: (operator: string) => void;
}) {
  const t = useTranslations('segments');
  const operators = OPERATORS_BY_CLASS[fieldClass] ?? [];

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="operator-picker">{t('builder.operatorLabel')}</label>
      <select
        id="operator-picker"
        data-testid="operator-select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {operators.map((operator) => (
          <option key={operator} value={operator}>
            {t(`operators.${operator}`)}
          </option>
        ))}
      </select>
      {HINTED.has(value) ? <p>{t(`operatorHints.${value}`)}</p> : null}
    </div>
  );
}
