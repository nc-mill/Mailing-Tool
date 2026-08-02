'use client';

import { useTranslations } from 'next-intl';
import { FIELD_CLASS_OPERATORS, type FieldClass } from './operator-matrix';

/**
 * Nabídka se řídí typovou maticí, kterou vlastní kompilátor. Operátor, který
 * se k typu pole nehodí, se nikdy nesmí objevit: server ho odmítne a uživatel
 * by nepochopil proč.
 *
 * U seznamů je `is_confirmed` PŘED `is_member`, protože „je v seznamu" většina
 * lidí čte jako „potvrzeně odebírá", což není totéž, a první položka nabídky
 * je ta, kterou vybere nejvíc lidí.
 */
/**
 * Nabídka se řídí typovou maticí z `./operator-matrix`, kterou hlídá test
 * proti kompilátoru. Vlastní kopie tady byla druhým zdrojem pravdy a při
 * první změně matice by se rozešla.
 *
 * Jediná odchylka je POŘADÍ u seznamů: `is_confirmed` je před `is_member`,
 * protože „je v seznamu" většina lidí čte jako „potvrzeně odebírá", což není
 * totéž, a první položka nabídky je ta, kterou vybere nejvíc lidí.
 */
const LIST_ORDER = ['is_confirmed', 'is_member', 'is_not_member', 'is_pending', 'is_unsubscribed'];

function operatorsFor(fieldClass: string): string[] {
  const operators = FIELD_CLASS_OPERATORS[fieldClass as FieldClass] ?? [];
  if (fieldClass !== 'list') return operators;
  return [...operators].sort((a, b) => LIST_ORDER.indexOf(a) - LIST_ORDER.indexOf(b));
}

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
  const operators = operatorsFor(fieldClass);

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
