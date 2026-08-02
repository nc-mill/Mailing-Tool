'use client';

import { useTranslations } from 'next-intl';

export { NEGATING_OPERATORS, isNegating } from './negating-operators';

export function NullHint({ onAddEmptyCondition }: { onAddEmptyCondition: () => void }) {
  const t = useTranslations('segments');
  return (
    <div role="note" className="flex flex-col gap-1">
      <p>{t('notNullHint')}</p>
      <button type="button" onClick={onAddEmptyCondition}>
        {t('addEmptyCondition')}
      </button>
    </div>
  );
}
